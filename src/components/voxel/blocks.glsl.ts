import { SKY_UNIFORMS, SKY_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN, SHADOW_FN } from "./light.glsl";

/* ----------------------------------------------------------------------------
   TEXTURED FACES

   The island's face path, rebuilt around the atlas. Three things are new and
   between them they are most of the change in how the scene looks:

   1. A 16x16 pixel texture on every face, fetched texel-exact with
      texelFetch -- no filtering, so pixels stay pixels up close, and no
      bleeding between neighbouring tiles in the atlas.

   2. Its own mip selection. The footprint of one texel on screen picks a
      level of the chain built in atlas.ts, blended with the next, so a cliff
      in the distance resolves to its averaged colour instead of shimmering.
      The atlas is laid out so every level keeps each tile in its own block
      of texels, down to level 4 where a tile is one texel: its average.

   3. Per-corner ambient occlusion and block light, interpolated bilinearly
      across the face in the fragment shader rather than by the rasteriser.
      Letting the rasteriser do it splits every quad along one diagonal and
      the shadow in a corner comes out as a triangle; bilinear in the fragment
      shader is the same everywhere on the face.

   GLSL ES 3.00, so WebGL2 only. The renderer falls back to the flat-colour
   path on a context without it.
-------------------------------------------------------------------------------*/

/* Each face's frame, from its id. Each basis satisfies cross(t, b) == n,
   which keeps the winding counter-clockwise from outside -- and the SAME
   bases are written out in the emitter, which samples the corners in this
   frame. Change one and every contact shadow on the island moves to the
   wrong corner of its block. Shared with the shadow pass, which has to put
   every face exactly where this one does. */
export const FACE_BASIS = /* glsl */ `
void faceBasis(float face, out vec3 n, out vec3 t, out vec3 b) {
  if (face < 0.5)      { n = vec3( 1.0, 0.0, 0.0); t = vec3( 0.0, 0.0,-1.0); b = vec3(0.0, 1.0, 0.0); }
  else if (face < 1.5) { n = vec3(-1.0, 0.0, 0.0); t = vec3( 0.0, 0.0, 1.0); b = vec3(0.0, 1.0, 0.0); }
  else if (face < 2.5) { n = vec3( 0.0, 1.0, 0.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 0.0,-1.0); }
  else if (face < 3.5) { n = vec3( 0.0,-1.0, 0.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 0.0, 1.0); }
  else if (face < 4.5) { n = vec3( 0.0, 0.0, 1.0); t = vec3( 1.0, 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); }
  else                 { n = vec3( 0.0, 0.0,-1.0); t = vec3(-1.0, 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); }
}
`;

export const BLOCK_FACE_VERTEX = /* glsl */ `#version 300 es
precision highp float;

in vec3 position;
in vec3 aOffset;
in float aFace;
in float aMaterial;
in float aAO;
in float aTint;
in float aTile;
in vec4 aCornerAO;
in vec4 aLightW;
in vec4 aLightC;
/** Which half of the cut the face moves with, and whether it is on the cut;
    and its sky access with the island open. See terrain.ts. */
in float aHalf;
in float aAoOpen;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
/** How far open the island is, and where the half that goes has got to. */
uniform float uOpen;
uniform vec3 uOpenShift;

out vec3 vNormal;
/** Where the face was before any slide: shadows are looked up there. */
out vec3 vRest;
/** The face's half flag, passed on: which half, and whether it is the cut. */
flat out float vHalf;
out vec3 vWorld;
out vec3 vRay;
out float vDepth;
out vec2 vFaceUV;
flat out float vMaterial;
flat out float vAO;
flat out float vTint;
flat out float vTile;
flat out vec3 vCell;
flat out vec4 vCornerAO;
flat out vec4 vLightW;
flat out vec4 vLightC;
${FACE_BASIS}
void main() {
  /* The cross-section exists only while the island is open: closed, its
     faces are collapsed off-screen, which costs nothing. */
  bool section = aHalf > 1.5;
  if (section && uOpen < 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  bool front = mod(aHalf, 2.0) > 0.5;

  // The quad is turned into place from its face id.
  vec3 n, t, b;
  faceBasis(aFace, n, t, b);

  vec3 world = aOffset + n * 0.5 + t * position.x + b * position.y;
  vRest = world;
  vHalf = aHalf;
  if (front) world += uOpenShift;

  vFaceUV = position.xy;
  vNormal = n;
  vWorld = world;
  vRay = world - cameraPosition;
  vMaterial = aMaterial;
  /* Open, a face of the half that stays sees the sky through the cut. Not
     for the falls, whose slot carries how far down the fall they are. */
  vAO = aMaterial > 6.5 && aMaterial < 7.5 ? aAO : mix(aAO, aAoOpen, uOpen);
  vTint = aTint;
  vTile = aTile;
  vCell = aOffset;
  vCornerAO = aCornerAO;
  vLightW = aLightW;
  vLightC = aLightC;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

/** Atlas sampling, shared by every textured program. */
export const ATLAS_FN = /* glsl */ `
/* One texel of a block tile at a mip level. Tiles are 16 texels at level 0
   and halve per level, and the atlas grid halves with them, so the origin of
   a tile at any level is its slot times the tile size at that level. */
vec4 tileTexel(int tile, vec2 tuv, int level) {
  int size = 16 >> level;
  ivec2 org = ivec2(tile & 15, tile >> 4) * size;
  ivec2 tx = clamp(ivec2(floor(tuv * float(size))), ivec2(0), ivec2(size - 1));
  return texelFetch(uAtlas, org + tx, level);
}

/* A tile at the level its on-screen size calls for, blended with the next
   one down so the switch between levels is a fade rather than a pop.

   Biased a quarter-level sharp. Exactly one texel per pixel is where pixel
   art looks its best and also where it starts to crawl; a little under that
   keeps it crisp without the shimmer.

   RGB is the colour, A how much light the texel gives off -- see atlas.ts. */
vec4 tileSample(int tile, vec2 tuv, float foot) {
  float lod = clamp(log2(max(foot, 1e-4)) - 0.25, 0.0, 4.0);
  int l0 = int(floor(lod));
  int l1 = min(l0 + 1, 4);
  return mix(tileTexel(tile, tuv, l0), tileTexel(tile, tuv, l1), fract(lod));
}

/* The packed quarter-turn: bits 8 and 9 of the tile number. */
vec2 turnUV(vec2 tuv, int turn) {
  if (turn == 1) return vec2(1.0 - tuv.y, tuv.x);
  if (turn == 2) return 1.0 - tuv;
  if (turn == 3) return vec2(tuv.y, 1.0 - tuv.x);
  return tuv;
}

float bilerp(vec4 v, vec2 uv) {
  return mix(mix(v.x, v.y, uv.x), mix(v.z, v.w, uv.x), uv.y);
}
`;

export const BLOCK_FACE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform highp sampler2D uAtlas;
uniform vec3 uWaterFoam;
uniform float uTime;
/* The crystal's own light, turned up while the find is in view. */
uniform float uCrystalEmit;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

in vec3 vNormal;
in vec3 vRest;
flat in float vHalf;
in vec3 vWorld;
in vec3 vRay;
in float vDepth;
in vec2 vFaceUV;
flat in float vMaterial;
flat in float vAO;
flat in float vTint;
flat in float vTile;
flat in vec3 vCell;
flat in vec4 vCornerAO;
flat in vec4 vLightW;
flat in vec4 vLightC;

out vec4 fragColor;

${SKY_FN}
${LIGHT_FN}
${SHADOW_FN}
${ATLAS_FN}

void main() {
  vec3 n = vNormal;
  int mat = int(vMaterial + 0.5);
  /* Not called 'packed': that is a reserved word in GLSL ES 3.00, and the
     compiler rejects the whole program over it. */
  int code = int(vTile + 0.5);
  int tile = code & 255;

  // Position on the face in its own basis, 0..1: t across, b up.
  vec2 uv = vFaceUV + 0.5;
  /* Texels per pixel, taken before any scrolling or turning so a texture
     wrapping round does not read as a sudden change of scale. */
  vec2 fw = fwidth(uv) * 16.0;
  float foot = max(fw.x, fw.y);

  // Image space: row 0 is the TOP of the tile, which is how grass hangs.
  vec2 tuv = turnUV(vec2(uv.x, 1.0 - uv.y), (code >> 8) & 3);
  /* Water moves. The falls scroll down fast, the ponds drift slowly; both in
     whole texels, because a texture sliding by fractions of a pixel stops
     looking like pixel art and starts looking like a smeared photo. */
  if (mat == 7) tuv.y = fract(tuv.y - floor(uTime * 12.0) / 16.0);
  if (mat == 6) tuv.x = fract(tuv.x + floor(uTime * 2.0) / 16.0);
  // Lava creeps, a texel at a time, slower than water.
  if (mat == 20) tuv = fract(tuv + vec2(floor(uTime * 1.5), floor(uTime * 0.8)) / 16.0);

  vec4 texel = tileSample(tile, tuv, foot);
  vec3 col = texel.rgb;

  if (mat == 7) {
    /* vAO carries how far down the fall this block is, not sky access -- see
       the emitter. White water where it leaves the lip and again where it
       hits the sea. */
    float crest = 1.0 - smoothstep(0.0, 0.055, vAO);
    float base = smoothstep(0.90, 1.0, vAO);
    col = mix(col, uWaterFoam, max(crest, base) * 0.8);
  } else if (mat == 6) {
    float r = sin(vWorld.x * 1.7 + uTime * 1.3) + sin(vWorld.z * 2.1 - uTime * 0.9);
    col = mix(col, uWaterFoam, 0.1 + r * 0.05);
  }

  col *= vTint;

  /* The rim darkening the flat path relied on, now only where the texture
     has averaged away. Up close the texture draws its own blocks; at a
     distance, where it cannot, the joint is what keeps a cliff from reading
     as one sheet. */
  float lod = log2(max(foot, 1e-4));
  float edge = smoothstep(0.86, 1.0, max(abs(vFaceUV.x), abs(vFaceUV.y)) * 2.0);
  col *= 1.0 - edge * 0.07 * smoothstep(1.0, 3.0, lod);

  float isWater = (mat == 6 || mat == 7) ? 1.0 : 0.0;
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vCell.x * 1.7 + vCell.y * 1.1 + vCell.z * 2.3);

  /* What the texel gives off itself, by material. Crystal is the one thing
     the story asks to BE a light source, so its facets run well past white
     and bloom; the metals catch the eye without competing with it. */
  float glow = mat == 11 ? 1.5 * uCrystalEmit
             : mat == 10 ? 1.5
             : mat == 9 ? 1.0
             : mat == 17 ? 0.6
             : mat == 18 ? 1.6
             : mat == 19 ? 1.2
             : mat == 20 ? 3.6
             : 0.0;
  // Lava breathes, slowly, cell by cell.
  float pulse = mat == 20 ? 0.75 + 0.5 * sin(uTime * 1.1 + vCell.x * 0.7 + vCell.z * 0.9) : 0.8 + 0.4 * glint;
  float emit = texel.a * glow * pulse;

  vec3 albedoL = toLinear(col);
  float occl = bilerp(vCornerAO, uv);
  float sun = mod(vHalf, 2.0) > 0.5 ? sunShadowClosed(vRest, n) : sunShadow(vRest, n);
  /* The cut face is square to the sun and has nothing in front of it, so
     at full light it is the brightest thing in the frame -- a flat wall the
     size of the island, with the tunnels it was cut to show as dark slots
     in it. A cutaway drawing keeps its section in a half-tone for exactly
     this reason, and so does this. */
  float cutFace = step(1.5, vHalf);
  sun *= 1.0 - 0.45 * cutFace;
  vec3 lit = voxelShade(albedoL, n, vAO * (1.0 - 0.18 * cutFace), occl, sun, emit, vWorld, isWater);
  /* Contact shadow on block light too, which is what it does in every game
     that has it: a lantern in a corner still leaves the corner darker than
     the open wall. */
  lit += blockLit(albedoL, bilerp(vLightW, uv), bilerp(vLightC, uv), vCell, uTime) * occl;

  fragColor = vec4(outColor(voxelFog(lit, vRay, vDepth)), 1.0);
}
`;
