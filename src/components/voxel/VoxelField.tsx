"use client";

import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Geometry, Program, Mesh } from "ogl";
import {
  buildTerrain,
  EMPTY_CELL,
  MATERIAL,
  SEA_Y,
  VOXEL_SIZE,
  WORLD_HEIGHT,
  type VoxelTerrain,
} from "@/lib/voxel/terrain";
import {
  buildScene,
  buildBatch,
  /* Aliased: `place` is already the orbit camera inside the effect below,
     and a local const silently shadowing an import is a bug that typechecks
     in every language that does not have different signatures. */
  place as placeFigure,
  posePerFrame,
  alongRail,
  type FigureBatch,
  type CastMember,
} from "@/lib/voxel/figures";
import { FIGURE_VERTEX, FIGURE_FRAGMENT } from "./miner.glsl";
import {
  BLOCK_VERTEX,
  BLOCK_FRAGMENT,
  CHIP_VERTEX,
  CHIP_FRAGMENT,
} from "./mineable.glsl";
import { shotList, sampleShots, ACTS, cartS, cartLoad } from "@/lib/voxel/journey";
import { SKY_UNIFORMS, SKY_FN, NOISE_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN } from "./light.glsl";

/* ----------------------------------------------------------------------------
   INSTANCED VOXEL FIELD

   Three draws: a sky, the island, a sea.

   The island is one of them. One quad, stamped once per VISIBLE face, in a
   single call. That is what GPU INSTANCING means and it is the whole reason
   this is viable: the quad's four vertices are uploaded once, and alongside
   them a list of per-face offsets, orientations and material ids. OGL marks
   those as `instanced: 1`, works out the count, and dispatches
   drawElementsInstanced. The GPU stamps the quad once per entry.

   Nothing here is loaded from disk. The cube is written out by hand below,
   the terrain is arithmetic, the sky is a function and the water is noise.
-------------------------------------------------------------------------------*/

/* A unit cube with FOUR vertices per face rather than eight shared corners.
   Shared corners would force one averaged normal per corner and the cube
   would shade like a sphere. Faces need their own flat normals to read as
   blocks, which is what makes voxels look like voxels. */
const F = 0.5;
// prettier-ignore
const CUBE_POSITION = new Float32Array([
  -F,-F, F,  F,-F, F,  F, F, F, -F, F, F,   // +Z front
   F,-F,-F, -F,-F,-F, -F, F,-F,  F, F,-F,   // -Z back
  -F, F, F,  F, F, F,  F, F,-F, -F, F,-F,   // +Y top
  -F,-F,-F,  F,-F,-F,  F,-F, F, -F,-F, F,   // -Y bottom
   F,-F, F,  F,-F,-F,  F, F,-F,  F, F, F,   // +X right
  -F,-F,-F, -F,-F, F, -F, F, F, -F, F,-F,   // -X left
]);
// prettier-ignore
const CUBE_NORMAL = new Float32Array([
   0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
   0, 0,-1,  0, 0,-1,  0, 0,-1,  0, 0,-1,
   0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
   0,-1, 0,  0,-1, 0,  0,-1, 0,  0,-1, 0,
   1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
  -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
]);
const CUBE_INDEX = new Uint16Array(
  Array.from({ length: 6 }, (_, f) => {
    const o = f * 4;
    return [o, o + 1, o + 2, o, o + 2, o + 3];
  }).flat(),
);

/* A unit quad in XY. One of these is stamped per VISIBLE face, oriented in
   the vertex shader. A cube instance always carries all six of its faces; a
   cube buried in terrain shows about one and a half. */
// prettier-ignore
const QUAD_POSITION = new Float32Array([
  -F, -F, 0,  F, -F, 0,  F, F, 0,  -F, F, 0,
]);
const QUAD_INDEX = new Uint16Array([0, 1, 2, 0, 2, 3]);

/* A single triangle larger than the viewport, not a quad. Two triangles meet
   along a diagonal seam that some drivers shade twice; one oversized triangle
   has no interior edge at all. */
// prettier-ignore
const FULLSCREEN_TRI = new Float32Array([
  -1, -1, 0,   3, -1, 0,   -1, 3, 0,
]);

/* --- the strata -------------------------------------------------------------
   A luminance staircase, not five tasteful browns.

   Measured on the old set, dirt and rock sat at a luminance ratio of 1.28
   and rock and deep at 1.20 -- while the per-block jitter spanned 1.46. The
   noise was louder than the geology, so the bands the descent exists to show
   simply were not there. These are spaced so every neighbouring pair differs
   by at least 1.9x, and they alternate warm/cool/warm so hue carries the
   distinction as well as brightness.

   Stone is deliberately the BRIGHTEST band: a pale course between two dark
   ones is what makes a cut face read as layered rather than merely dirty. */
const GRASS: [number, number, number] = [0.385, 0.575, 0.245];
const DIRT: [number, number, number] = [0.52, 0.355, 0.21];
const STONE: [number, number, number] = [0.545, 0.53, 0.5];
/* Deep rock runs warm rather than grey. A mine's lower strata are the
   subject of this site, and a second cold grey would read as more stone. */
const ROCK: [number, number, number] = [0.37, 0.25, 0.2];
/* Timber had to come up and warm up: against rock it was a ratio of 0.59,
   i.e. darker than the wall it is set into and invisible in the shaft. */
const WOOD: [number, number, number] = [0.46, 0.31, 0.17];
const LEAF: [number, number, number] = [0.25, 0.44, 0.19];
/* Below the rock. Cold where everything above it is warm, which is the only
   reason a fifth band is worth the branch -- a second brown reads as more
   rock and the descent stops registering that it has passed anything. */
const DEEP: [number, number, number] = [0.195, 0.205, 0.255];
const ORE_COPPER: [number, number, number] = [0.66, 0.35, 0.17];
const ORE_GOLD: [number, number, number] = [0.72, 0.56, 0.19];
const ORE_CRYSTAL: [number, number, number] = [0.24, 0.6, 0.72];

/* The lamp. One point light, not two: its position is interpolated from the
   camera to the middle of the chamber as the journey arrives, so the thing
   that lights the shaft and the thing that lights the room are the same four
   uniforms and cost one set of ALU ops rather than two. */
const LAMP_COL: [number, number, number] = [1.0, 0.82, 0.58];
const LAMP_RANGE = 26;

/* --- sky and sea palette ----------------------------------------------------
   One set of numbers, shared by all three programs. */
const SKY_TOP: [number, number, number] = [0.07, 0.24, 0.58];
const SKY_MID: [number, number, number] = [0.28, 0.48, 0.74];
const SKY_HORIZON: [number, number, number] = [0.70, 0.81, 0.88];
const SUN_TINT: [number, number, number] = [1.0, 0.92, 0.76];
/* About fourteen degrees up. Low enough that its bloom and its road on the
   water both reach into a frame that only holds ten degrees of sky, high
   enough that a voxel scene keyed from directly overhead does not look lit
   from the side. Normalised on the way into the uniform. */
const SUN_DIR: [number, number, number] = [0.55, 0.17, 0.74];

const WATER_DEEP: [number, number, number] = [0.08, 0.25, 0.4];
const WATER_SHALLOW: [number, number, number] = [0.2, 0.53, 0.67];
const WATER_FOAM: [number, number, number] = [0.88, 0.96, 1.0];
/* The island's own water -- the spill and the falls -- reads much lighter
   than the sea. It is a thin sheet with sky behind it, not forty metres of
   depth, and giving it the sea's colour makes the falls look like cables.
   Not TOO light, though: a fall that never leaves the pale end of the range
   is a glass rod, and the dark troughs between the bands are what make it
   read as moving water. */
const WATER_LIT: [number, number, number] = [0.18, 0.42, 0.62];

/* Where aerial perspective starts and finishes. Tied to the orbit radius:
   the fade should begin just in front of the island's near edge and be
   complete behind its far one. */
/* Pushed out, and weakened in light.glsl, for linear light.

   These were tuned when the haze was an sRGB mix. Mixing toward a bright sky
   in LINEAR lifts a dark pixel far more for the same blend factor -- which
   is physically right and visually wrong at the old numbers: the first
   linear build fogged the hero island into a pale silhouette. Haze now
   begins beyond the island's near edge instead of in front of it. */
const FOG_NEAR = 120;
const FOG_FAR = 280;

/* Where the sea stops being sea. Both ends are distances along the view ray,
   not world radii: a ray grazing the horizon runs for kilometres and has to
   have become sky long before it gets there. */
const SEA_FADE: [number, number] = [220, 820];
/* Ripples and sparkle die off much sooner than the colour does. Carrying
   them to the horizon turns the sea into a shimmering moire, which is most
   of what makes a flat water plane look cheap. */
const SEA_DETAIL: [number, number] = [90, 320];

/* Framing. Pulled back far enough to hold the island, the falls and a band
   of sky, and pitched down about fifteen degrees.

   That pitch is the whole composition. Any camera looking down by MORE than
   half the vertical field of view puts the horizon off the top of the frame,
   and a scene with no horizon in it has no sky in it either -- which is how
   the previous thirty-three degree view ended up as an island on a flat
   backdrop. Fifteen down against twenty-one of half-fov leaves six degrees
   of sky above the waterline, and still looks down on the plateaus enough
   for the terraces to read. */
const RADIUS = 100;
const HEIGHT = 54;
const TARGET: [number, number, number] = [0, 24, 0];
const FOV = 48;

/* The one frame reduced motion gets: a three-quarter view with the water
   mid-swell rather than at t=0, where every wave term starts at the same
   phase and the sea comes out suspiciously flat. */
const STILL_ANGLE = 0.62;
const STILL_TIME = 7.5;
/* Where the journey stops under reduced motion. Not the opening frame: the
   pit from above is the one shot that holds the island, the sky, the sea and
   the dig at once, so a reader who will never see the descent still gets what
   the descent is about. */
const STILL_P = ACTS[1].at;

/* --- mining -----------------------------------------------------------------
   Four strikes, because one is a button and ten is a chore. */
const STRIKES = 4;
/* A fixed pool, split between two burst slots so a second strike does not
   cut the first one's debris off in mid-air. Nothing grows: this is the
   whole particle budget for the scene. */
const CHIPS = 64;
const CHIP_LIFE = 1.15;
/* How long a strike rings for. Short -- an impact that takes half a second
   to settle reads as a wobble, not a blow. */
const PUNCH = 0.36;
/* The window in which the chamber is in frame. Outside it neither the block
   nor its chips are drawn, so the surface keeps its two draw calls and the
   cavern is not paying for a mesh behind a wall.

   Read off the acts rather than written down: the working face is act four,
   and retiming act four has to move this with it or the block appears in a
   tunnel. A little either side, because the shots at the edges of an act are
   already looking into the next room. */
const MINE_FROM = ACTS[3].from - 0.03;
const MINE_TO = ACTS[4].from + 0.06;

/* --- the crew ---------------------------------------------------------------
   Two world units tall, which is almost exactly two terrain blocks.

   This number is the whole experiment. Nothing in this scene has ever had a
   known size -- a 48-block island could be a model on a desk or a county --
   and a figure of a known height is the cheapest way to settle it.

   2.3 is measured, not guessed, and the first guess was wrong. Dividing his
   height by his distance gave 55px and that silently assumes he stands square
   to the view ray -- true at eye level, false for a camera looking 42 degrees
   down into a pit, where a standing figure is foreshortened by a third.
   Projecting his feet and the top of his helmet SEPARATELY gives 40px at two
   units. 2.3 puts him at 46, mid-band, and 40-63 across the whole approach. */
/* Where the find's own light sits, and how far it carries. Range rather than
   brightness is what makes it read as a large object: a bright point with a
   short reach is a torch, and a dimmer one that touches the far wall is a
   thing the size of a house. */
const CRYSTAL_LIGHT: [number, number, number] = [0.42, 0.86, 1.0];
/* Short reach, high gain.

   The first pass had this at 26, which at the size of the room meant the far
   wall received 40% of what the formation's own faces did -- so the find lit
   the cavern evenly and read as a ceiling light rather than as the thing
   giving off the light. Halving the range makes the falloff steep enough
   that the brightest surfaces in the frame are the crystal's own, which is
   the entire difference between an object that is lit and one that glows. */
const CRYSTAL_RANGE = 15;

/* How fast the camera catches up with the scrollbar, per second. ScrollTrigger
   reports scroll position exactly; this is what turns a flung scrollbar into a
   camera move instead of a cut. */
const EASE = 7;

function unit([x, y, z]: [number, number, number]): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}

/* ---------------------------------------------------------------------------
   SHADERS
---------------------------------------------------------------------------- */

const VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
/* Per-instance, not per-vertex: these advance once per cube. */
attribute vec3 aOffset;
attribute float aMaterial;
attribute float aAO;
attribute float aTint;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

varying vec3 vNormal;
varying float vMaterial;
varying float vAO;
varying float vDepth;
varying float vTint;
varying vec3 vWorld;
varying vec3 vCell;
varying vec3 vRay;
/** Position within the face, -0.5..0.5, for edge definition. */
varying vec2 vFaceUV;

void main() {
  vec3 world = position + aOffset;
  /* Drop the axis the face points along and the remaining two are a flat
     frame on that face. */
  vec3 anv = abs(normal);
  vFaceUV = anv.x > 0.5 ? position.zy : (anv.y > 0.5 ? position.xz : position.xy);
  vNormal = normal;
  vCell = aOffset;
  vMaterial = aMaterial;
  vAO = aAO;
  vTint = aTint;
  vWorld = world;
  // Nothing in this scene is transformed, so local space IS world space and
  // the ray to the eye is a subtraction rather than a matrix.
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  // Distance from the camera, kept for the aerial-perspective fade.
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

/* The face path. The quad is rotated into place from its face id rather than
   stored rotated, so the per-instance data stays one float instead of a
   normal plus a basis. Each basis satisfies cross(t, b) == n, which is what
   keeps the winding counter-clockwise from outside so back-face culling
   still removes the half of the scene facing away. */
const VERTEX_FACES = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 aOffset;
attribute float aFace;
attribute float aMaterial;
attribute float aAO;
attribute float aTint;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

varying vec3 vNormal;
varying float vMaterial;
varying float vAO;
varying float vDepth;
varying float vTint;
varying vec3 vWorld;
varying vec3 vCell;
varying vec3 vRay;
/** Position within the face, -0.5..0.5, for edge definition. */
varying vec2 vFaceUV;

void main() {
  vec3 n, t, b;
  if (aFace < 0.5)      { n = vec3( 1.0, 0.0, 0.0); t = vec3( 0.0, 0.0,-1.0); b = vec3(0.0, 1.0, 0.0); }
  else if (aFace < 1.5) { n = vec3(-1.0, 0.0, 0.0); t = vec3( 0.0, 0.0, 1.0); b = vec3(0.0, 1.0, 0.0); }
  else if (aFace < 2.5) { n = vec3( 0.0, 1.0, 0.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 0.0,-1.0); }
  else if (aFace < 3.5) { n = vec3( 0.0,-1.0, 0.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 0.0, 1.0); }
  else if (aFace < 4.5) { n = vec3( 0.0, 0.0, 1.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); }
  else                  { n = vec3( 0.0, 0.0,-1.0); t = vec3(-1.0, 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); }

  vec3 world = aOffset + n * 0.5 + t * position.x + b * position.y;

  // The quad is built in XY and oriented by the basis above, so its own
  // coordinates are already the face frame -- no derivation needed.
  vFaceUV = position.xy;
  vNormal = n;
  vMaterial = aMaterial;
  vAO = aAO;
  vTint = aTint;
  vWorld = world;
  /* The cube's centre, which is CONSTANT across the four corners of a face.
     Anything that should vary between blocks but not across one belongs
     here, not in vWorld. */
  vCell = aOffset;
  vRay = world - cameraPosition;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uGrass;
uniform vec3 uDirt;
uniform vec3 uStone;
uniform vec3 uRock;
uniform vec3 uWood;
uniform vec3 uLeaf;
uniform vec3 uWaterDeep;
uniform vec3 uWaterFoam;
uniform vec3 uDeep;
uniform vec3 uOreCopper;
uniform vec3 uOreGold;
uniform vec3 uOreCrystal;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

varying vec3 vNormal;
varying float vMaterial;
varying float vAO;
varying float vDepth;
varying float vTint;
varying vec3 vWorld;
varying vec3 vCell;
varying vec3 vRay;
/** Position within the face, -0.5..0.5, for edge definition. */
varying vec2 vFaceUV;

${SKY_FN}
${LIGHT_FN}

void main() {
  vec3 n = vNormal;

  vec3 col;
  if (vMaterial < 0.5) {
    // Grass caps the column but its flanks are the dirt underneath.
    col = n.y > 0.5 ? uGrass : uDirt;
  } else if (vMaterial < 1.5) {
    col = uDirt;
  } else if (vMaterial < 2.5) {
    col = uStone;
  } else if (vMaterial < 3.5) {
    col = uRock;
  } else if (vMaterial < 4.5) {
    col = uWood;
  } else if (vMaterial < 5.5) {
    col = uLeaf;
  } else if (vMaterial < 6.5) {
    /* Still water lying in the plateau. Only its top face is ever really
       seen, so this is a surface treatment rather than a volume. */
    float r = sin(vWorld.x * 1.7 + uTime * 1.3) + sin(vWorld.z * 2.1 - uTime * 0.9);
    col = mix(uWaterDeep, uWaterFoam, 0.34 + r * 0.16);
  } else if (vMaterial < 7.5) {
    /* The falling column. Bands scrolling DOWN the world Y, offset per
       column so the four sides of one fall are not in lockstep -- without
       the offset the whole thing pulses like a barber's pole. */
    /* The phase offset comes from the CUBE, not the fragment. Taking it from
       vWorld made it slide across each face as well as down it, and the
       result was a barber's pole -- diagonal candy stripes spiralling round
       the column, which is the one thing falling water never does. From
       vCell it is one value per column, so the bands stay horizontal. */
    float lane = vCell.x * 0.31 + vCell.z * 0.52;
    float s = fract(vWorld.y * 0.13 - uTime * 1.15 + lane);
    float streak = smoothstep(0.18, 0.86, s);
    /* Two more waves: a slow one that breaks the sheet into separate strands
       down its length, and a fast one for the churn. A single band set makes
       one solid ribbon however hard it pulses.

       Sines rather than value noise, and the reason is measured. GLSL
       compilers flatten an if/else chain over a varying into arithmetic and
       evaluate EVERY branch, so a vnoise behind "if this block is water" is
       four sin calls charged to every grass block on the island as well.
       That alone had the island pass costing four times its old budget. */
    float strand = sin(lane * 8.5 + vCell.y * 0.47) * 0.5 + 0.5;
    float churn = sin(vWorld.y * 3.1 - uTime * 7.0 + lane * 5.0) * 0.5 + 0.5;
    col = mix(uWaterDeep, uWaterFoam,
              clamp(streak * (0.28 + strand * 0.54) + churn * 0.18, 0.0, 0.82));

    /* vAO carries how far down the fall this block is, not sky access --
       see the emitter. Water breaks white where it leaves the lip and again
       where it hits the sea, and those two bands are most of what separates
       a waterfall from a painted blue rod. */
    float prog = vAO;
    float crest = 1.0 - smoothstep(0.0, 0.055, prog);
    float base = smoothstep(0.90, 1.0, prog);
    col = mix(col, uWaterFoam, max(crest, base) * 0.8);
  } else if (vMaterial < 8.5) {
    col = uDeep;
  } else if (vMaterial < 9.5) {
    col = uOreCopper;
  } else if (vMaterial < 10.5) {
    col = uOreGold;
  } else {
    col = uOreCrystal;
  }

  /* Per-cube jitter. Without it a cliff is one flat rectangle of a single
     value, which is the main reason untextured voxels read as plastic. */
  col *= vTint;

  /* Edge definition.

     This is what the jitter was standing in for, and it does the job far
     better: a narrow darkening at the rim of every face gives each cube its
     own outline, so a wall of one material still reads as made of blocks.
     Crucially it costs no luminance separation BETWEEN materials -- it
     varies within a face rather than between cubes, so the strata keep the
     spacing they were just given.

     Kept to 7% of the authored colour. It is a shadow in a joint, not an
     ink line; anything heavier and the scene reads as cel-shaded. */
  float edge = smoothstep(0.86, 1.0, max(abs(vFaceUV.x), abs(vFaceUV.y)) * 2.0);
  col *= 1.0 - edge * 0.07;

  /* Water takes a far flatter key than rock. Keying a sheet of falling water
     the way a cliff is keyed makes it read as blue stone. */
  /* A WINDOW, not a threshold. This used to be step(5.5) alone, which was
     exactly right while water and the falls were the last two materials in
     the list. The deep band and the three ores sit above them now, so the
     open-ended test would have shaded every ore block in the mine as if it
     were a sheet of falling water. */
  float isWater = step(5.5, vMaterial) * (1.0 - step(7.5, vMaterial));
  /* Crystal carries nearly twice the self-light of the metals.

     It is the one material in the set the story asks to BE a source rather
     than to be found: the formation in the cavern is eight blocks of it and
     it is what the whole descent is for, while copper and gold are seams
     that should read as metal sitting in rock. One weight rather than a
     second emissive path, so there is still exactly one place where any of
     this is decided. */
  float isOre = step(8.5, vMaterial) * (1.0 + 0.9 * step(10.5, vMaterial));
  /* One sine, charged to every fragment in the scene whether it is ore or
     not, because the compiler flattens this branch -- affordable at one
     sine, and measurably not at four. */
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vCell.x * 1.7 + vCell.y * 1.1 + vCell.z * 2.3);

  /* Encoded exactly once, here, at the very end. */
  gl_FragColor = vec4(toSRGB(
    voxelLight(col, n, vAO, vWorld, vRay, vDepth, isWater, isOre, glint)), 1.0);
}
`;

/* --- the environment ------------------------------------------------------
   Sky and sea in ONE pass over one oversized triangle, with no water
   geometry at all.

   A water quad, however large, has an edge, and an edge in the middle of an
   ocean is the one thing you cannot hide -- the first version of this showed
   its far corner as a pale wedge across the top of the frame. Intersecting
   the sea plane per pixel instead gives a surface that is genuinely
   unbounded and a horizon that is exact rather than tessellated.

   It is drawn AFTER the island, pinned to the far plane at z = 1.0. With the
   default LEQUAL depth test that fails on every pixel the island already
   wrote and passes on every pixel still holding the cleared 1.0, so the
   background costs nothing where there is no background. Nothing in the
   scene can ever be behind the sea, so there is no ordering to get wrong:
   the island floats above it. */
const ENV_VERTEX = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
varying vec3 vRay;
void main() {
  /* Interpolating the ray across the triangle is linear in clip space, which
     is exactly what a view ray is before it gets normalised. */
  vRay = uCamFwd
       + uCamRight * (position.x * uTanHalfFov * uAspect)
       + uCamUp * (position.y * uTanHalfFov);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const ENV_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 cameraPosition;
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uWaterFoam;
uniform float uTime;
uniform float uSeaY;
uniform float uSea;
uniform vec2 uSeaFade;
uniform vec2 uSeaDetail;
uniform vec3 uShadowAt;
uniform float uShadowR;
uniform vec3 uFall0;
uniform vec3 uFall1;
uniform vec3 uFall2;
${SKY_UNIFORMS}

varying vec3 vRay;

${SKY_FN}
${NOISE_FN}

/* Expanding rings where a fall lands. Its second component carries whether
   the slot is used at all, so two falls cost the same as three and no branch
   is needed to find out. */
float impact(vec3 fall, vec2 p, float t) {
  float d = length(p - fall.xz);
  /* A churned core with rings running out of it, rather than rings all the
     way in. Concentric circles centred on nothing read as sonar. */
  float core = 1.0 - smoothstep(0.0, 3.2, d);
  float ring = sin(d * 1.5 - t * 3.0) * 0.5 + 0.5;
  float near = 1.0 - smoothstep(1.0, 13.0, d);
  return fall.y * near * (core * 0.95 + ring * (1.0 - core) * 0.45);
}

void main() {
  vec3 dir = normalize(vRay);
  vec3 sky = skyColor(dir);

  /* Above the waterline, or the sea switched off for measurement: done. The
     early return is also most of why this pass is cheap -- sky pixels never
     touch the water code at all. */
  if (uSea < 0.5 || dir.y > -0.0015) {
    gl_FragColor = vec4(toSRGB(sky), 1.0);
    return;
  }

  /* The sea's own palette, decoded to match the sky it is about to be mixed
     with. Mixing an sRGB water colour into a linear sky is the seam this
     whole shared-function arrangement exists to prevent. */
  vec3 deepL = toLinear(uWaterDeep);
  vec3 shallowL = toLinear(uWaterShallow);
  vec3 foamL = toLinear(uWaterFoam);
  vec3 sunSeaL = toLinear(uSunTint);

  // Where this ray meets the plane y = uSeaY.
  float t = (uSeaY - cameraPosition.y) / dir.y;
  vec2 p = cameraPosition.xz + dir.xz * t;

  float detail = 1.0 - smoothstep(uSeaDetail.x, uSeaDetail.y, t);

  /* Swell: two long crossing bands plus a drifting noise. All of it in the
     fragment shader, because a displaced vertex grid buys silhouette detail
     that is invisible from a camera a hundred units up, at the price of
     thousands of triangles. */
  float w = sin(p.x * 0.052 + uTime * 0.33) * 0.42
          + sin(dot(p, vec2(0.62, 0.78)) * 0.071 - uTime * 0.47) * 0.34
          + (vnoise(p * 0.085 + vec2(uTime * 0.06, uTime * -0.04)) - 0.5) * 0.9
          /* A finer band that only survives close to the camera, so the
             foreground is not a flat sheet while the distance has all the
             texture. It dies first because it aliases first. */
          + (vnoise(p * 0.31 + vec2(uTime * -0.18, uTime * 0.12)) - 0.5)
            * 0.8 * (1.0 - smoothstep(60.0, 170.0, t));
  w *= detail;

  vec3 col = mix(deepL, shallowL, clamp(w * 0.5 + 0.5, 0.0, 1.0) * 0.6);

  /* Grazing angles see the sky off the surface, steep ones see into it. The
     single cheapest thing that stops a water plane looking like paint. */
  vec3 refl = reflect(dir, vec3(0.0, 1.0, 0.0));
  float fres = pow(1.0 - clamp(-dir.y, 0.0, 1.0), 3.0);
  /* Also weakened for linear light: at 0.78 the sea reflected so much sky
     that it lost its own colour and the lower half of the frame went pale. */
  col = mix(col, skyColor(refl), fres * 0.55);

  /* The sun's road on the water, with sparkle in it. A true specular wants a
     surface normal; thresholded noise aligned to the sun's reflection reads
     the same from this distance and costs one noise lookup. */
  float road = pow(max(dot(refl, uSunDir), 0.0), 9.0);
  /* Sparkle at roughly six world units, not one. At one it is smaller than a
     pixel by the time it reaches the middle distance, and a sub-pixel
     threshold does not shimmer -- it aliases, and the sea comes out looking
     like television static. It also has to die much closer in than the swell
     does, for the same reason. */
  float sparkle = smoothstep(0.70, 0.97, vnoise(p * 0.19 - vec2(uTime * 0.33, 0.0)));
  float sparkleNear = 1.0 - smoothstep(40.0, 150.0, t);
  col += sunSeaL * road * (0.3 + sparkle * 0.6 * sparkleNear) * detail;

  /* The island's shadow. Thrown along the real sun direction, then pulled
     most of the way back, because the full-length shadow of a sun this low
     lands outside the frame entirely and a floating island with no shadow
     under it does not read as floating at all. */
  vec2 sc = uShadowAt.xz - (uSunDir.xz / max(uSunDir.y, 0.2)) * uShadowAt.y * 0.22;
  float sh = 1.0 - smoothstep(uShadowR * 0.3, uShadowR, length(p - sc));
  col *= 1.0 - sh * 0.38;

  float foam = impact(uFall0, p, uTime)
             + impact(uFall1, p, uTime)
             + impact(uFall2, p, uTime);
  col = mix(col, foamL, clamp(foam, 0.0, 1.0) * 0.6 * detail);

  /* Into the sky well before the eye can find an end to it. At the horizon t
     runs to infinity, so this reaches 1 and the two sides of the waterline
     meet at exactly the same colour -- which is why the horizon needs no
     geometry to be clean. */
  col = mix(col, sky, smoothstep(uSeaFade.x, uSeaFade.y, t));

  gl_FragColor = vec4(toSRGB(col), 1.0);
}
`;

/** Which geometry form to draw. Kept switchable so the two can be measured
    against each other on identical terrain rather than argued about. */
export type GeometryMode = "cubes" | "faces";

/** Which parts of the scene to build at all. The point is measurement: the
    cost of a feature is the difference between two runs of the same build,
    not between two builds. */
export type Layers = { sky: boolean; water: boolean; falls: boolean };
export const ALL_LAYERS: Layers = { sky: true, water: true, falls: true };

export type BenchResult = {
  mode: GeometryMode;
  layers: Layers;
  /** Fastest timed block. Least contaminated by other work on the machine. */
  msMin: number;
  msMedian: number;
  msMax: number;
  runs: number;
  framesPerRun: number;
  instances: number;
  vertices: number;
  triangles: number;
  drawCalls: number;
  /** Wall-clock cost of buildTerrain, on the main thread, once. */
  buildMs: number;
  /** Pixels actually rasterised, which is what the fragment cost scales on. */
  pixels: number;
};

/** What the one mineable block is doing, for the control that drives it. */
export type MineState = {
  /** Strikes landed so far. */
  stage: number;
  /** Strikes needed. */
  stages: number;
  broken: boolean;
  /** False when the terrain offered no suitable block at all. */
  available: boolean;
};

/** Where that block is on screen, so a real button can sit over it. */
export type TargetScreen = {
  /** Centre, in CSS pixels within the canvas. */
  x: number;
  y: number;
  /** The block's projected width, in CSS pixels. */
  size: number;
  visible: boolean;
};

/* Imperative handles, handed out through a ref rather than taken as props.

   A prop would have to be in the effect's dependency list, and this effect
   builds the entire scene -- so a parent re-rendering with a new function
   identity would tear down the renderer and rebuild the terrain. The ref is
   filled in on mount and nulled on cleanup. */
export type VoxelControls = {
  strike: () => void;
  reset: () => void;
  /** Hover or keyboard focus, which look the same in the scene. */
  hover: (on: boolean) => void;
  /** Jump the still frame to a progress. Reduced motion only -- with the
      loop running, the scrollbar owns this. */
  showAt: (p: number) => void;
};

export type VoxelStats = {
  instances: number;
  solid: number;
  culled: number;
  fps: number;
};

export function VoxelField({
  className,
  maxDpr = 1.5,
  antialias = false,
  geometry: mode = "faces",
  layers = ALL_LAYERS,
  bench = false,
  progress,
  controls,
  onReady,
  onError,
  onStats,
  onBench,
  onFrame,
  onMine,
  onTarget,
}: {
  className?: string;
  maxDpr?: number;
  /** MSAA on the default framebuffer. Off by default -- see the note where
      the renderer is built. Switchable so the trade can be measured rather
      than argued about. */
  antialias?: boolean;
  geometry?: GeometryMode;
  layers?: Layers;
  /** Run a synchronous timing pass before the animation loop starts. */
  bench?: boolean;
  /* Scroll position, 0 to 1, written from outside.

     A mutable box rather than a prop, and that is the whole integration. A
     prop would re-render this component on every scroll event, and since the
     effect below rebuilds the entire GL scene when its inputs change, a
     scrubbed scroll would tear down and recreate the renderer sixty times a
     second. A box is read inside the one animation loop that already exists,
     so whatever writes it never touches the context. */
  progress?: { current: number };
  /** Filled in with the imperative handles on mount; nulled on cleanup. */
  controls?: { current: VoxelControls | null };
  onReady?: (t: VoxelTerrain) => void;
  onError?: (message: string) => void;
  onStats?: (s: VoxelStats) => void;
  onBench?: (b: BenchResult) => void;
  /** Per frame, for the depth readout. Writes the DOM directly; anything
      that calls setState from here will stall the loop. */
  onFrame?: (f: { p: number; y: number }) => void;
  /** Mining progress. Fires on change only, so it is safe to setState from. */
  onMine?: (s: MineState) => void;
  /** Per frame, for positioning the button over the block. Writes the DOM
      directly for the same reason onFrame does. */
  onTarget?: (t: TargetScreen) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        canvas,
        /* MSAA, measured rather than assumed. The original reasoning was
           that resolution sharpens a voxel edge better than smoothing does;
           that is true of texture detail and not obviously true of a silhouette
           of hard diagonals against a sky gradient, which is most of this
           scene's edge budget. ?aa=1 and ?dpr= exist to settle it. */
        antialias,
        /* Opaque now. The sky used to be a CSS gradient showing through a
           transparent canvas, which meant the renderer had no idea what
           colour sat behind any given pixel and haze could only fade toward
           one constant. The sky is a shader now, so the canvas owns every
           pixel and the compositor has one less layer to blend. */
        alpha: false,
        powerPreference: "high-performance",
        /* Only when still. The reduced-motion path draws exactly one frame
           and then stops, and without this the browser is free to throw the
           drawing buffer away the moment it has composited it -- after which
           any repaint shows an empty canvas and never gets it back. The
           usual reason to avoid it, a copy per frame, cannot apply when
           there is only ever one frame. */
        preserveDrawingBuffer: reduced,
        dpr: Math.min(window.devicePixelRatio || 1, maxDpr),
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "WebGL is unavailable");
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(SKY_HORIZON[0], SKY_HORIZON[1], SKY_HORIZON[2], 1);

    /* Put the CONTEXT into the state OGL's cache believes it is already in.

       OGL keeps a mirror of the GL state to skip redundant calls, and seeds
       that mirror with assumed values instead of reading the context. Two of
       them are wrong here, and both are silent:

       depthFunc: the mirror says LEQUAL, WebGL's real default is LESS. The
       environment triangle sits at exactly z = 1.0 against a depth buffer
       cleared to 1.0, so LEQUAL draws it and LESS rejects every fragment of
       it. The sky that looked "flat" for two builds running was the clear
       colour, not the shader.

       depthMask: the mirror says true. But a canvas hands back the same
       context forever, so a SECOND Renderer built on it inherits whatever
       the first left behind -- and the first ends every frame on the
       environment program, which turns depth writes off. The new mirror then
       skips re-enabling them, the island draws without writing depth, and
       the far-plane triangle passes over the top of it. From the second
       frame on the mirror drifts back into agreement and it fixes itself,
       which is why it was invisible while the camera was moving and
       permanent under reduced motion -- that path draws exactly one frame. */
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);

    /* The measured size of the stage, in CSS pixels. Declared up here
       because the projection that places the button over the block needs it
       and is defined well before the observer that fills it in. */
    let w = 0;
    let h = 0;

    const buildStart = performance.now();
    const terrain = buildTerrain(0x7a19, { falls: layers.falls });
    const buildMs = performance.now() - buildStart;

    /* One set of uniform objects, shared by reference across all three
       programs. Copies would be three places to forget to update, and the
       first thing that goes wrong when the sky and its haze disagree is a
       hard line at the horizon. */
    const sunDir = unit(SUN_DIR);
    const uTime = { value: 0 };
    const skyUniforms = {
      uSkyTop: { value: SKY_TOP },
      uSkyMid: { value: SKY_MID },
      uSkyHorizon: { value: SKY_HORIZON },
      uSunTint: { value: SUN_TINT },
      uSunDir: { value: sunDir },
    };
    const fogRange = { value: [FOG_NEAR, FOG_FAR] };
    const lamp = {
      uLampPos: { value: [0, 0, 0] as number[] },
      uLampCol: { value: LAMP_COL },
      /* Zero until the journey goes under. The surface was composed without
         this light and must not acquire one. */
      uLampGain: { value: 0 },
      uLampRange: { value: LAMP_RANGE },
      /* The find. Also zero until the journey is in the room with it: it is
         the one light in this scene that belongs to an OBJECT rather than to
         the camera, and switching it on early would light a cavern the
         visitor has not reached through twenty blocks of rock. */
      uLamp2Pos: { value: [0, 0, 0] as number[] },
      uLamp2Col: { value: CRYSTAL_LIGHT },
      uLamp2Gain: { value: 0 },
      uLamp2Range: { value: CRYSTAL_RANGE },
    };

    const scene = new Transform();
    const disposables: Array<{ remove: () => void }> = [];

    let geometry: Geometry;
    let program: Program;
    try {
      geometry =
        mode === "cubes"
          ? new Geometry(gl, {
              position: { size: 3, data: CUBE_POSITION },
              normal: { size: 3, data: CUBE_NORMAL },
              index: { data: CUBE_INDEX },
              // `instanced: 1` = advance once per cube, not once per vertex.
              aOffset: { size: 3, data: terrain.offset, instanced: 1 },
              aMaterial: { size: 1, data: terrain.material, instanced: 1 },
              aAO: { size: 1, data: terrain.ao, instanced: 1 },
              aTint: { size: 1, data: terrain.tint, instanced: 1 },
            })
          : new Geometry(gl, {
              position: { size: 3, data: QUAD_POSITION },
              index: { data: QUAD_INDEX },
              // One instance per VISIBLE face rather than per cube.
              aOffset: { size: 3, data: terrain.faceOffset, instanced: 1 },
              aFace: { size: 1, data: terrain.faceDir, instanced: 1 },
              aMaterial: { size: 1, data: terrain.faceMaterial, instanced: 1 },
              aAO: { size: 1, data: terrain.faceAo, instanced: 1 },
              aTint: { size: 1, data: terrain.faceTint, instanced: 1 },
            });

      program = new Program(gl, {
        vertex: mode === "cubes" ? VERTEX : VERTEX_FACES,
        fragment: FRAGMENT,
        uniforms: {
          uGrass: { value: GRASS },
          uDirt: { value: DIRT },
          uStone: { value: STONE },
          uRock: { value: ROCK },
          uWood: { value: WOOD },
          uLeaf: { value: LEAF },
          uWaterDeep: { value: WATER_LIT },
          uWaterFoam: { value: WATER_FOAM },
          uDeep: { value: DEEP },
          uOreCopper: { value: ORE_COPPER },
          uOreGold: { value: ORE_GOLD },
          uOreCrystal: { value: ORE_CRYSTAL },
          uFogRange: fogRange,
          uTime,
          ...lamp,
          ...skyUniforms,
        },
        // Opaque solids: depth testing on, back faces discarded.
        depthTest: true,
        depthWrite: true,
        cullFace: gl.BACK,
      });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not build the scene");
      return;
    }

    const island = new Mesh(gl, { geometry, program });
    /* The island goes FIRST so the environment behind it can be rejected by
       the depth test before its fragment shader ever runs. */
    island.renderOrder = -1;
    /* Frustum culling OFF, and not as a precaution.

       OGL builds a mesh's bounding sphere from its `position` attribute --
       which here is one unit quad sitting at the origin. Every real position
       in this scene lives in `aOffset`, an instanced attribute the bounds
       code never looks at. So the island declares itself to be a 1-unit
       speck at (0,0,0) while actually spanning 48 x 49 x 48, and the culler
       either keeps all of it or throws all of it away depending on where
       that speck happens to fall. It threw it away on the reduced-motion
       frame, which draws exactly once and so had no later frame to
       disguise it. */
    island.frustumCulled = false;
    island.setParent(scene);
    disposables.push(geometry, program);

    /* --- environment ------------------------------------------------------ */
    const camBasis = {
      uCamRight: { value: [1, 0, 0] as number[] },
      uCamUp: { value: [0, 1, 0] as number[] },
      uCamFwd: { value: [0, 0, -1] as number[] },
      uTanHalfFov: { value: Math.tan((FOV * Math.PI) / 360) },
      uAspect: { value: 1 },
    };
    const falls = terrain.falls;
    const fallUniform = (i: number) => ({
      value: falls[i] ? [falls[i].x, 1, falls[i].z] : [0, 0, 0],
    });

    if (layers.sky || layers.water) {
      const envGeo = new Geometry(gl, {
        position: { size: 3, data: FULLSCREEN_TRI },
      });
      const envProg = new Program(gl, {
        vertex: ENV_VERTEX,
        fragment: ENV_FRAGMENT,
        uniforms: {
          uWaterDeep: { value: WATER_DEEP },
          uWaterShallow: { value: WATER_SHALLOW },
          uWaterFoam: { value: WATER_FOAM },
          uTime,
          uSeaY: { value: SEA_Y },
          /* A uniform, not a second shader. Flipping it leaves the binary
             alone and skips the water branch at run time, so the difference
             between two measurements is the water's cost and nothing else --
             two builds would differ by the compiler as well as the scene. */
          uSea: { value: layers.water ? 1 : 0 },
          uSeaFade: { value: SEA_FADE },
          uSeaDetail: { value: SEA_DETAIL },
          // Island centre, and how far it floats above the sea.
          uShadowAt: { value: [0, Math.abs(SEA_Y), 0] },
          uShadowR: { value: 40 },
          uFall0: fallUniform(0),
          uFall1: fallUniform(1),
          uFall2: fallUniform(2),
          ...camBasis,
          ...skyUniforms,
        },
        /* Depth tested so the island rejects it, but never written: nothing
           is ever drawn behind the background. */
        depthTest: true,
        depthWrite: false,
        cullFace: false,
      });
      const envMesh = new Mesh(gl, { geometry: envGeo, program: envProg });
      /* Its vertices are already in clip space, so its bounding box sits at
         the origin a hundred units from the camera. Frustum culling would
         throw the entire sky away. */
      envMesh.frustumCulled = false;
      envMesh.setParent(scene);
      disposables.push(envGeo, envProg);
    }

    /* --- the mineable block and its debris ---------------------------------
       Two more draws, and only while the chamber is in frame. */
    const mt = terrain.mine.target;
    const uPunch = { value: 0 };
    const uCrack = { value: 0 };
    const uBroken = { value: 0 };
    const uHot = { value: 0 };
    const uBurstA = { value: [0, 0, 0, -1] as number[] };
    const uBurstB = { value: [0, 0, 0, -1] as number[] };

    let blockMesh: Mesh | null = null;
    let chipMesh: Mesh | null = null;

    if (mt) {
      const stoneCol = mt.material === MATERIAL.deep ? DEEP : ROCK;
      const face = [mt.face[0], mt.face[1], mt.face[2]];
      const centre = [mt.x, mt.y, mt.z];
      const mineUniforms = {
        uRock: { value: stoneCol },
        uOre: { value: ORE_GOLD },
        uAO: { value: mt.ao },
        uFace: { value: face },
        uTime,
        uFogRange: fogRange,
        ...lamp,
        ...skyUniforms,
      };

      const blockGeo = new Geometry(gl, {
        position: { size: 3, data: CUBE_POSITION },
        normal: { size: 3, data: CUBE_NORMAL },
        index: { data: CUBE_INDEX },
      });
      const blockProg = new Program(gl, {
        vertex: BLOCK_VERTEX,
        fragment: BLOCK_FRAGMENT,
        uniforms: {
          uCenter: { value: centre },
          /* The jitter the generator gave this cell. Without it the block is
             a flat average sitting among neighbours that all vary, which is
             visible long before anyone looks for it. */
          uTint: { value: mt.tint },
          uPunch,
          uCrack,
          uBroken,
          uHot,
          ...mineUniforms,
        },
        depthTest: true,
        depthWrite: true,
        cullFace: gl.BACK,
      });
      blockMesh = new Mesh(gl, { geometry: blockGeo, program: blockProg });
      // Its bounds are a unit cube at the origin; the real centre is a uniform.
      blockMesh.frustumCulled = false;
      // With the island, so the environment pass can still be depth-rejected.
      blockMesh.renderOrder = -1;
      blockMesh.setParent(scene);
      disposables.push(blockGeo, blockProg);

      /* The chips. Their whole trajectory is a function of the burst time, so
         the only per-strike work is writing four floats into a uniform --
         nothing is simulated on the CPU and no buffer is touched per frame. */
      const seeds = new Float32Array(CHIPS * 3);
      const slots = new Float32Array(CHIPS);
      // A fixed sequence, so the debris is the same every run and a frame
      // that looks wrong can be looked at again.
      let rnd = 0x9e3779b9;
      const next = () => {
        rnd = (Math.imul(rnd ^ (rnd >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
        return rnd / 4294967296;
      };
      for (let i = 0; i < CHIPS; i++) {
        seeds[i * 3] = next() * 2 - 1;
        seeds[i * 3 + 1] = next() * 2 - 1;
        seeds[i * 3 + 2] = next() * 2 - 1;
        slots[i] = i % 2;
      }

      const chipGeo = new Geometry(gl, {
        position: { size: 3, data: CUBE_POSITION },
        normal: { size: 3, data: CUBE_NORMAL },
        index: { data: CUBE_INDEX },
        aSeed: { size: 3, data: seeds, instanced: 1 },
        aSlot: { size: 1, data: slots, instanced: 1 },
      });
      const chipProg = new Program(gl, {
        vertex: CHIP_VERTEX,
        fragment: CHIP_FRAGMENT,
        uniforms: {
          uBurstA,
          uBurstB,
          uFloorY: { value: terrain.mine.chamberFloorY },
          uLife: { value: CHIP_LIFE },
          ...mineUniforms,
        },
        depthTest: true,
        depthWrite: true,
        cullFace: gl.BACK,
      });
      chipMesh = new Mesh(gl, { geometry: chipGeo, program: chipProg });
      chipMesh.frustumCulled = false;
      chipMesh.renderOrder = -1;
      chipMesh.setParent(scene);
      disposables.push(chipGeo, chipProg);
    }

    /* --- the population ----------------------------------------------------
       Nine figures, a cart, the rail road, the lanterns and the loose gear,
       in ONE instanced draw.

       The previous version gave each figure its own Geometry and Program.
       That is the obvious way and it costs a draw call per person, but worse
       than the cost is that it cannot scale: OGL keeps uniforms on the
       Program, so two figures sharing a program share a pose. Pushing
       position, facing and pose down to per-instance attributes removes both
       problems -- everyone animates independently, and the crowd costs what
       one figure used to. */
    const plan = buildScene(terrain.mine);
    const batch: FigureBatch = buildBatch(plan.defs);
    const rail = plan.rail;

    /* Stand everyone on what is actually there. Reading the ground off the
       occupancy grid rather than writing heights down means retuning the pit
       or the drift moves the crew with it instead of leaving them buried. */
    const half = (VOXEL_SIZE - 1) / 2;
    const groundAt = (wx: number, wz: number, from: number) => {
      const gx = Math.round(wx + half);
      const gz = Math.round(wz + half);
      if (gx < 0 || gz < 0 || gx >= VOXEL_SIZE || gz >= VOXEL_SIZE) return null;
      const top = Math.min(WORLD_HEIGHT - 1, Math.round(from));
      /* Find AIR first, then the floor under it.

         Returning the first solid cell on the way down is only correct when
         the search starts in open air, and underground it often does not:
         the cavern is domed, so a figure near its edge has its search start
         inside the roof -- and the first solid cell found is the roof
         itself. Three of the crew were standing on the ceiling, which no
         still showed because the camera was below them looking the other
         way. */
      let open = false;
      for (let y = top; y >= 0; y--) {
        const solid =
          terrain.cells[(y * VOXEL_SIZE + gz) * VOXEL_SIZE + gx] !== EMPTY_CELL;
        if (!solid) {
          open = true;
          continue;
        }
        // A block's centre is its grid y, so its surface is half a unit up.
        if (open) return y + 0.5;
      }
      return null;
    };

    type Stand = CastMember & { y: number; yaw: number };
    const crew: Stand[] = [];
    for (const c of plan.cast) {
      const y = groundAt(c.x, c.z, c.groundFrom);
      // No ground under them: drop the figure rather than float one.
      if (y === null) continue;
      crew.push({ ...c, y, yaw: Math.atan2(c.lookX - c.x, c.lookZ - c.z) });
    }

    const figGeo = new Geometry(gl, {
      position: { size: 3, data: CUBE_POSITION },
      normal: { size: 3, data: CUBE_NORMAL },
      index: { data: CUBE_INDEX },
      aPart: { size: 3, data: batch.part, instanced: 1 },
      aSize: { size: 3, data: batch.size, instanced: 1 },
      aPartB: { size: 3, data: batch.partB, instanced: 1 },
      aSizeB: { size: 3, data: batch.sizeB, instanced: 1 },
      aColor: { size: 3, data: batch.color, instanced: 1 },
      aAO: { size: 1, data: batch.ao, instanced: 1 },
      aEmit: { size: 1, data: batch.emit, instanced: 1 },
      aXform: { size: 4, data: batch.xform, instanced: 1 },
      aMotion: { size: 4, data: batch.motion, instanced: 1 },
    });
    const figProg = new Program(gl, {
      vertex: FIGURE_VERTEX,
      fragment: FIGURE_FRAGMENT,
      uniforms: { uTime, uFogRange: fogRange, ...lamp, ...skyUniforms },
      depthTest: true,
      depthWrite: true,
      cullFace: gl.BACK,
    });
    const figMesh = new Mesh(gl, { geometry: figGeo, program: figProg });
    // Bounds are a unit cube at the origin; every real position is instanced.
    figMesh.frustumCulled = false;
    figMesh.renderOrder = -1;
    figMesh.setParent(scene);
    disposables.push(figGeo, figProg);

    /* The rail road never moves, so it is written once and never touched
       again -- it is in the batch for the draw call, not for the animation. */
    placeFigure(batch, "props", { x: 0, y: 0, z: 0, yaw: 0, pose: 0, hidden: false });

    /* --- the cart ----------------------------------------------------------
       A pure function of progress, like the camera. It runs out to the find
       empty and comes back loaded, and because nothing about it integrates,
       scrubbing back up the page runs it backwards exactly. */
    const cartAt = (p: number) => ({
      s: cartS(p, rail.length),
      load: cartLoad(p),
      live: p > ACTS[3].from - 0.04 && p < ACTS[6].to,
    });

    /* --- everyone, once per frame -----------------------------------------
       Two small buffer uploads for the whole population. Writing the arrays
       is a couple of hundred float stores, which is nothing next to the one
       draw call it replaces. */
    const HIDE = { x: 0, y: 0, z: 0, yaw: 0, pose: 0, hidden: true };

    const placeCrew = (t: number, p: number, userPose: number) => {
      const cart = cartAt(p);
      const onRail = alongRail(rail, cart.s);

      for (const c of crew) {
        if (p < c.from || p > c.to) {
          placeFigure(batch, c.id, HIDE);
          continue;
        }
        /* The man at the block is driven by the visitor and by nobody else.
           Everyone else is on their own clock. */
        const pose =
          c.id === "faceA" ? userPose : posePerFrame(c.role, t, p);
        if (c.onRail) {
          /* Walking behind the cart rather than standing somewhere. The
             offset is along the road's own heading, so it holds whichever
             flank the drift was driven into. */
          const behind = alongRail(rail, cart.s + 1.4);
          placeFigure(batch, c.id, {
            x: behind.x,
            y: behind.y + 0.5,
            z: behind.z,
            yaw: onRail.yaw + Math.PI,
            pose,
            hidden: false,
          });
          continue;
        }
        placeFigure(batch, c.id, {
          x: c.x,
          y: c.y,
          z: c.z,
          yaw: c.yaw,
          pose,
          hidden: false,
        });
      }

      placeFigure(batch, "cart", {
        x: onRail.x,
        y: onRail.y + 0.5,
        z: onRail.z,
        yaw: onRail.yaw,
        pose: cart.load,
        hidden: !cart.live,
      });

      figGeo.attributes.aXform.needsUpdate = true;
      figGeo.attributes.aMotion.needsUpdate = true;
    };

    /* The sea is not geometry any more, so 'far' only has to clear the island
       and its falls.

       Near used to sit at 2, on the reasoning that nothing was ever closer
       than about seventy. The journey invalidates that: inside a shaft five
       cubes across the nearest wall is about a unit and a half away and a
       timber post passes closer than that, so a near plane of 2 would clip
       the shaft open and show the sky through it. 0.35 still leaves a depth
       ratio a 24-bit buffer handles without z-fighting. */
    const camera = new Camera(gl, { fov: FOV, near: 0.35, far: 300 });

    /* The sky needs the camera's axes, and worldMatrix is only rebuilt inside
       render(). Doing it here means the ray the sky is built from belongs to
       the frame being drawn rather than the one before it. */
    const commit = () => {
      camera.updateMatrixWorld();
      const m = camera.worldMatrix;
      camBasis.uCamRight.value = [m[0], m[1], m[2]];
      camBasis.uCamUp.value = [m[4], m[5], m[6]];
      camBasis.uCamFwd.value = [-m[8], -m[9], -m[10]];
      // The fov moves during the descent, and the sky is built from it.
      camBasis.uTanHalfFov.value = Math.tan((camera.fov * Math.PI) / 360);
    };

    /* The orbit. Kept exactly as it was, and used by the benchmark and
       nothing else now -- the figures from this stage are only comparable
       with the last one's if the camera they were taken from is identical. */
    const place = (angle: number) => {
      if (camera.fov !== FOV) camera.perspective({ fov: FOV });
      camera.position.set(
        Math.sin(angle) * RADIUS,
        HEIGHT,
        Math.cos(angle) * RADIUS,
      );
      camera.lookAt(TARGET);
      commit();
    };

    const shots = shotList(terrain.mine);
    const mine = terrain.mine;

    /* A decaying offset added to the camera on a strike. Separate from the
       path rather than folded into it, so the path stays a pure function of
       progress and scrolling back up still retraces exactly. */
    let shakeX = 0;
    let shakeY = 0;

    /* The scroll-driven camera. A pure function of p, which is what makes
       scrolling back up retrace rather than approximate. */
    const placeJourney = (p: number) => {
      const f = sampleShots(shots, p);
      if (Math.abs(camera.fov - f.fov) > 0.01) camera.perspective({ fov: f.fov });
      camera.position.set(f.pos[0] + shakeX, f.pos[1] + shakeY, f.pos[2]);
      camera.lookAt(f.look);
      commit();

      /* The lamp follows the camera down the shaft and then stays behind in
         the chamber, so the last shot is lit by the room rather than by the
         lens -- a light locked to the eye flattens everything it touches,
         and the chamber is the one frame that has to have depth in it. */
      /* Two ramps, not one. The first brings the lamp up as the shaft takes
         the daylight away and down again as the pit mouth gives it back. The
         second is the chamber and the drift: those walls are the deep band,
         which is both the darkest material in the set and the one the flood
         leaves at almost no sky access, so a lamp that was right for a shaft
         still bottoms the rooms out near black.

         Keyed off the acts rather than off literals. The descent is act
         three and the climb out is act seven; retiming either used to leave
         the lamp burning in daylight. */
      const under =
        smoothstep(ACTS[2].from, ACTS[2].at, p) *
        (1 - smoothstep(ACTS[6].at, ACTS[7].from + 0.02, p));
      lamp.uLampGain.value =
        under * (1 + 0.4 * smoothstep(ACTS[3].from, ACTS[3].at, p));

      /* And it leaves the lens in the chamber.

         A light locked to the eye flattens everything it touches, and the
         working face is the one place in the journey that has to have depth
         in it -- two figures, a cart and a rock face all at different
         distances. Everywhere else it rides with the camera, which is what a
         cap lamp does. */
      const toFace =
        smoothstep(ACTS[3].from, ACTS[3].at, p) *
        (1 - smoothstep(ACTS[3].to, ACTS[4].at, p));
      const faceY = mine.chamberFloorY + 3.4;
      lamp.uLampPos.value = [
        f.pos[0] + (mine.x - f.pos[0]) * toFace,
        f.pos[1] + 1.6 + (faceY - (f.pos[1] + 1.6)) * toFace,
        f.pos[2] + (mine.z - f.pos[2]) * toFace,
      ];

      /* The find's own light. It comes up as the camera comes down the drift
         and holds while the cart is loaded and hauled out -- the only
         lighting change in the journey caused by something IN the scene
         rather than by where the camera is standing. */
      const cry = mine.crystal;
      lamp.uLamp2Gain.value =
        2.1 *
        smoothstep(ACTS[4].from, ACTS[4].at, p) *
        (1 - smoothstep(ACTS[5].to, ACTS[6].at, p));
      lamp.uLamp2Pos.value = [cry.x, cry.y + cry.h * 0.55, cry.z];
    };

    /* Where the block lands on screen. The button that drives it is a real
       DOM button sitting over the canvas -- which is what gives it hover,
       focus, Enter, Space and touch for free, and puts it in the accessibility
       tree instead of hiding an interaction inside a canvas nothing can read.
       All this has to do is keep it over the block. */
    const reportTarget = (live: boolean) => {
      if (!mt || !onTarget) return;
      const hidden = { x: 0, y: 0, size: 0, visible: false };
      if (!live) {
        onTarget(hidden);
        return;
      }
      /* The centre of the FACE, not of the cube. Five of its six sides are
         buried in rock; what the visitor sees and aims at is the one side
         presented to the room, and that sits half a unit nearer than the
         centre -- enough, at this distance, for the button to sit visibly
         off the thing it drives. */
      const px = mt.x + mt.face[0] * 0.5;
      const py = mt.y + mt.face[1] * 0.5;
      const pz = mt.z + mt.face[2] * 0.5;
      const pv = camera.projectionViewMatrix;
      const cx = pv[0] * px + pv[4] * py + pv[8] * pz + pv[12];
      const cy = pv[1] * px + pv[5] * py + pv[9] * pz + pv[13];
      const cw = pv[3] * px + pv[7] * py + pv[11] * pz + pv[15];
      // Behind the eye: the perspective divide would put it back on screen,
      // mirrored, which is how a button ends up chasing the wrong thing.
      if (cw <= 0.001) {
        onTarget(hidden);
        return;
      }
      const nx = cx / cw;
      const ny = cy / cw;
      const dist = Math.hypot(
        mt.x - camera.position.x,
        mt.y - camera.position.y,
        mt.z - camera.position.z,
      );
      const perUnit =
        h / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(dist, 0.001));
      onTarget({
        x: (nx * 0.5 + 0.5) * w,
        y: (0.5 - ny * 0.5) * h,
        size: perUnit,
        visible: nx > -1.1 && nx < 1.1 && ny > -1.1 && ny < 1.1,
      });
    };

    /* Which frame reduced motion is showing. A variable rather than the
       constant, because without a loop the only way to see another part of
       the journey is to be shown it on request. */
    let stillP = STILL_P;

    const renderStill = () => {
      uTime.value = STILL_TIME;
      if (progress) {
        placeJourney(stillP);
        const live = stillP >= MINE_FROM && stillP <= MINE_TO;
        if (mt) {
          uPunch.value = 0;
          uCrack.value = stage / STRIKES;
          uBroken.value = broken ? 1 : 0;
          // The same idle floor, held still: with no loop there is nothing
          // to breathe, and a static hint is the honest version of one.
          uHot.value = Math.max(hotWant, broken ? 0 : 0.14);
          if (blockMesh) blockMesh.visible = live;
          // No debris without motion: chips are the one part of this that
          // cannot be expressed as a still.
          if (chipMesh) chipMesh.visible = false;
        }
        /* The crew still get placed: a still with no people in it is a
           photograph of a building site at four in the morning, and the one
           frame a reduced-motion reader is given should be the one that says
           most. Their poses are frozen, which is the point. */
        placeCrew(STILL_TIME, stillP, 0);
        reportTarget(live);
        /* The readout has to agree with the one frame that exists. Without
           this it reports the surface while the picture shows the pit, which
           is worse than having no readout at all. */
        onFrame?.({ p: stillP, y: camera.position.y });
      } else {
        place(STILL_ANGLE);
      }
      renderer.render({ scene, camera });
    };

    const t0 = performance.now();

    /* --- mining state ------------------------------------------------------
       Plain closure variables, not React state. The renderer reads them every
       frame; React is told only when the stage actually changes, which is at
       most five times in the life of the page. */
    let stage = 0;
    let broken = false;
    let punchAt = -10;
    let burstSlot = 0;
    let hotWant = 0;
    /* Where the camera actually is, eased toward the scrollbar. Negative
       until the first frame, which then snaps rather than eases: a reload
       restores the scroll position before any of this runs, so easing from
       zero would play the whole descent at the user unasked. */
    let shown = -1;

    const tNow = () => (performance.now() - t0) / 1000;

    const reportMine = () => {
      onMine?.({ stage, stages: STRIKES, broken, available: Boolean(mt) });
    };

    /* The envelope of a blow: a fast decay with a ring in it, and never
       negative -- see the block's vertex shader for why pushing it INTO the
       wall is not an option. */
    const strikeEnvelope = (t: number) => {
      const since = t - punchAt;
      if (since < 0 || since > PUNCH) return 0;
      const k = 1 - since / PUNCH;
      return k * k * (0.55 + 0.45 * Math.cos(since * 30));
    };

    /* --- the swing ---------------------------------------------------------
       A click starts a swing; the blow lands partway through it.

       The delay is the whole point. Cracking the stone on mouse-down and
       letting the arm catch up afterwards reads as two unrelated events --
       a UI click, and separately a man waving a pick. Landing the blow at
       the bottom of the arc is what makes one cause the other. */
    const SWING = 0.44;
    const IMPACT_AT = 0.26;
    let swingAt = -10;
    let swinging = false;

    const land = (now: number) => {
      if (!mt) return;
      stage = Math.min(STRIKES, stage + 1);
      broken = stage >= STRIKES;
      punchAt = now;

      /* Spray from just outside the face, not from the block's centre --
         debris that starts inside the stone spends its first frames climbing
         out of it. */
      const slot = burstSlot++ % 2;
      const target = slot === 0 ? uBurstA : uBurstB;
      target.value = [
        mt.x + mt.face[0] * 0.45,
        mt.y + mt.face[1] * 0.45,
        mt.z + mt.face[2] * 0.45,
        now,
      ];
      reportMine();
    };

    /* 0 at rest, 1 fully wound up. Up on the back-swing, snapped down
       through the blow, flat afterwards. */
    const swingPose = (t: number) => {
      const u = (t - swingAt) / SWING;
      if (u < 0 || u > 1) return 0;
      if (u < 0.42) return Math.sin((u / 0.42) * Math.PI * 0.5);
      if (u < 0.59) return Math.cos(((u - 0.42) / 0.17) * Math.PI * 0.5);
      return 0;
    };

    const strike = () => {
      if (!mt || broken || swinging) return;
      const now = tNow();
      if (reduced) {
        /* No swing to watch and no loop to run it, so the blow lands at
           once -- and renderStill is the only thing that will ever draw it. */
        land(now);
        renderStill();
        return;
      }
      swingAt = now;
      swinging = true;
    };

    const reset = () => {
      if (!mt) return;
      stage = 0;
      broken = false;
      punchAt = -10;
      swinging = false;
      swingAt = -10;
      uBurstA.value[3] = -1;
      uBurstB.value[3] = -1;
      if (reduced) {
        // No easing to carry it back, so put the uniforms where they belong.
        uCrack.value = 0;
        uBroken.value = 0;
      }
      reportMine();
      if (reduced) renderStill();
    };

    if (controls) {
      controls.current = {
        strike,
        reset,
        hover: (on: boolean) => {
          hotWant = on ? 1 : 0;
          if (reduced) {
            uHot.value = hotWant;
            renderStill();
          }
        },
        showAt: (p: number) => {
          if (!reduced) return;
          stillP = Math.min(1, Math.max(0, p));
          renderStill();
        },
      };
    }
    reportMine();

    const resize = () => {
      /* Measure the PARENT. OGL's setSize writes inline width/height in px
         onto the canvas, and an inline style outranks the stylesheet -- so
         measuring the canvas measures whatever OGL last wrote, and the first
         measurement (a canvas's default 300x150, taken before layout) would
         be frozen in permanently. */
      const box = canvas.parentElement ?? canvas;
      const rect = box.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      renderer.setSize(w, h);
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      camera.perspective({ aspect: w / h });
      camBasis.uAspect.value = w / h;
      /* Resizing reallocates the drawing buffer and blanks it. With the loop
         running the next frame covers that over; under reduced motion there
         is no next frame, so the canvas would stay empty for good. */
      if (reduced) renderStill();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);
    resize();

    let visible = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    let hidden = document.hidden;
    const onVisibility = () => {
      hidden = document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    onReady?.(terrain);

    const drawCalls = 1 + (layers.sky || layers.water ? 1 : 0);

    if (bench) {
      const instances = mode === "cubes" ? terrain.count : terrain.faceCount;
      const vpi = mode === "cubes" ? 24 : 4;
      const tpi = mode === "cubes" ? 12 : 2;

      /* gl.finish() is specified as "block until done", but several drivers
         treat it as advisory -- and the first numbers out of this harness
         (0.022 ms for 82k triangles, i.e. 45,000 fps) were exactly what you
         would see if it returned immediately and only CPU submission was
         being timed. readPixels cannot be deferred: the result has to come
         back to JavaScript, so the pipeline must actually drain first. */
      const probe = new Uint8Array(4);
      const sync = () =>
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);

      // Frozen, so animation cannot vary what is being measured.
      uTime.value = STILL_TIME;
      place(0.6);
      for (let i = 0; i < 60; i++) renderer.render({ scene, camera });
      sync();

      /* Repeated blocks, not one. A single block of this is worth about as
         much as a single coin toss: measuring the same geometry twice across
         two page loads gave 0.10 and 0.06 ms, so the run-to-run spread was
         as large as the difference being looked for. The minimum is the
         figure to compare -- it is the run least disturbed by whatever else
         the machine was doing. */
      const RUNS = 9;
      const K = 120;
      const samples: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const b0 = performance.now();
        for (let i = 0; i < K; i++) {
          // Nudged each frame so no driver can cache an identical submission.
          place(0.6 + (r * K + i) * 0.0002);
          renderer.render({ scene, camera });
        }
        sync();
        samples.push((performance.now() - b0) / K);
      }
      samples.sort((a, b) => a - b);

      onBench?.({
        mode,
        layers,
        msMin: samples[0],
        msMedian: samples[Math.floor(RUNS / 2)],
        msMax: samples[RUNS - 1],
        runs: RUNS,
        framesPerRun: K,
        instances,
        vertices: instances * vpi,
        triangles: instances * tpi,
        drawCalls,
        buildMs,
        pixels: gl.drawingBufferWidth * gl.drawingBufferHeight,
      });
    }

    let raf = 0;
    let timer = 0;
    let frames = 0;
    let lastReport = t0;
    let lastFrame = t0;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;

      /* Reduced motion gets a fixed view AND a frozen clock: a still camera
         over moving water is still motion. */
      if (reduced) {
        renderStill();
        return;
      }
      uTime.value = t;

      if (progress) {
        const dt = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        const want = Math.min(1, Math.max(0, progress.current));
        /* Exponential rather than a fixed fraction per frame. A fraction
           makes the catch-up rate depend on the frame rate, so the same
           flick settles at a different speed on a 144 Hz screen than on a
           60 Hz one. */
        shown =
          shown < 0 ? want : shown + (want - shown) * (1 - Math.exp(-dt * EASE));

        /* The blow is resolved BEFORE the camera is placed: the shake is an
           offset applied to the camera position, so it has to be known by
           the time that position is set. */
        const punch = strikeEnvelope(t);
        uPunch.value = punch;
        shakeX = Math.sin(t * 61) * punch * 0.055;
        shakeY = Math.cos(t * 47) * punch * 0.045;

        placeJourney(shown);

        /* Resolve a swing in flight BEFORE the punch envelope is read, so
           the stone's recoil and the chips belong to this frame rather than
           to the next one. */
        if (swinging && t >= swingAt + IMPACT_AT) {
          swinging = false;
          land(t);
        }

        if (mt) {
          const live = shown >= MINE_FROM && shown <= MINE_TO;
          if (blockMesh) blockMesh.visible = live;
          if (chipMesh) chipMesh.visible = live;
          /* Eased, not set. A crack that appears between one frame and the
             next reads as a texture swap; over about a tenth of a second it
             reads as the stone giving. */
          const ease = 1 - Math.exp(-dt * 12);
          uCrack.value += (stage / STRIKES - uCrack.value) * ease;
          uBroken.value += ((broken ? 1 : 0) - uBroken.value) * ease;
          /* An idle floor under the highlight.

             At rest this block is meant to be indistinguishable from the
             wall -- and it was, completely, which makes it an interactive
             element nobody can find. A faint edge, breathing slowly, says
             there is something here without announcing what. Hover and
             focus then take it to full. */
          const idle = broken ? 0 : 0.14 + 0.06 * Math.sin(t * 2.2);
          const want = Math.max(hotWant, idle);
          uHot.value += (want - uHot.value) * (1 - Math.exp(-dt * 14));

          reportTarget(live);
        }

        /* Everyone, every frame. Outside the mining window this is still
           called -- the surveyors at the rim and the pair in the cavern are
           on the same clock as the man at the face, and gating the whole
           population on the block's visibility is how half the cast ends up
           frozen mid-stride. */
        placeCrew(t, shown, swingPose(t));

        onFrame?.({ p: shown, y: camera.position.y });
      } else {
        place(t * 0.12);
      }

      renderer.render({ scene, camera });

      frames++;
      if (now - lastReport >= 500) {
        onStats?.({
          instances: terrain.count,
          solid: terrain.solid,
          culled: terrain.solid - terrain.count,
          fps: Math.round((frames * 1000) / (now - lastReport)),
        });
        frames = 0;
        lastReport = now;
      }

      /* Off-screen or backgrounded: poll slowly instead of per-frame. The rAF
         handle and the timeout handle stay separate because
         cancelAnimationFrame cannot cancel a setTimeout. */
      if (visible && !hidden) {
        raf = requestAnimationFrame(draw);
      } else {
        timer = window.setTimeout(() => {
          raf = requestAnimationFrame(draw);
        }, 250);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      // The handles close over a context that is about to be torn down.
      if (controls) controls.current = null;
      /* Delete the GL objects but do NOT force the context lost: a canvas
         returns the same context object every time and a lost one stays lost,
         so StrictMode's deliberate second mount would rebuild onto a dead
         context and every shader would fail to compile. */
      for (const d of disposables) d.remove();
    };
    /* Depend on the layer FLAGS, not the object. A new object with the same
       three booleans would tear the whole scene down and rebuild it, which
       is both wasteful and how the state-cache bug above got a second
       Renderer to exist in the first place. */
  }, [
    maxDpr,
    antialias,
    mode,
    layers.sky,
    layers.water,
    layers.falls,
    bench,
    progress,
    controls,
    onReady,
    onError,
    onStats,
    onBench,
    onFrame,
    onMine,
    onTarget,
  ]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
