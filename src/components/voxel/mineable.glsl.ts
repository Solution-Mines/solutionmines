import { SKY_UNIFORMS, SKY_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN, SHADOW_FN } from "./light.glsl";
import { ATLAS_FN } from "./blocks.glsl";

/* ----------------------------------------------------------------------------
   THE MINEABLE BLOCK, AND WHAT COMES OFF IT

   One cube and a pool of chips, drawn separately from the island because
   both of them move and the island's buffers are uploaded once.

   The block is lit by exactly the same function the island uses, and carries
   the sky access and colour jitter the generator worked out for that cell, so
   until it is pointed at it is indistinguishable from the wall it sits in.
-------------------------------------------------------------------------------*/

export const BLOCK_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 uCenter;
/** Unit vector pointing out of the wall, into the room. */
uniform vec3 uFace;
/** 0 at rest, rising to 1 on a strike and decaying. Never negative. */
uniform float uPunch;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying vec3 vLocal;

void main() {
  /* Out of the wall, and never into it.

     The block is flush in its cell, and the five neighbours around it never
     emitted faces toward it -- there was a solid block there, so those faces
     were culled. So anything that pulls this cube BACK, or shrinks it, opens
     a gap at the edges with nothing behind it, and you see the far plane
     through the wall. Translating outward along the face it presents, and
     swelling slightly rather than shrinking, is the only motion that cannot
     tear the rock open. */
  vec3 local = position * (1.0 + 0.05 * uPunch);
  vec3 world = uCenter + local + uFace * (0.16 * uPunch);

  vLocal = position;
  vNormal = normal;
  vWorld = world;
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const BLOCK_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uRock;
uniform vec3 uOre;
uniform vec3 uCenter;
uniform float uAO;
uniform float uTint;
/** How far the fracture has spread, 0..1. */
uniform float uCrack;
/** How far the stone has given way to what is under it, 0..1. */
uniform float uBroken;
/** Pointed at: hover or keyboard focus. */
uniform float uHot;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying vec3 vLocal;

${SKY_FN}
${LIGHT_FN}

void main() {
  vec3 n = vNormal;
  vec3 an = abs(n);

  /* Face-local coordinates. Every normal is axis-aligned, so dropping the
     axis the face points along gives a flat 2D frame per face, which is what
     a crack pattern needs -- a 3D noise would wrap round the corners and
     read as marble rather than damage. */
  vec2 uv = an.x > 0.5 ? vLocal.zy : (an.y > 0.5 ? vLocal.xz : vLocal.xy);

  /* Radial fracture: spokes out of the impact point, each one reaching a
     different distance, all of them growing with uCrack. Concentric rings
     would read as a target; what a struck stone does is split. */
  float r = length(uv) * 2.0;
  // atan(0, 0) is undefined, and one undefined pixel is one too many now.
  float a = atan(uv.y, uv.x + 1e-5);
  float sect = 6.2831853 / 7.0;
  float idx = floor(a / sect);
  float h = fract(sin(idx * 127.1 + 11.3) * 43758.5453);
  /* Offset from the middle of this sector, jittered per spoke so the star is
     not symmetrical. Multiplied by the radius below, which turns an angular
     width into a constant one -- without that the spokes are wedges. */
  float off = a - (idx + 0.5) * sect + (h - 0.5) * 0.55;
  float line = 1.0 - smoothstep(0.0, 0.05, abs(off) * max(r, 0.12));
  /* Never zero: smoothstep with both edges equal is undefined, and at rest,
     where uCrack is 0, it was -- on every pixel of the block. */
  float reach = max(uCrack * (0.6 + h * 0.8), 1e-3);
  float along = 1.0 - smoothstep(reach * 0.78, reach, r);
  float core = 1.0 - smoothstep(0.0, 0.07 + uCrack * 0.1, r);
  float crack = clamp(max(core, line * along), 0.0, 1.0);

  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + uCenter.x * 1.7 + uCenter.y * 1.1 + uCenter.z * 2.3);

  vec3 col = mix(uRock, uOre, uBroken) * uTint;

  /* The same rim darkening the island's faces get. Not decoration here --
     this block is meant to be indistinguishable from the wall it sits in
     until it is pointed at, and a block without the edge every neighbouring
     block has would announce itself from across the chamber. */
  float rim = smoothstep(0.86, 1.0, max(abs(uv.x), abs(uv.y)) * 2.0);
  col *= 1.0 - rim * 0.07;

  // The fracture itself is a shadow: a split in stone has no light in it.
  col = mix(col, col * 0.2, crack * 0.85);
  /* And what is at the bottom of the split is the ore -- visible in the
     deepest part of the cracks before the block gives way at all, which is
     the whole promise the interaction is making. */
  col = mix(col, uOre * (0.85 + 0.3 * glint), crack * crack * (0.3 + 0.7 * uBroken));

  vec3 lit = voxelLight(col, n, uAO, vWorld, vRay, vDepth, 0.0, uBroken, glint);

  /* The ore in the fracture lights the fracture. Additive, and it has to be:
     this block sits in a wall whose sky access is 0.035, so a crack painted
     as a DARKER patch on an already near-black face is no feedback at all.
     What the visitor is being shown is that there is something behind the
     stone, and the only way to show it in the dark is to let it shine. */
  lit += toLinear(uOre) * crack * crack * (0.09 + 0.26 * uBroken);

  /* The affordance: an outline around each face rather than a wash over the
     whole block. At this distance a voxel is read by its edges, and a glow
     over the middle just looks like the lamp moved. */
  vec2 e = abs(uv) * 2.0;
  float outline = smoothstep(0.82, 0.98, max(e.x, e.y));
  lit += uHot * (outline * 0.30 + 0.035) * toLinear(vec3(1.0, 0.84, 0.52));

  gl_FragColor = vec4(outColor(lit), 1.0);
}
`;

/* --- the chips ------------------------------------------------------------
   A fixed pool of small cubes, simulated entirely in the vertex shader from
   a burst origin and a start time. Nothing is uploaded per frame and nothing
   is stepped on the CPU: a chip's whole life is a function of how long ago
   its burst happened, so the pool costs one draw and two uniforms.

   Two burst slots, alternating, so a second strike does not cut the first
   one's debris off mid-air. */
export const CHIP_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
/** Per chip: direction and size jitter, -1..1. */
attribute vec3 aSeed;
/** Per chip: which burst slot it belongs to, 0 or 1. */
attribute float aSlot;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
/** xyz origin, w the time the burst started. Negative w means unused. */
uniform vec4 uBurstA;
uniform vec4 uBurstB;
uniform vec3 uFace;
uniform float uTime;
uniform float uFloorY;
uniform float uLife;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying float vFade;
varying float vOre;

void main() {
  vec4 burst = aSlot < 0.5 ? uBurstA : uBurstB;
  float age = uTime - burst.w;

  if (burst.w < 0.0 || age < 0.0 || age > uLife) {
    /* Collapse to a point outside the clip volume. The pool is a fixed size
       on purpose -- that is what "bounded" means here -- so dead chips are
       clipped rather than removed, and the draw never changes shape. */
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Biased out of the wall, so nothing sprays backwards through the rock.
  vec3 dir = normalize(uFace * 1.1 + aSeed);
  float speed = 1.6 + abs(aSeed.x) * 2.6;
  vec3 p = burst.xyz + dir * speed * age + vec3(0.0, -4.6 * age * age, 0.0);
  float size = 0.055 + abs(aSeed.z) * 0.055;
  // Bounded below as well: chips come to rest on the floor of the chamber
  // instead of falling out through the bottom of the island.
  p.y = max(p.y, uFloorY + size);

  float t = age / uLife;
  vFade = 1.0 - smoothstep(0.6, 1.0, t);
  // Roughly half the debris is ore rather than the stone over it.
  vOre = step(0.45, abs(aSeed.y));

  vec3 world = p + position * size * (0.6 + 0.4 * vFade);
  vNormal = normal;
  vWorld = world;
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const CHIP_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec3 uRock;
uniform vec3 uOre;
uniform float uAO;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying float vFade;
varying float vOre;

${SKY_FN}
${LIGHT_FN}

void main() {
  vec3 col = mix(uRock, uOre, vOre);
  float glint = 0.5 + 0.5 * sin(uTime * 1.6);
  /* A little more sky access than the wall they came off: they are loose in
     the room rather than set in it, and at the wall's 0.03 they would be
     invisible against it. */
  vec3 lit = voxelLight(col, vNormal, uAO + 0.12, vWorld, vRay, vDepth, 0.0, vOre, glint);
  /* Fading to black rather than to transparent. The chamber behind them is
     nearly black anyway, and staying opaque keeps them in the depth buffer
     where they belong -- a blended pool would need sorting. */
  gl_FragColor = vec4(outColor(lit * vFade), 1.0);
}
`;

/* --- the textured block -------------------------------------------------------
   The same block on a WebGL2 context, where the island around it is textured,
   contact-shadowed and lit by the lanterns. It has to match all three or it
   announces itself in the wall: so it samples the tile the generator gave its
   cell, takes the four corners of occlusion and block light worked out for
   its room-facing face, and turns into a textured gold ore block -- not a
   flat yellow cube -- as it breaks. */
export const BLOCK_VERTEX_TEX = /* glsl */ `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 uCenter;
uniform vec3 uFace;
uniform float uPunch;

out vec3 vNormal;
out vec3 vWorld;
out vec3 vRay;
out float vDepth;
out vec3 vLocal;

void main() {
  // Out of the wall and never into it -- see BLOCK_VERTEX.
  vec3 local = position * (1.0 + 0.05 * uPunch);
  vec3 world = uCenter + local + uFace * (0.16 * uPunch);
  vLocal = position;
  vNormal = normal;
  vWorld = world;
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const BLOCK_FRAGMENT_TEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform highp sampler2D uAtlas;
uniform float uTile;
uniform float uOreTile;
/** The first of the ten crack-stage tiles. */
uniform float uCrackTile;
/** Its sky access with the island open, mixed in by uOpen. */
uniform float uAoOpen;
uniform vec4 uCornerAO;
uniform vec4 uLightW;
uniform vec4 uLightC;
uniform vec3 uOre;
uniform vec3 uCenter;
uniform float uAO;
uniform float uTint;
uniform float uCrack;
uniform float uBroken;
uniform float uHot;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

in vec3 vNormal;
in vec3 vWorld;
in vec3 vRay;
in float vDepth;
in vec3 vLocal;

out vec4 fragColor;

${SKY_FN}
${LIGHT_FN}
${ATLAS_FN}
${SHADOW_FN}

void main() {
  vec3 n = vNormal;
  vec3 an = abs(n);

  /* The island's face bases, so the tile and the four corners land the way
     round they do on the neighbouring blocks. */
  vec3 t;
  vec3 b;
  if (n.x > 0.5)       { t = vec3(0.0, 0.0, -1.0); b = vec3(0.0, 1.0, 0.0); }
  else if (n.x < -0.5) { t = vec3(0.0, 0.0, 1.0);  b = vec3(0.0, 1.0, 0.0); }
  else if (n.y > 0.5)  { t = vec3(1.0, 0.0, 0.0);  b = vec3(0.0, 0.0, -1.0); }
  else if (n.y < -0.5) { t = vec3(1.0, 0.0, 0.0);  b = vec3(0.0, 0.0, 1.0); }
  else if (n.z > 0.5)  { t = vec3(1.0, 0.0, 0.0);  b = vec3(0.0, 1.0, 0.0); }
  else                 { t = vec3(-1.0, 0.0, 0.0); b = vec3(0.0, 1.0, 0.0); }
  vec2 fuv = vec2(dot(vLocal, t), dot(vLocal, b)) + 0.5;

  // Footprint from the cube's own coordinates: no branch, so no bad derivatives.
  vec3 fwl = fwidth(vLocal) * 16.0;
  float foot = max(fwl.x, max(fwl.y, fwl.z));

  int code = int(uTile + 0.5);
  vec2 img = vec2(fuv.x, 1.0 - fuv.y);
  vec3 rock = tileSample(code & 255, turnUV(img, (code >> 8) & 3), foot).rgb;
  vec4 ore = tileSample(int(uOreTile + 0.5), img, foot);
  vec3 col = mix(rock, ore.rgb, uBroken) * uTint;

  /* The fracture: one of the ten stages of a block giving way, drawn in
     the atlas the way the game this is built on draws them, and chosen by
     how far through the strikes the visitor is. As the crack value eases up
     after a blow it steps through the stages in between, so the stone is
     seen splitting rather than switching. Gone once the block is open. */
  vec2 uv = an.x > 0.5 ? vLocal.zy : (an.y > 0.5 ? vLocal.xz : vLocal.xy);
  float crack = 0.0;
  if (uCrack > 0.02) {
    int stage = min(9, int(uCrack * 10.0));
    crack = tileSample(int(uCrackTile + 0.5) + stage, img, foot).a * (1.0 - uBroken);
  }
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + uCenter.x * 1.7 + uCenter.y * 1.1 + uCenter.z * 2.3);

  col = mix(col, col * 0.2, crack * 0.85);
  col = mix(col, uOre * (0.85 + 0.3 * glint), crack * crack * (0.3 + 0.7 * uBroken));

  // The neighbours' joint darkening, at the same strength for the same footprint.
  float edge = smoothstep(0.86, 1.0, max(abs(fuv.x - 0.5), abs(fuv.y - 0.5)) * 2.0);
  col *= 1.0 - edge * 0.07 * smoothstep(1.0, 3.0, log2(max(foot, 1e-4)));

  /* Lit exactly as the island lights the wall around it -- the same call
     with the same inputs, the open island's sky access and the same sun
     shadow included -- so at rest it cannot be told apart. */
  vec3 albedoL = toLinear(col);
  float occl = bilerp(uCornerAO, fuv);
  float emit = ore.a * uBroken * 1.5 * (0.8 + 0.4 * glint);
  float ao = mix(uAO, uAoOpen, uOpen);
  vec3 lit = voxelShade(albedoL, n, ao, occl, sunShadow(vWorld, n), emit, vWorld, 0.0);
  lit += blockLit(albedoL, bilerp(uLightW, fuv), bilerp(uLightC, fuv), uCenter, uTime) * occl;

  /* The ore in the fracture lights the fracture -- see BLOCK_FRAGMENT. Past
     white once it is open, so the split itself glows. */
  lit += toLinear(uOre) * crack * crack * (0.2 + 0.9 * uBroken);
  vec2 e = abs(uv) * 2.0;
  float outline = smoothstep(0.82, 0.98, max(e.x, e.y));
  lit += uHot * (outline * 0.30 + 0.035) * toLinear(vec3(1.0, 0.84, 0.52));

  fragColor = vec4(outColor(voxelFog(lit, vRay, vDepth)), 1.0);
}
`;

/* --- textured debris --------------------------------------------------------
   The chips on a WebGL2 context: each one carries a four-by-four patch of
   the block it came off -- the stone's own texture, or the ore's -- the way
   a block breaking in the game this is built on throws out pieces of its own
   picture rather than coloured dust. And they tumble until they land. */
export const CHIP_VERTEX_TEX = /* glsl */ `#version 300 es
precision highp float;

in vec3 position;
in vec3 normal;
in vec3 aSeed;
in float aSlot;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform vec4 uBurstA;
uniform vec4 uBurstB;
uniform vec3 uFace;
uniform float uTime;
uniform float uFloorY;
uniform float uLife;

out vec3 vNormal;
out vec3 vWorld;
out vec3 vRay;
out float vDepth;
out float vFade;
out vec3 vLocal;
flat out float vOre;
flat out vec2 vPatch;

vec3 turn(vec3 v, vec3 axis, float a) {
  return v * cos(a) + cross(axis, v) * sin(a) + axis * dot(axis, v) * (1.0 - cos(a));
}

void main() {
  vec4 burst = aSlot < 0.5 ? uBurstA : uBurstB;
  float age = uTime - burst.w;
  if (burst.w < 0.0 || age < 0.0 || age > uLife) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // The same flight as the untextured chips -- see CHIP_VERTEX.
  vec3 dir = normalize(uFace * 1.1 + aSeed);
  float speed = 1.6 + abs(aSeed.x) * 2.6;
  float size = 0.055 + abs(aSeed.z) * 0.055;
  vec3 v = dir * speed;
  vec3 p = burst.xyz + v * age + vec3(0.0, -4.6 * age * age, 0.0);
  /* When it reaches the floor, from the same fall: it stops turning there,
     because a chip lying on the ground and still spinning is a chip on a
     wire. */
  float drop = max(burst.y - (uFloorY + size), 0.0);
  float land = (v.y + sqrt(v.y * v.y + 4.0 * 4.6 * drop)) / (2.0 * 4.6);
  p.y = max(p.y, uFloorY + size);

  float t = age / uLife;
  vFade = 1.0 - smoothstep(0.6, 1.0, t);
  vOre = step(0.45, abs(aSeed.y));
  // Which patch of the picture: four texels square, anywhere in the tile.
  vPatch = floor(fract(abs(aSeed.xz) * vec2(7.13, 3.71) + 0.31) * 12.0);

  vec3 axis = normalize(aSeed + vec3(0.001, 0.002, 0.0));
  float a = min(age, land) * (7.0 + 6.0 * abs(aSeed.y));
  vec3 world = p + turn(position * size * (0.6 + 0.4 * vFade), axis, a);
  vLocal = position;
  vNormal = turn(normal, axis, a);
  vWorld = world;
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const CHIP_FRAGMENT_TEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform highp sampler2D uAtlas;
uniform float uTile;
uniform float uOreTile;
uniform vec4 uLightW;
uniform vec4 uLightC;
uniform float uAO;
uniform float uAoOpen;
uniform float uOpen;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

in vec3 vNormal;
in vec3 vWorld;
in vec3 vRay;
in float vDepth;
in float vFade;
in vec3 vLocal;
flat in float vOre;
flat in vec2 vPatch;

out vec4 fragColor;

${SKY_FN}
${LIGHT_FN}
${ATLAS_FN}

void main() {
  /* Faces are picked from the chip's own frame, before it tumbled: the
     patch stays painted on the chip as it turns. */
  vec3 an = abs(vLocal) * 2.0;
  vec2 uv = (an.x > 0.99 ? vLocal.zy : (an.y > 0.99 ? vLocal.xz : vLocal.xy)) + 0.5;
  vec2 tuv = (vPatch + uv * 4.0) / 16.0;
  int code = int(uTile + 0.5);
  vec4 tex = vOre > 0.5 ? tileTexel(int(uOreTile + 0.5), tuv, 0) : tileTexel(code & 255, tuv, 0);
  vec3 albedoL = toLinear(tex.rgb);
  vec3 n = normalize(vNormal);
  /* A little more sky than the wall they came off: they are loose in the
     room rather than set in it. In the sun only with the island open. */
  float ao = mix(uAO, uAoOpen, uOpen) + 0.12;
  vec3 lit = voxelShade(albedoL, n, ao, 1.0, uOpen, tex.a * vOre * 1.2, vWorld, 0.0);
  lit += blockLit(albedoL, dot(uLightW, vec4(0.25)), dot(uLightC, vec4(0.25)), vWorld, uTime);
  // To black rather than to clear: opaque keeps them in the depth buffer.
  fragColor = vec4(outColor(voxelFog(lit * vFade, vRay, vDepth)), 1.0);
}
`;
