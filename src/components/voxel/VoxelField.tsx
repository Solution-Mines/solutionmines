"use client";

import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Geometry, Mesh, Texture } from "ogl";
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
  poseFigure,
  alongRail,
  ISLETS,
  type FigureBatch,
  type CastMember,
} from "@/lib/voxel/figures";
import {
  CREW_VERTEX,
  CREW_FRAGMENT,
  CREW_VERTEX_GL1,
  CREW_FRAGMENT_GL1,
} from "./crew.glsl";
import { clip, blend, SWING_IMPACT, type ClipName } from "@/lib/voxel/crew";
import {
  BLOCK_VERTEX,
  BLOCK_FRAGMENT,
  BLOCK_VERTEX_TEX,
  BLOCK_FRAGMENT_TEX,
  CHIP_VERTEX,
  CHIP_FRAGMENT,
  CHIP_VERTEX_TEX,
  CHIP_FRAGMENT_TEX,
} from "./mineable.glsl";
import { BLOCK_FACE_VERTEX, BLOCK_FACE_FRAGMENT } from "./blocks.glsl";
import { buildAtlas, T as TILES, type Atlas } from "@/lib/voxel/atlas";
import { buildClouds } from "@/lib/voxel/clouds";
import {
  CLOUD_VERTEX,
  CLOUD_FRAGMENT,
  BEAM_VERTEX,
  BEAM_FRAGMENT,
  MOTE_VERTEX,
  MOTE_FRAGMENT,
  PLANT_VERTEX,
  PLANT_FRAGMENT,
} from "./fx.glsl";
import { createFilm, type Grade } from "./post";
import { Program, whenCompiled } from "./program";
import { bakeSunShadow } from "./shadow";
import {
  shotList,
  sampleShots,
  ACTS,
  cartS,
  cartStops,
  cartLoads,
  openAt,
  openShift,
  underAt,
  findAt,
} from "@/lib/voxel/journey";
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
// Kept equal to the atlas palette, which explains the retune.
const GRASS: [number, number, number] = [0.35, 0.53, 0.25];
const DIRT: [number, number, number] = [0.47, 0.33, 0.22];
const STONE: [number, number, number] = [0.5, 0.5, 0.5];
/* Deep rock runs warm rather than grey. A mine's lower strata are the
   subject of this site, and a second cold grey would read as more stone. */
const ROCK: [number, number, number] = [0.4, 0.31, 0.26];
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
/* A shade deeper than it was: at the film pass's exposure the old horizon
   haze read as a white band across a third of the opening frame. */
const SKY_HORIZON: [number, number, number] = [0.64, 0.76, 0.86];
/* Late afternoon: warm, but still a white-ish light rather than a sunset. */
const SUN_TINT: [number, number, number] = [1.0, 0.93, 0.82];
/* Thirty-six degrees up, from the opening camera's front left.

   It used to sit ten degrees up and almost exactly BEHIND that camera --
   35.5 degrees round against the sun's 36.6 -- which is the flattest light
   there is: every face the visitor could see was lit, and every shadow fell
   away out of sight behind the thing that cast it. From the front left, one
   of the two cliff faces the camera sees is lit and the other is in shade,
   and the trees' shadows lie across the grass toward the back right where
   the eye can follow them. High enough that the shadows are a tree's length,
   not a field's. Normalised on the way into the uniform. */
const SUN_DIR: [number, number, number] = [-0.25, 0.588, 0.769];

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
const RADIUS = 150;
const HEIGHT = 92;
const TARGET: [number, number, number] = [0, 42, 0];

/* The title over the island: behind its middle and above the summit's
   trees, turned to face the opening camera. */
const TITLE_AT: [number, number, number] = [-4, 87, -6];
const TITLE_YAW = Math.atan2(78 - TITLE_AT[0], 109 - TITLE_AT[2]);
const FOV = 48;

/* The one frame reduced motion gets: a three-quarter view with the water
   mid-swell rather than at t=0, where every wave term starts at the same
   phase and the sea comes out suspiciously flat. */
const STILL_ANGLE = 0.62;
const STILL_TIME = 7.5;
/* Where the journey stops under reduced motion. Not the opening frame: the
   island open in section is the one shot that holds the whole mine at once
   -- every level, the track and the crew on it -- so a reader who will never
   see the journey still gets what it is about. */
const STILL_P = ACTS[2].still;

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
/* The piece that drops out: how long it lies on the floor turning before it
   goes to the bag, how long the trip takes, and where on the screen the bag
   is -- the middle of the bottom edge, where the hotbar will sit. */
const ITEM_REST = 1.9;
const ITEM_FLY = 0.65;
const BAG_NDC: [number, number] = [0, -0.78];
/* The window in which the chamber is in frame. Outside it neither the block
   nor its chips are drawn, so the surface keeps its two draw calls and the
   cavern is not paying for a mesh behind a wall.

   Read off the acts rather than written down: the working face is act four,
   and retiming act four has to move this with it or the block appears in a
   tunnel. A little either side, because the shots at the edges of an act are
   already looking into the next room. */
const MINE_FROM = ACTS[3].from + (ACTS[3].to - ACTS[3].from) * 0.15;
const MINE_TO = ACTS[3].to + 0.004;

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

/* Block light. Warm is a lantern flame, about 2700K; the crystal is the
   site's teal, chosen against the orange of the vests and the brand. The
   gains are where the balance between the two is set -- the floods carry
   only levels. */
const WARM_LIGHT: [number, number, number] = [1.0, 0.8, 0.58];
const CRYSTAL_GLOW: [number, number, number] = [0.42, 0.86, 1.0];
/* Past white in the middle of a pool, so the wall beside a lantern glows. The
   shader steepens the flood's falloff, so this is the peak, not the spread. */
const WARM_GAIN = 3.6;
const CRYSTAL_GAIN = 2.6;
/* The air underground, in LINEAR light: a cool near-black the far end of a
   drift sinks into, and the cyan the crystal room's haze takes on. */
const CAVE_FOG: [number, number, number] = [0.005, 0.009, 0.017];
const CRYSTAL_FOG: [number, number, number] = [0.006, 0.03, 0.042];
/* The light down the shaft. Narrower than the five-block opening, so the
   cylinder never touches the timbering and the depth test never cuts it. The
   colour is the sun's, in linear light; the gain is per act. */
const BEAM_R = 1.3;
const BEAM_COL: [number, number, number] = [1.0, 0.84, 0.62];
const BEAM_GAIN = 1.3;
/* The beacon at the depot: a thin column straight up into the sky, the
   crystal's colour, bright enough through the glow to read in daylight. */
const BEACON_R = 0.42;
const BEACON_TOP = 190;
const BEACON_COL: [number, number, number] = [0.5, 0.9, 1.0];
const BEACON_GAIN = 34;
/* Dust and sparks: how many, and how bright before the per-act gain. Past
   white, so the glow picks each one out. */
const DUST = 240;
const SPARKS = 90;
const DUST_COL: [number, number, number] = [2.6, 2.1, 1.5];
const SPARK_COL: [number, number, number] = [1.2, 3.4, 4.0];
/* The shadow map's side, in texels. About thirty to a block across the
   island, which is twice the texture's own resolution. */
const SHADOW_SIZE = 2048;

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
attribute float aHalf;
attribute float aAoOpen;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uOpen;
uniform vec3 uOpenShift;

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

  /* The cut, as the textured path has it: the cross-section only while the
     island is open, and the front half carried away by the slide. */
  if (aHalf > 1.5 && uOpen < 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 world = aOffset + n * 0.5 + t * position.x + b * position.y;
  if (mod(aHalf, 2.0) > 0.5) world += uOpenShift;

  // The quad is built in XY and oriented by the basis above, so its own
  // coordinates are already the face frame -- no derivation needed.
  vFaceUV = position.xy;
  vNormal = n;
  vMaterial = aMaterial;
  vAO = aMaterial > 6.5 && aMaterial < 7.5 ? aAO : mix(aAO, aAoOpen, uOpen);
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
  } else if (vMaterial < 11.5) {
    col = uOreCrystal;
  } else if (vMaterial < 12.5) {
    col = uWood * 1.3;
  } else if (vMaterial < 13.5) {
    col = uStone * 0.95;
  } else if (vMaterial < 14.5) {
    col = vec3(0.86, 0.85, 0.8);
  } else if (vMaterial < 15.5) {
    col = uLeaf * vec3(1.5, 1.25, 1.1);
  } else if (vMaterial < 16.5) {
    col = uStone * 0.62;
  } else if (vMaterial < 17.5) {
    col = vec3(0.6, 0.53, 0.47);
  } else if (vMaterial < 18.5) {
    col = vec3(0.7, 0.17, 0.12);
  } else if (vMaterial < 19.5) {
    col = vec3(0.22, 0.66, 0.36);
  } else {
    col = vec3(1.0, 0.46, 0.12);
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
  float isOre = step(8.5, vMaterial) * step(vMaterial, 11.5) * (1.0 + 0.9 * step(10.5, vMaterial))
              + step(17.5, vMaterial) * (1.2 + 1.8 * step(19.5, vMaterial));
  /* One sine, charged to every fragment in the scene whether it is ore or
     not, because the compiler flattens this branch -- affordable at one
     sine, and measurably not at four. */
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vCell.x * 1.7 + vCell.y * 1.1 + vCell.z * 2.3);

  /* Encoded exactly once, here, at the very end. */
  gl_FragColor = vec4(outColor(
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
    gl_FragColor = vec4(outColor(sky), 1.0);
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

  gl_FragColor = vec4(outColor(col), 1.0);
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
  /** The journey itself, timed at each act's framed moment: what a visitor
      actually costs the machine, as opposed to the orbit above. */
  stations: BenchStation[];
};

export type BenchStation = {
  act: string;
  p: number;
  msMin: number;
  msMedian: number;
  /** Draw calls into the scene, and the film pass's own. */
  scene: number;
  post: number;
  /** The GPU's own time for one frame here, from a timer query -- free of
      whatever else the machine is doing, which wall-clock timing is not.
      Null where the browser does not offer GPU timers. */
  gpuMs?: number | null;
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
  /** Pieces of ore picked up so far: one per block broken, counted when
      the piece that drops out of it reaches the bag. */
  collected: number;
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
  adaptive = true,
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
  cameraAt,
  world,
  bag,
}: {
  className?: string;
  maxDpr?: number;
  /** Let the quality governor drop the density if frames run slow. Off when
      a density was asked for, which is a measurement. */
  adaptive?: boolean;
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
  /** A fixed camera for stills, overriding the journey's shot at whatever
      progress is held. Development only -- see ?cam= in VoxelView. Everything
      else (lamps, crew, cart) still follows the progress. */
  cameraAt?: { pos: [number, number, number]; look: [number, number, number]; fov: number } | null;
  /** The world, already built -- in a worker, by the page -- and how long
      that took. Built here, on the main thread, when it is not given. */
  world?: { terrain: VoxelTerrain; ms: number; atlas?: Atlas | null } | null;
  /** The page's bag: where a picked-up piece of ore flies to on screen.
      Read from its layout when a piece sets off, so the piece lands on the
      element wherever the page has put it. */
  bag?: { current: HTMLElement | null };
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    performance.mark("vx:setup");
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
    const terrain = world?.terrain ?? buildTerrain(0x7a19, { falls: layers.falls });
    const buildMs = world ? world.ms : performance.now() - buildStart;

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
      // Set once the film pass is known to work; see createFilm.
      uHdr: { value: 0 },
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
      uWarmCol: { value: WARM_LIGHT },
      uCrystalCol: { value: CRYSTAL_GLOW },
      uWarmGain: { value: WARM_GAIN },
      uCrystalGain: { value: CRYSTAL_GAIN },
      uUnder: { value: 0 },
      uCaveFog: { value: [...CAVE_FOG] as number[] },
    };

    /* How far open the island is, and where its front half has got to:
       shared by every program that draws the island or something on it. */
    const cut = {
      uOpen: { value: 0 },
      uOpenShift: { value: [0, 0, 0] as number[] },
    };

    const scene = new Transform();
    const disposables: Array<{ remove: () => void }> = [];

    /* --- the atlas -----------------------------------------------------------
       WebGL2 only: the textured shaders use texelFetch and pick their own mip
       level, neither of which a WebGL1 context has. Without it the island
       falls back to the flat-colour path it had before, which is a worse
       picture and a working page. */
    const textured = renderer.isWebgl2;
    let atlasTex: Texture | null = null;
    if (textured) {
      // Painted in the worker with the world when it was built there.
      const atlas = world?.atlas ?? buildAtlas();
      atlasTex = new Texture(gl, {
        image: atlas.levels[0],
        width: atlas.width,
        height: atlas.height,
        generateMipmaps: false,
        // Mipmapped so the texture is complete with every level bound; the
        // shaders fetch exact texels and choose the level themselves.
        minFilter: gl.NEAREST_MIPMAP_NEAREST,
        magFilter: gl.NEAREST,
        flipY: false,
      });
      atlasTex.update();
      /* OGL uploads level 0 only. The rest of the chain was averaged in linear
         light in atlas.ts, which the GPU's own generateMipmap does not do on
         an RGBA8 texture, so the levels go up by hand. */
      const g2 = gl as WebGL2RenderingContext;
      for (let level = 1; level < atlas.levels.length; level++) {
        g2.texImage2D(
          g2.TEXTURE_2D,
          level,
          g2.RGBA,
          atlas.width >> level,
          atlas.height >> level,
          0,
          g2.RGBA,
          g2.UNSIGNED_BYTE,
          atlas.levels[level],
        );
      }
      g2.texParameteri(g2.TEXTURE_2D, g2.TEXTURE_MAX_LEVEL, atlas.levels.length - 1);
      const tex = atlasTex;
      disposables.push({ remove: () => gl.deleteTexture(tex.texture) });
    }
    performance.mark("vx:setup:atlas");
    const facesTextured = textured && mode === "faces";

    /* --- the film pass ------------------------------------------------------
       Linear light into a half-float target, then glow, tone curve and grade
       on the way to the canvas -- see post.ts. Null where a half-float target
       cannot be rendered to, and then every shader finishes its own pixels. */
    const film = textured
      ? createFilm(renderer, gl.drawingBufferWidth, gl.drawingBufferHeight)
      : null;
    skyUniforms.uHdr.value = film ? 1 : 0;
    if (film) disposables.push({ remove: film.dispose });

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
              // The textured path's extras. The flat path never binds them.
              aTile: { size: 1, data: terrain.faceTile, instanced: 1 },
              aCornerAO: { size: 4, data: terrain.faceCornerAO, instanced: 1 },
              aLightW: { size: 4, data: terrain.faceLightW, instanced: 1 },
              aLightC: { size: 4, data: terrain.faceLightC, instanced: 1 },
              // The cut: which half each face goes with, and its sky open.
              aHalf: { size: 1, data: terrain.faceHalf, instanced: 1 },
              aAoOpen: { size: 1, data: terrain.faceAoOpen, instanced: 1 },
            });

      program = new Program(gl, {
        vertex: facesTextured ? BLOCK_FACE_VERTEX : mode === "cubes" ? VERTEX : VERTEX_FACES,
        fragment: facesTextured ? BLOCK_FACE_FRAGMENT : FRAGMENT,
        uniforms: {
          uAtlas: { value: atlasTex },
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
          ...cut,
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
    performance.mark("vx:setup:island");

    /* --- the sun's shadows -------------------------------------------------
       Drawn once, now, from the sun -- see shadow.ts. Every textured program
       that declares the sampler gets one, even the cube mode with nothing to
       draw into it, because a shadow sampler with no depth texture behind it
       fails the draw. */
    const sunShadow = textured
      ? bakeSunShadow(
          renderer,
          facesTextured ? geometry : null,
          facesTextured ? terrain.faceOffset : null,
          sunDir,
          SHADOW_SIZE,
        )
      : null;
    if (sunShadow) {
      if (facesTextured) {
        Object.assign(program.uniforms, sunShadow.uniforms);
        sunShadow.register(program);
      }
      disposables.push({ remove: sunShadow.dispose });
    }

    performance.mark("vx:setup:shadow");
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
    const fallU = [fallUniform(0), fallUniform(1), fallUniform(2)];
    /* A fall off the half that slides away goes with it, and the churn it
       left in the sea goes quiet while it is gone. */
    const fallFront = falls.map((f) => f.z > terrain.mine.cutZ);

    /* Kept for gating: the sky and the plants are drawn only where they can
       be seen. */
    let envMesh: Mesh | null = null;
    let plantMesh: Mesh | null = null;
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
          uShadowR: { value: 56 },
          uFall0: fallU[0],
          uFall1: fallU[1],
          uFall2: fallU[2],
          ...camBasis,
          ...skyUniforms,
        },
        /* Depth tested so the island rejects it, but never written: nothing
           is ever drawn behind the background. */
        depthTest: true,
        depthWrite: false,
        cullFace: false,
      });
      envMesh = new Mesh(gl, { geometry: envGeo, program: envProg });
      /* Its vertices are already in clip space, so its bounding box sits at
         the origin a hundred units from the camera. Frustum culling would
         throw the entire sky away. */
      envMesh.frustumCulled = false;
      envMesh.setParent(scene);
      disposables.push(envGeo, envProg);
    }

    /* --- the small plants ------------------------------------------------------
       Tufts, flowers, vines and roots: cut-out cards, one instanced draw --
       see fx.glsl.ts. Textured contexts only; the flat fallback has no atlas
       to cut them from, and an island without its grass is still an island. */
    if (textured && atlasTex && terrain.site.plants.length) {
      const pl = terrain.site.plants;
      const n = pl.length / 8;
      const aPlant = new Float32Array(n * 4);
      const aPlant2 = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        aPlant.set(pl.subarray(i * 8, i * 8 + 4), i * 4);
        aPlant2.set(pl.subarray(i * 8 + 4, i * 8 + 8), i * 4);
      }
      const plantGeo = new Geometry(gl, {
        position: {
          size: 3,
          data: new Float32Array([
            -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
            -0.5, 0, 1, 0.5, 0, 1, 0.5, 1, 1, -0.5, 1, 1,
          ]),
        },
        index: { data: new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]) },
        aPlant: { size: 4, data: aPlant, instanced: 1 },
        aPlant2: { size: 4, data: aPlant2, instanced: 1 },
      });
      const plantProg = new Program(gl, {
        vertex: PLANT_VERTEX,
        fragment: PLANT_FRAGMENT,
        uniforms: {
          uAtlas: { value: atlasTex },
          uTime,
          uFogRange: fogRange,
          ...lamp,
          ...skyUniforms,
          ...cut,
          ...(sunShadow?.uniforms ?? {}),
        },
        depthTest: true,
        depthWrite: true,
        cullFace: false,
      });
      if (sunShadow) sunShadow.register(plantProg);
      plantMesh = new Mesh(gl, { geometry: plantGeo, program: plantProg });
      // Bounds are a card at the origin; every real position is instanced.
      plantMesh.frustumCulled = false;
      plantMesh.setParent(scene);
      disposables.push(plantGeo, plantProg);
    }

    /* --- the light shaft, and what drifts in it ------------------------------
       Two draws, through the film pass only: without the glow a beam of
       added light is a pale smear. Both are pure functions of time, and both
       are switched off outside the acts that look into the pit or the mine. */
    const mineAt = terrain.mine;
    const sky = mineAt.skylight;
    /* Down the skylight into the chasm, from the turf to just over the lava.
       Ending clear of what it lands on: a cap inside a surface is rejected
       by the depth test, and every ray looking straight down the beam ends
       on that cap -- a clean disc with no light in it. */
    const skyBeam = [sky.x, sky.z, BEAM_R, mineAt.chasm.floorY + 1.6];
    const skyBeamTop = sky.topY + 0.5;
    const beacon = mineAt.beacon;
    // Up from the beacon's heart, into the sky.
    const beaconBeam = [beacon.x, beacon.z, BEACON_R, beacon.y + 1.95];
    const beamU = { value: [...skyBeam] as number[] };
    const beamTopU = { value: skyBeamTop };
    const beamCol = { value: [0, 0, 0] as number[] };
    const moteGain = { value: [0, 0] as number[] };
    const pixelU = { value: 0.001 };
    let beamMesh: Mesh | null = null;
    let moteMesh: Mesh | null = null;
    if (film) {
      /* Sixteen sides, pushed out so the round beam the shader integrates
         fits inside the polygon. Wound to face outward: the program draws
         only the faces turned AWAY from the eye -- see BEAM_FRAGMENT. */
      const SEG = 16;
      const k = 1 / Math.cos(Math.PI / SEG);
      const ring = (i: number, y: number) => {
        const a = (i / SEG) * Math.PI * 2;
        return [Math.cos(a) * k, y, Math.sin(a) * k];
      };
      const pos: number[] = [];
      for (let i = 0; i < SEG; i++) {
        const p0 = ring(i, 0);
        const p1 = ring(i + 1, 0);
        const p0t = ring(i, 1);
        const p1t = ring(i + 1, 1);
        pos.push(...p0, ...p1t, ...p1, ...p0, ...p0t, ...p1t);
        pos.push(0, 1, 0, ...p1t, ...p0t);
        pos.push(0, 0, 0, ...p0, ...p1);
      }
      const beamGeo = new Geometry(gl, {
        position: { size: 3, data: new Float32Array(pos) },
      });
      const beamProg = new Program(gl, {
        vertex: BEAM_VERTEX,
        fragment: BEAM_FRAGMENT,
        uniforms: { uBeam: beamU, uBeamTop: beamTopU, uBeamCol: beamCol, uTime },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        cullFace: gl.FRONT,
      });
      beamProg.setBlendFunc(gl.ONE, gl.ONE);
      beamMesh = new Mesh(gl, { geometry: beamGeo, program: beamProg });
      beamMesh.frustumCulled = false;
      beamMesh.visible = false;
      beamMesh.setParent(scene);
      disposables.push(beamGeo, beamProg);

      /* Laid once, from a fixed sequence: dust anywhere in the beam, sparks
         in a ring round the formation. */
      let seed = 0x5eed1234;
      const rnd = () => {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
        return seed / 4294967296;
      };
      const n = DUST + SPARKS;
      const at = new Float32Array(n * 4);
      const kind = new Float32Array(n);
      const geo = mineAt.geode;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        if (i < DUST) {
          const r = Math.sqrt(rnd()) * BEAM_R * 0.95;
          at[i * 4] = sky.x + Math.cos(a) * r;
          at[i * 4 + 1] = skyBeam[3] + rnd() * (skyBeamTop - skyBeam[3]);
          at[i * 4 + 2] = sky.z + Math.sin(a) * r;
        } else {
          // Hanging in the geode's hollow, clear of its crystal lining.
          const r = 0.6 + rnd() * (geo.r - 2.6);
          at[i * 4] = geo.x + Math.cos(a) * r;
          at[i * 4 + 1] = geo.y - 1.6 + rnd() * 3.6;
          at[i * 4 + 2] = geo.z + Math.sin(a) * r;
          kind[i] = 1;
        }
        at[i * 4 + 3] = rnd();
      }
      const moteGeo = new Geometry(gl, {
        position: { size: 2, data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]) },
        index: { data: new Uint16Array([0, 1, 2, 0, 2, 3]) },
        aMote: { size: 4, data: at, instanced: 1 },
        aKind: { size: 1, data: kind, instanced: 1 },
      });
      const moteProg = new Program(gl, {
        vertex: MOTE_VERTEX,
        fragment: MOTE_FRAGMENT,
        uniforms: {
          uTime,
          uBeam: beamU,
          uBeamTop: beamTopU,
          uPixel: pixelU,
          uGain: moteGain,
          uDustCol: { value: DUST_COL },
          uSparkCol: { value: SPARK_COL },
        },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        cullFace: false,
      });
      moteProg.setBlendFunc(gl.ONE, gl.ONE);
      moteMesh = new Mesh(gl, { geometry: moteGeo, program: moteProg });
      moteMesh.frustumCulled = false;
      moteMesh.visible = false;
      moteMesh.setParent(scene);
      disposables.push(moteGeo, moteProg);
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
      const stoneCol =
        mt.material === MATERIAL.deep ? DEEP : mt.material === MATERIAL.stone ? STONE : ROCK;
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
        vertex: facesTextured ? BLOCK_VERTEX_TEX : BLOCK_VERTEX,
        fragment: facesTextured ? BLOCK_FRAGMENT_TEX : BLOCK_FRAGMENT,
        uniforms: {
          uAtlas: { value: atlasTex },
          uTile: { value: mt.tile },
          uOreTile: { value: TILES.oreGold },
          uCrackTile: { value: TILES.crack },
          uAoOpen: { value: mt.aoOpen },
          uCornerAO: { value: mt.cornerAO },
          uLightW: { value: mt.lightW },
          uLightC: { value: mt.lightC },
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
          // The open island's light and the sun's shadow, as on the wall.
          ...cut,
          ...(facesTextured ? sunShadow?.uniforms ?? {} : {}),
        },
        depthTest: true,
        depthWrite: true,
        cullFace: gl.BACK,
      });
      if (facesTextured && sunShadow) sunShadow.register(blockProg);
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
        /* On a WebGL2 context each chip carries a patch of the block's own
           picture; without one, its colour. */
        vertex: facesTextured ? CHIP_VERTEX_TEX : CHIP_VERTEX,
        fragment: facesTextured ? CHIP_FRAGMENT_TEX : CHIP_FRAGMENT,
        uniforms: {
          uAtlas: { value: atlasTex },
          uTile: { value: mt.tile },
          uOreTile: { value: TILES.oreGold },
          uLightW: { value: mt.lightW },
          uLightC: { value: mt.lightC },
          uAoOpen: { value: mt.aoOpen },
          uOpen: cut.uOpen,
          uBurstA,
          uBurstB,
          uFloorY: { value: terrain.mine.gallery.floorY + 0.5 },
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

    /* --- the clouds --------------------------------------------------------
       One more draw, outdoors only: underground there is no sky to see them
       against, and no reason to pay for them. */
    let cloudMesh: Mesh | null = null;
    if (layers.sky) {
      const clouds = buildClouds();
      const cloudGeo = new Geometry(gl, {
        position: { size: 3, data: CUBE_POSITION },
        normal: { size: 3, data: CUBE_NORMAL },
        index: { data: CUBE_INDEX },
        aCloud: { size: 4, data: clouds.at, instanced: 1 },
        aCloudSize: { size: 3, data: clouds.size, instanced: 1 },
      });
      const cloudProg = new Program(gl, {
        vertex: CLOUD_VERTEX,
        fragment: CLOUD_FRAGMENT,
        uniforms: { uTime, uFogRange: fogRange, ...skyUniforms },
        depthTest: true,
        depthWrite: true,
        cullFace: gl.BACK,
      });
      cloudMesh = new Mesh(gl, { geometry: cloudGeo, program: cloudProg });
      cloudMesh.frustumCulled = false;
      cloudMesh.renderOrder = -1;
      cloudMesh.setParent(scene);
      disposables.push(cloudGeo, cloudProg);
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
    performance.mark("vx:setup:env");
    const plan = buildScene(terrain.mine, terrain.site);
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
      aPivot: { size: 3, data: batch.pivot, instanced: 1 },
      aColor: { size: 3, data: batch.color, instanced: 1 },
      aTex: { size: 4, data: batch.tex, instanced: 1 },
      aShade: { size: 4, data: batch.shade, instanced: 1 },
      aXform: { size: 4, data: batch.xform, instanced: 1 },
      aMotion: { size: 4, data: batch.motion, instanced: 1 },
      aRot: { size: 3, data: batch.rot, instanced: 1 },
      aRotP: { size: 3, data: batch.rotP, instanced: 1 },
    });
    const figProg = new Program(gl, {
      vertex: textured ? CREW_VERTEX : CREW_VERTEX_GL1,
      fragment: textured ? CREW_FRAGMENT : CREW_FRAGMENT_GL1,
      uniforms: {
        uAtlas: { value: atlasTex },
        uTime,
        uFogRange: fogRange,
        ...lamp,
        ...skyUniforms,
        ...cut,
        ...(sunShadow?.uniforms ?? {}),
      },
      depthTest: true,
      depthWrite: true,
      cullFace: gl.BACK,
    });
    if (sunShadow) sunShadow.register(figProg);
    const figMesh = new Mesh(gl, { geometry: figGeo, program: figProg });
    // Bounds are a unit cube at the origin; every real position is instanced.
    figMesh.frustumCulled = false;
    figMesh.renderOrder = -1;
    figMesh.setParent(scene);
    disposables.push(figGeo, figProg);

    /* --- light at a point ---------------------------------------------------
       Figures are not on the terrain grid, so the baked light has to be read
       for them: daylight from the sky flood, and lantern and crystal light
       from the block-light floods, all at chest height. Without this the crew
       were lit as if they stood in open daylight wherever they were -- the
       face crew glowed in a chamber whose walls were near black. */
    const LUX = (l: number) => (l / 15) ** 2;
    /* Daylight is read for the island as it is at that moment: open, the
       cut lets the sky into every tunnel that faces it. `open` is the same
       number the faces are mixed by, so a figure and the wall behind it
       brighten together. */
    let openNow = 0;
    const lightAt = (wx: number, wy: number, wz: number) => {
      const gx = Math.round(wx + half);
      const gy = Math.round(wy + 1);
      const gz = Math.round(wz + half);
      if (gx < 0 || gz < 0 || gy < 0 || gx >= VOXEL_SIZE || gz >= VOXEL_SIZE || gy >= WORLD_HEIGHT) {
        return { sky: 1, warm: 0, crystal: 0 };
      }
      const k = (gy * VOXEL_SIZE + gz) * VOXEL_SIZE + gx;
      const day = terrain.daylight[k] + (terrain.daylightOpen[k] - terrain.daylight[k]) * openNow;
      return {
        sky: day / 255,
        warm: LUX(terrain.lightW[k]),
        crystal: LUX(terrain.lightC[k]),
      };
    };

    /* The rail road and the lanterns never move: placed once, and then each
       box is given the light at its own position -- a rail in the dark
       incline and a crate in the sun on the ledge are one figure but not one
       light. Lit again whenever the island opens or closes by a step, which
       is what changes the light reaching them. */
    placeFigure(batch, "props", { x: 0, y: 0, z: 0, yaw: 0, hidden: false });
    let propsLitAt = -1;
    const lightProps = () => {
      const sp = batch.span.props;
      for (let i = sp.from; i < sp.to; i++) {
        const L = lightAt(batch.part[i * 3], batch.part[i * 3 + 1] - 1, batch.part[i * 3 + 2]);
        batch.shade[i * 4] = batch.ao[i] * L.sky;
        batch.shade[i * 4 + 2] = L.warm;
        batch.shade[i * 4 + 3] = L.crystal;
      }
      propsLitAt = openNow;
    };
    lightProps();
    /* The parked carts -- on the ledge, on the siding -- and the title over
       the island: placed once and never moved. */
    const placeFixed = () => {
      for (const f of plan.fixed) {
        placeFigure(batch, f.id, {
          x: f.x,
          y: f.y,
          z: f.z,
          yaw: f.yaw,
          hidden: false,
          ...lightAt(f.x, f.y - 0.1, f.z),
        });
      }
    };
    placeFixed();
    /* The title stands over the island in the opening and closing frames.
       Open, the camera is in front of the cut looking into it, and the title
       is a row of letters cut off along the top of the frame. */
    let titleShown: boolean | null = null;
    const placeTitle = (show: boolean) => {
      if (show === titleShown) return;
      titleShown = show;
      placeFigure(batch, "title", {
        x: TITLE_AT[0],
        y: TITLE_AT[1],
        z: TITLE_AT[2],
        yaw: TITLE_YAW,
        hidden: !show,
        sky: 1,
      });
    };
    placeTitle(true);

    /* --- the cart ----------------------------------------------------------
       A pure function of progress, like the camera. It runs out to the find
       empty and comes back loaded, and because nothing about it integrates,
       scrubbing back up the page runs it backwards exactly. */
    const stopsAt = cartStops(terrain.mine);
    const cartAt = (p: number) => ({
      s: cartS(p, stopsAt),
      ...cartLoads(p),
      // In the mine from the moment it opens; nobody sees it before.
      live: p > ACTS[2].from,
    });

    /* A stroke of the pick for someone working on their own: the blow is the
       first 0.9 s of every period, and the rest is the pause between blows. */
    const AMBIENT_STROKE = 0.9;

    /* Everyone at their own tempo, a few percent either side of the clock,
       so two people on the same clip drift in and out of step instead of
       moving as one. From the name, so it is the same on every load. */
    const tempo = new Map(
      crew.map((c) => {
        let h = 2166136261;
        for (let i = 0; i < c.id.length; i++) h = Math.imul(h ^ c.id.charCodeAt(i), 16777619);
        return [c.id, 0.88 + 0.26 * ((h >>> 0) / 4294967296)];
      }),
    );

    /** Walking with the cart: the gait's phase, and how much of a walk it is
        -- none once the cart has stopped. */
    type Pace = { gait: number; amount: number };

    const poseOf = (name: ClipName, c: Stand, t: number, p: number, userU: number, pace?: Pace) => {
      if (name === "swing" && c.user) return clip("swing", t, { u: userU, phase: c.phase });
      if (name === "swing") {
        const period = c.period ?? 2.4;
        const local = (((t + (c.phase ?? 0)) % period) + period) % period;
        const u = local / AMBIENT_STROKE;
        return clip("swing", t, { u: u <= 1 ? u : -1, phase: c.phase });
      }
      if (pace && (name === "walk" || name === "push")) {
        return clip(name, t, { phase: c.phase, gait: pace.gait, amount: pace.amount, lamp: c.tool === "lantern" });
      }
      const amount = c.beat ? smoothstep(c.beat[0], c.beat[1], p) : 1;
      return clip(name, t, { phase: c.phase, period: c.period, amount });
    };

    const poseFor = (c: Stand, t: number, p: number, userU: number, pace?: Pace) => {
      // The visitor's own swing keeps the visitor's timing, not a tempo.
      const tt = c.user ? t : t * (tempo.get(c.id) ?? 1);
      const a = poseOf(c.clip, c, tt, p, userU, pace);
      if (!c.then) return a;
      // Handed over across a sliver of scroll, not cut between frames.
      const k = smoothstep(c.then.at - 0.006, c.then.at + 0.006, p);
      if (k <= 0) return a;
      const b = poseOf(c.then.clip, c, tt, p, userU, pace);
      return k >= 1 ? b : blend(a, b, k);
    };

    /* --- everyone, once per frame -----------------------------------------
       Five small buffer uploads for the whole population. Writing the arrays
       is a few thousand float stores, which is nothing next to the draw calls
       one-figure-per-mesh would cost. */
    const HIDE = { x: 0, y: 0, z: 0, yaw: 0, hidden: true };

    /* A full stride -- a step on each foot -- in route points: a person two
       blocks tall covers about a block and a half in two steps. */
    const STRIDE = 1.5;

    const placeCrew = (t: number, p: number, userU: number) => {
      const cart = cartAt(p);
      const onRail = alongRail(rail, cart.s);
      /* How fast the cart is going, in route points per unit of progress:
         the crew with it walk while it moves and stand once it stops, and
         their feet are set by the distance it has covered -- so they keep
         pace with the ground in both directions and freeze mid-stride when
         the visitor stops scrolling, as the cart does. */
      const speed = Math.abs(cartS(p + 0.0015, stopsAt) - cartS(p - 0.0015, stopsAt)) / 0.003;
      const moving = smoothstep(4, 60, speed);
      const gait = (cart.s * Math.PI * 2) / STRIDE;
      /* The light that reaches the props and the parked carts moves with
         the cut, so it is read again -- in steps, not every frame. */
      if (Math.abs(openNow - propsLitAt) > 0.04 || (openNow === 0) !== (propsLitAt === 0)) {
        lightProps();
        placeFixed();
      }
      placeTitle(openNow < 0.3);

      for (const c of crew) {
        if (p < c.from || p > c.to) {
          placeFigure(batch, c.id, HIDE);
          continue;
        }
        const pose =
          c.rail !== undefined
            ? poseFor(c, t, p, userU, { gait: gait + c.rail * 1.3, amount: moving })
            : poseFor(c, t, p, userU);
        poseFigure(batch, c.id, pose);
        const hop = pose.lift / 16;
        if (c.rail !== undefined) {
          /* Walking with the cart rather than standing somewhere: behind it
             pushing, or ahead of it with the lamp. Measured along the road
             itself, so it follows the road round a bend, and facing the way
             the cart is going. */
          const sAt = cart.s + c.rail;
          const end = rail.length - 1;
          const at = alongRail(rail, Math.min(sAt, end));
          /* Ahead of the cart at the end of the line: on past the buffer,
             onto the turf, rather than standing in the cart's way. */
          if (sAt > end) {
            at.x += Math.sin(at.yaw) * (sAt - end);
            at.z += Math.cos(at.yaw) * (sAt - end);
          }
          placeFigure(batch, c.id, {
            x: at.x,
            y: at.y + 0.5 + hop,
            z: at.z,
            yaw: at.yaw,
            hidden: false,
            ...lightAt(at.x, at.y + 0.5, at.z),
          });
          continue;
        }
        placeFigure(batch, c.id, {
          x: c.x,
          y: c.y + hop,
          z: c.z,
          yaw: c.yaw,
          hidden: false,
          ...lightAt(c.x, c.y, c.z),
        });
      }

      const cartLight = lightAt(onRail.x, onRail.y + 0.5, onRail.z);
      // A rattle on the joints of the rails while it rolls, none at rest.
      const rattle = 0.018 * Math.abs(Math.sin(gait * 2.5)) * moving;
      const cartPlace = {
        x: onRail.x,
        y: onRail.y + 0.5 + rattle,
        z: onRail.z,
        yaw: onRail.yaw,
        ...cartLight,
      };
      placeFigure(batch, "cart", { ...cartPlace, hidden: !cart.live });
      /* A load is raised into the cart as it fills, from below its rim:
         empty, the heap sits inside the body where nothing can see it. */
      const heap = (fill: number) => ({
        ...cartPlace,
        // Never lower than the cart's own floor: it is an open box, seen from below.
        y: cartPlace.y - 0.36 * (1 - fill),
        hidden: !cart.live || fill < 0.02,
      });
      placeFigure(batch, "cartOre", heap(cart.ore));
      placeFigure(batch, "cartLoad", heap(cart.product));

      placeItem(t);

      /* The islets drift: a slow bob and a slower turn, each on its own
         phase, so the four never move as one. */
      for (const it of ISLETS) {
        placeFigure(batch, it.id, {
          x: it.x,
          y: it.y + Math.sin(t * 0.35 + it.spin) * 0.8,
          z: it.z,
          yaw: it.spin + t * 0.04,
          hidden: false,
          sky: 1,
        });
      }
      figGeo.attributes.aXform.needsUpdate = true;
      figGeo.attributes.aMotion.needsUpdate = true;
      figGeo.attributes.aRot.needsUpdate = true;
      figGeo.attributes.aRotP.needsUpdate = true;
      figGeo.attributes.aShade.needsUpdate = true;
    };

    /* --- the piece of ore -------------------------------------------------
       Out of the face as the block breaks, onto the floor in front of it,
       lying there turning for a moment, then off to the bag -- the slot at
       the bottom of the screen -- where it is counted. All of it a function
       of the time since the break, like the debris. */
    const itemFrom = mt
      ? [mt.x + mt.face[0] * 0.7, mt.y, mt.z + mt.face[2] * 0.7]
      : [0, 0, 0];
    const itemRestY =
      (mt ? groundAt(itemFrom[0] + (mt.face[0] * 2.0 * 0.6), itemFrom[2] + (mt.face[2] * 2.0 * 0.6), mt.y + 1) : null) ??
      (mt ? mt.y - 0.5 : 0);
    const ITEM_UP = 2.4;
    const ITEM_OUT = 2.0;
    const GRAVITY = 9;
    const itemLand = mt
      ? (ITEM_UP + Math.sqrt(ITEM_UP * ITEM_UP + 2 * GRAVITY * Math.max(0, itemFrom[1] - (itemRestY + 0.18)))) / GRAVITY
      : 0;
    /** Where the bag is in the world this frame: a point a little way in
        front of the lens, under the middle of the screen. */
    const bagAt = (): [number, number, number] => {
      const D = 2.6;
      const th = Math.tan((camera.fov * Math.PI) / 360);
      const r = camBasis.uCamRight.value;
      const u = camBasis.uCamUp.value;
      const f = camBasis.uCamFwd.value;
      /* Where the page has actually put the bag, as a point on the canvas;
         the middle of the bottom edge when there is none to measure. */
      let [nx, ny] = BAG_NDC;
      const el = bag?.current;
      if (el) {
        const b = el.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        if (b.width > 0 && c.width > 0) {
          nx = ((b.left + b.width / 2 - c.left) / c.width) * 2 - 1;
          ny = 1 - ((b.top + b.height / 2 - c.top) / c.height) * 2;
        }
      }
      const sx = nx * th * camBasis.uAspect.value * D;
      const sy = ny * th * D;
      const c = camera.position;
      return [
        c[0] + f[0] * D + r[0] * sx + u[0] * sy,
        c[1] + f[1] * D + r[1] * sx + u[1] * sy,
        c[2] + f[2] * D + r[2] * sx + u[2] * sy,
      ];
    };
    const placeItem = (t: number) => {
      if (!mt || dropAt < 0) {
        placeFigure(batch, "oreItem", HIDE);
        return;
      }
      // Frozen where it fell under reduced motion: no clock to run it.
      const tau = reduced ? itemLand + 0.4 : t - dropAt;
      if (!reduced && tau >= ITEM_REST + ITEM_FLY) {
        dropAt = -1;
        collected++;
        reportMine();
        placeFigure(batch, "oreItem", HIDE);
        return;
      }
      const fall = Math.min(tau, itemLand);
      const out = ITEM_OUT * fall;
      let x = itemFrom[0] + mt.face[0] * out;
      let z = itemFrom[2] + mt.face[2] * out;
      let y =
        tau < itemLand
          ? itemFrom[1] + ITEM_UP * tau - 0.5 * GRAVITY * tau * tau
          : itemRestY + 0.18 + 0.07 * (1 - Math.cos((tau - itemLand) * 3.2));
      let scale = 1;
      if (tau > ITEM_REST) {
        // Off to the bag on a little arc, shrinking as it goes.
        const k = Math.min(1, (tau - ITEM_REST) / ITEM_FLY);
        const e = k * k * (3 - 2 * k);
        const bag = bagAt();
        x += (bag[0] - x) * e;
        y += (bag[1] - y) * e + 0.8 * Math.sin(Math.PI * k);
        z += (bag[2] - z) * e;
        scale = 1 - 0.6 * e;
      }
      placeFigure(batch, "oreItem", {
        x,
        y,
        z,
        yaw: tau * 2.6,
        hidden: false,
        scale,
        ...lightAt(x, y - 0.5, z),
      });
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

    const shots = shotList(terrain.mine, terrain.site);
    const mine = terrain.mine;

    /* A decaying offset added to the camera on a strike. Separate from the
       path rather than folded into it, so the path stays a pure function of
       progress and scrolling back up still retraces exactly. */
    let shakeX = 0;
    let shakeY = 0;

    /* The scroll-driven camera. A pure function of p, which is what makes
       scrolling back up retrace rather than approximate. */
    const placeJourney = (p: number) => {
      /* The cut first: everything below reads the light the island lets in
         at this moment. */
      const open = openAt(p);
      openNow = open;
      cut.uOpen.value = open;
      cut.uOpenShift.value = openShift(open);
      for (let i = 0; i < fallU.length; i++) {
        if (fallFront[i]) fallU[i].value[1] = 1 - smoothstep(0, 0.25, open);
      }
      const under = underAt(p);
      const find = findAt(p);
      // Only in the geode is there no sky anywhere in frame.
      /* In the geode there is no sky in frame anywhere, and nothing that
         grows on the island's surface: the clouds, the sky and sea pass and
         the plants are not drawn there at all. */
      const outdoors = find < 0.98;
      if (cloudMesh) cloudMesh.visible = outdoors;
      if (envMesh) envMesh.visible = outdoors;
      if (plantMesh) plantMesh.visible = outdoors;
      const f = cameraAt ?? sampleShots(shots, p);
      if (Math.abs(camera.fov - f.fov) > 0.01) camera.perspective({ fov: f.fov });
      camera.position.set(f.pos[0] + shakeX, f.pos[1] + shakeY, f.pos[2]);
      camera.lookAt(f.look);
      commit();

      /* The cap lamp: a fill riding with the camera. Up in the enclosed
         passage and the geode, where nothing else lights the near walls; a
         trace of it in the open section, where the daylight through the cut
         already does. A fill, not the light: at full strength it lit every
         wall the camera faced evenly and the lanterns' pools disappeared. */
      lamp.uLampGain.value = 0.5 * under;
      lamp.uUnder.value = under;
      lamp.uLampPos.value = [f.pos[0], f.pos[1] + 1.6, f.pos[2]];

      /* The find's own light, from the middle of the geode. Baked light
         cannot change, but its gain can: the whole lining brightens as the
         visitor comes into the room, and settles back once they have gone. */
      const geo = mine.geode;
      lamp.uCrystalGain.value = CRYSTAL_GAIN * (1 + 0.1 * find);
      lamp.uLamp2Gain.value =
        0.45 *
        smoothstep(ACTS[4].from + (ACTS[4].to - ACTS[4].from) * 0.45, ACTS[4].to, p) *
        (1 - smoothstep(ACTS[5].from, ACTS[5].at, p));
      lamp.uLamp2Pos.value = [geo.x, geo.y + 0.5, geo.z];

      /* Two shafts of light, never at once: daylight down the skylight into
         the chasm while the mine is open, and at the end the beacon's beam
         up from the depot. One program, moved between them. */
      const beam = smoothstep(0.35, 0.9, open) * (1 - smoothstep(ACTS[5].at, ACTS[5].to, p));
      const fire = smoothstep(
        ACTS[7].from + (ACTS[7].to - ACTS[7].from) * 0.32,
        ACTS[7].from + (ACTS[7].to - ACTS[7].from) * 0.5,
        p,
      );
      const sparks = find;
      if (fire > 0.001) {
        beamU.value = beaconBeam;
        // The light comes up the column from the beacon, not all at once.
        beamTopU.value = beaconBeam[3] + (BEACON_TOP - beaconBeam[3]) * Math.min(1, fire * 1.6);
        const g = BEACON_GAIN * fire;
        beamCol.value = [BEACON_COL[0] * g, BEACON_COL[1] * g, BEACON_COL[2] * g];
      } else {
        beamU.value = skyBeam;
        beamTopU.value = skyBeamTop;
        beamCol.value = [
          BEAM_COL[0] * BEAM_GAIN * beam,
          BEAM_COL[1] * BEAM_GAIN * beam,
          BEAM_COL[2] * BEAM_GAIN * beam,
        ];
      }
      moteGain.value = [fire > 0.001 ? 0 : beam, sparks];
      pixelU.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, gl.drawingBufferHeight);
      // The skylight's shaft is behind the geode's walls from inside it.
      if (beamMesh) beamMesh.visible = (beam > 0.001 && outdoors) || fire > 0.001;
      if (moteMesh) moteMesh.visible = (beam > 0.001 && fire <= 0.001) || sparks > 0.001;

      /* The air in the crystal room takes on the crystal's light, so the
         haze between the visitor and the find glows rather than darkens. */
      lamp.uCaveFog.value = [
        CAVE_FOG[0] + CRYSTAL_FOG[0] * find,
        CAVE_FOG[1] + CRYSTAL_FOG[1] * find,
        CAVE_FOG[2] + CRYSTAL_FOG[2] * find,
      ];
    };

    /* --- the grade ---------------------------------------------------------
       A pure function of progress, like the camera, so scrolling back gives
       back the same picture.

       Exposure rises underground: the eye adapts to a dark room, and a cave
       graded with daylight exposure is a black frame with some lanterns in
       it. Glow and vignette deepen with it -- a lantern in a tunnel should
       bloom far more than a cloud in daylight -- and ease off again for the
       find, which brings its own light. */
    const gradeFor = (p: number): Grade => {
      const under = underAt(p);
      const find = findAt(p);
      /* The delivery is graded toward the end of the afternoon: warmer
         highlights, a touch more colour. The sun itself does not move -- the
         shadows were drawn once -- so this is the whole of the golden hour. */
      const gold = smoothstep(ACTS[7].from, ACTS[7].to, p);
      /* The two places the camera stands in the island's own shadow: on the
         ledge, and at the upper portal. The eye opens up for shade as it does
         for a tunnel -- without it the shaded cliff, which is most of both
         frames, went to black. */
      const at = (i: number, k: number) => ACTS[i].from + (ACTS[i].to - ACTS[i].from) * k;
      const shade = Math.max(
        smoothstep(at(1, 0.25), at(1, 0.7), p) * (1 - smoothstep(at(2, 0.1), at(2, 0.35), p)),
        smoothstep(at(6, 0.75), at(6, 0.95), p) * (1 - smoothstep(at(7, 0.15), at(7, 0.4), p)),
      );
      /* Daylight glows only where it is genuinely brighter than white --
         the sunlit edge of a waterfall, a glint -- and lightly. Underground
         the threshold drops and the glow comes up, because there every
         light in frame is a point source in the dark. */
      /* The find brings its own light, and a lot of it: the geode is lined
         with it on every side, so the eye that adapted for the passage is
         turned back down hard, and the glow kept to the brightest of it --
         at the passage's settings the room was a pale cyan fog. */
      return {
        exposure: 0.8 + 0.55 * under - 0.62 * find + 0.24 * shade,
        bloom: 0.32 + 0.6 * under - 0.42 * find,
        threshold: 1.6 - 0.75 * under + 0.7 * find,
        knee: 0.8 - 0.3 * under,
        saturation: 1.0 + 0.1 * under + 0.08 * gold,
        contrast: 1.05,
        shadowTint: [-0.015, 0.004, 0.025 + 0.02 * under + 0.01 * gold],
        highlightTint: [0.03 + 0.05 * gold, 0.012 + 0.018 * gold, -0.02 - 0.035 * gold],
        toe: 0.09,
        vignette: 0.38 + 0.4 * under,
      };
    };

    /* Set once every program has compiled (program.ts). Nothing draws before
       then but the ?bench timing pass, which would rather wait than measure
       half a scene. */
    let compiled = false;

    /** One frame, through the film pass when there is one. The first of any
        kind -- the loop's, a still, the bench's -- bakes the sun's shadows,
        so nothing samples them before they are drawn. */
    const frame = (p: number) => {
      sunShadow?.bake();
      if (film) film.render(scene, camera, gradeFor(p));
      else renderer.render({ scene, camera });
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
      /* Not before the shaders have compiled: drawing would wait here for
         each of them in turn. The loop's first frame, which under reduced
         motion is this still, comes as soon as they have. */
      if (!compiled) return;
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
          if (blockMesh) blockMesh.visible = live || openNow > 0.001;
          // No debris without motion: chips are the one part of this that
          // cannot be expressed as a still.
          if (chipMesh) chipMesh.visible = false;
        }
        /* The crew still get placed: a still with no people in it is a
           photograph of a building site at four in the morning, and the one
           frame a reduced-motion reader is given should be the one that says
           most. Their poses are frozen, which is the point. */
        placeCrew(STILL_TIME, stillP, -1);
        reportTarget(live);
        /* The readout has to agree with the one frame that exists. Without
           this it reports the surface while the picture shows the pit, which
           is worse than having no readout at all. */
        onFrame?.({ p: stillP, y: camera.position.y });
      } else {
        place(STILL_ANGLE);
      }
      frame(progress ? stillP : 0);
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

    /* The piece of ore that drops when the block breaks: when it dropped, or
       -1 with none in flight, and how many have reached the bag. */
    let dropAt = -1;
    let collected = 0;

    const reportMine = () => {
      onMine?.({ stage, stages: STRIKES, broken, available: Boolean(mt), collected });
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
    /* Tied to the clip, not written down twice: the stone cracks on the
       frame the pick head reaches it. */
    const IMPACT_AT = SWING * SWING_IMPACT;
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
      if (broken) {
        /* Under reduced motion there is no trip to the bag to watch: the
           piece is counted at once and lies where it fell. */
        if (reduced) collected++;
        dropAt = now;
      }
      reportMine();
    };

    /* Where the visitor's stroke is, 0 to 1, or -1 between strokes. */
    const swingU = (t: number) => {
      const u = (t - swingAt) / SWING;
      return u < 0 || u > 1 ? -1 : u;
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
      // A piece still on its way is the visitor's all the same.
      if (dropAt >= 0 && !reduced) collected++;
      dropAt = -1;
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
      film?.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
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

    performance.mark("vx:setup:crew");

    const drawCalls = 1 + (layers.sky || layers.water ? 1 : 0);

    // The GPU timing pass under ?bench, when the browser offers timers.
    let gpuBench: Promise<void> | null = null;
    // Cleared on teardown: the timing pass must not draw into a dead scene.
    let alive = true;
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
      for (let i = 0; i < 60; i++) frame(0);
      sync();

      /* Repeated blocks, not one. A single block of this is worth about as
         much as a single coin toss: measuring the same geometry twice across
         two page loads gave 0.10 and 0.06 ms, so the run-to-run spread was
         as large as the difference being looked for. The minimum is the
         figure to compare -- it is the run least disturbed by whatever else
         the machine was doing. */
      const RUNS = 5;
      const K = 60;
      const samples: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const b0 = performance.now();
        for (let i = 0; i < K; i++) {
          // Nudged each frame so no driver can cache an identical submission.
          place(0.6 + (r * K + i) * 0.0002);
          frame(0);
        }
        sync();
        samples.push((performance.now() - b0) / K);
      }
      samples.sort((a, b) => a - b);

      /* Draw calls in one frame, counted at the GL rather than assumed: the
         ones made while the first framebuffer of the frame is bound are the
         scene's, the rest belong to the film pass. */
      const countDraws = (draw: () => void) => {
        const r = renderer as unknown as Record<string, (...a: unknown[]) => void>;
        const g = gl as unknown as Record<string, (...a: unknown[]) => void>;
        let scene = 0;
        let post = 0;
        let sceneFB: unknown;
        const count = () => {
          const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
          if (sceneFB === undefined) sceneFB = fb;
          if (fb === sceneFB) scene++;
          else post++;
        };
        const wrap = (o: Record<string, (...a: unknown[]) => void>, name: string) => {
          const orig = o[name];
          if (typeof orig !== "function") return () => {};
          o[name] = (...a: unknown[]) => {
            count();
            return orig.apply(o === r ? r : gl, a);
          };
          return () => {
            o[name] = orig;
          };
        };
        const undo = [
          wrap(r, "drawElementsInstanced"),
          wrap(r, "drawArraysInstanced"),
          wrap(g, "drawElements"),
          wrap(g, "drawArrays"),
        ];
        draw();
        undo.forEach((u) => u());
        return { scene, post };
      };

      /* Every station: the camera, the cut, the lights, the crew and the
         cart placed for the act's framed moment each frame -- the work a
         frame of the journey really does -- with progress nudged by a
         millionth so no driver can replay an identical submission. */
      const stations: BenchStation[] = [];
      if (progress) {
        const S_RUNS = 3;
        const S_K = 40;
        for (const a of ACTS) {
          const p0 = a.at;
          const at = (p: number) => {
            placeJourney(p);
            placeCrew(STILL_TIME, p, -1);
            if (blockMesh) blockMesh.visible = (p >= MINE_FROM && p <= MINE_TO) || openNow > 0.001;
            if (chipMesh) chipMesh.visible = false;
          };
          at(p0);
          for (let i = 0; i < 20; i++) frame(p0);
          sync();
          const draws = countDraws(() => frame(p0));
          const runs: number[] = [];
          for (let r = 0; r < S_RUNS; r++) {
            const b0 = performance.now();
            for (let i = 0; i < S_K; i++) {
              const p = p0 + (r * S_K + i) * 1e-6;
              at(p);
              frame(p);
            }
            sync();
            runs.push((performance.now() - b0) / S_K);
          }
          runs.sort((x, y) => x - y);
          stations.push({ act: a.nav, p: p0, msMin: runs[0], msMedian: runs[Math.floor(S_RUNS / 2)], ...draws });
        }
      }

      const result: BenchResult = {
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
        stations,
      };
      onBench?.(result);

      /* The GPU's own time per station. Wall-clock timing on a shared
         machine moved by a factor of seven between two loads of the same
         code -- the compositor, other windows and the GPU's clocks all
         land in it -- so it is backed by timer queries, which count only
         the commands between their two ends. Their results can only arrive
         after the page yields, so this pass is asynchronous, and the render
         loop waits for it. */
      const g2 = gl as WebGL2RenderingContext;
      const tq = textured ? g2.getExtension("EXT_disjoint_timer_query_webgl2") : null;
      if (tq && progress) {
        const tick = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
        gpuBench = (async () => {
          for (const st of stations) {
            if (!alive) return;
            const p0 = st.p;
            placeJourney(p0);
            placeCrew(STILL_TIME, p0, -1);
            if (blockMesh) blockMesh.visible = (p0 >= MINE_FROM && p0 <= MINE_TO) || openNow > 0.001;
            if (chipMesh) chipMesh.visible = false;
            for (let i = 0; i < 4; i++) frame(p0);
            const queries: WebGLQuery[] = [];
            for (let k = 0; k < 8; k++) {
              const q = g2.createQuery();
              if (!q) break;
              g2.beginQuery(tq.TIME_ELAPSED_EXT, q);
              frame(p0);
              g2.endQuery(tq.TIME_ELAPSED_EXT);
              queries.push(q);
              await tick();
              if (!alive) return;
            }
            const ms: number[] = [];
            for (const q of queries) {
              for (let w = 0; w < 30 && !g2.getQueryParameter(q, g2.QUERY_RESULT_AVAILABLE); w++) await tick();
              if (g2.getQueryParameter(q, g2.QUERY_RESULT_AVAILABLE) && !g2.getParameter(tq.GPU_DISJOINT_EXT)) {
                ms.push((g2.getQueryParameter(q, g2.QUERY_RESULT) as number) / 1e6);
              }
              g2.deleteQuery(q);
            }
            ms.sort((x, y) => x - y);
            st.gpuMs = ms.length ? ms[Math.floor(ms.length / 2)] : null;
          }
          if (alive) onBench?.({ ...result, stations: stations.map((st) => ({ ...st })) });
        })();
      }
    }

    let raf = 0;
    let timer = 0;
    let frames = 0;

    /* --- the quality governor ------------------------------------------------
       Once, downward only: if the journey cannot keep up -- the median gap
       between frames, measured over a few seconds of it running, is past
       what forty-odd frames a second allows -- the pixel density drops to
       one. Fill rate is what a weak GPU runs out of first, and a third of
       the pixels is the largest saving that does not change the picture's
       content. Never back up, so it cannot hunt; not under ?bench, which is
       measuring, and not when ?dpr has set the density deliberately. */
    const governed = adaptive && !bench && renderer.dpr > 1;
    const gaps: number[] = [];
    let governedDone = !governed;
    const govern = (gap: number) => {
      if (governedDone) return;
      gaps.push(gap);
      if (gaps.length < 150) return;
      governedDone = true;
      gaps.sort((a, b) => a - b);
      if (gaps[75] > 22) {
        renderer.dpr = 1;
        renderer.setSize(w, h);
        film?.resize(gl.drawingBufferWidth, gl.drawingBufferHeight);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
      }
    };
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
        /* Clamped at BOTH ends. The first frame's timestamp is when that
           frame began, which on a slow enough machine is before t0 was read
           -- measured at 46 seconds before, under load. A negative step
           turns every exp(-dt * k) ease below into a huge negative gain, and
           the block's hover and crack values went to 1e281 and then to NaN
           in the shader, which the glow then spread over a third of the
           screen. */
        const gap = now - lastFrame;
        const dt = Math.min(0.1, Math.max(0, gap / 1000));
        lastFrame = now;
        /* After the first second, which is shader warm-up and not the
           journey -- and only while the page has focus: a browser paces an
           unfocused window's frames itself, at twenty or thirty a second
           however little each one costs, and that is not the GPU falling
           behind. */
        if (t > 1 && visible && !hidden && document.hasFocus()) govern(gap);
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
          /* The block is part of the gallery's wall -- the island leaves a
             hole for it -- so it is drawn whenever the gallery can be seen,
             not only while it can be clicked. */
          if (blockMesh) blockMesh.visible = live || openNow > 0.001;
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
        placeCrew(t, shown, swingU(t));

        onFrame?.({ p: shown, y: camera.position.y });
      } else {
        place(t * 0.12);
      }

      frame(progress ? shown : 0);

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
    /* The page hears the scene is ready, and the loop starts, once every
       program has compiled: the loading screen stays up over the wait rather
       than lifting off an empty canvas. Under ?bench the timing pass has
       compiled them all already, by drawing with them. */
    void whenCompiled(gl).then(() => {
      if (!alive) return;
      compiled = true;
      onReady?.(terrain);
      // Under ?bench, after the GPU timing pass: the loop's frames would land in it.
      if (gpuBench) {
        void gpuBench.then(() => {
          if (alive) raf = requestAnimationFrame(draw);
        });
      } else raf = requestAnimationFrame(draw);
    });

    return () => {
      alive = false;
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
    adaptive,
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
    cameraAt,
    world,
    bag,
  ]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
