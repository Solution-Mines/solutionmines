import { SKY_UNIFORMS, SKY_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN, SHADOW_FN } from "./light.glsl";
import { ATLAS_FN } from "./blocks.glsl";

/* ----------------------------------------------------------------------------
   ATMOSPHERE

   The clouds. Opaque and blocky -- the blocky kind, not the soft kind: a
   soft volumetric cloud next to a voxel island reads as two different
   pictures pasted together. Lit by the sun and the sky like everything else,
   with the same aerial haze as the island so a far bank sinks into the
   horizon instead of sitting on top of it.

   GLSL ES 1.00, so it works on any WebGL context.
-------------------------------------------------------------------------------*/

export const CLOUD_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
/** Centre xyz, and a phase for the drift. */
attribute vec4 aCloud;
attribute vec3 aCloudSize;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vRay;
varying float vDepth;

void main() {
  /* A slow wander rather than a conveyor belt. Clouds that all slide one way
     across the frame have to wrap round somewhere, and the wrap is visible;
     a few units of drift about where each was laid out never is. */
  vec3 c = aCloud.xyz + vec3(
    4.0 * sin(uTime * 0.05 + aCloud.w),
    0.0,
    1.5 * sin(uTime * 0.037 + aCloud.w * 1.7)
  );
  vec3 world = c + position * aCloudSize;
  vNormal = normal;
  vRay = world - cameraPosition;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const CLOUD_FRAGMENT = /* glsl */ `
precision highp float;

uniform vec2 uFogRange;
${SKY_UNIFORMS}

varying vec3 vNormal;
varying vec3 vRay;
varying float vDepth;

${SKY_FN}

void main() {
  vec3 n = normalize(vNormal);
  /* Lit by the same sun and sky as the island, not by six constants: a warm
     top where the sun lands, and sides and undersides that see only the
     blue of the sky around them. That is what gives a cloud volume -- the
     flat white boxes read as stickers on the sky, and at the film pass's
     exposure they bloomed. */
  vec3 sunL = toLinear(uSunTint) * 2.2;
  vec3 skyL = mix(toLinear(uSkyHorizon), toLinear(uSkyMid), 0.55);
  float ndl = max(dot(n, uSunDir), 0.0);
  float up = n.y * 0.5 + 0.5;
  vec3 albedo = vec3(0.84, 0.86, 0.9);
  vec3 lit = albedo * (sunL * ndl * 0.55 + skyL * (0.5 + 0.4 * up));
  float fog = smoothstep(uFogRange.x, uFogRange.y, vDepth);
  /* Edge on. With the camera level with the layer, a far bank two blocks
     thick is a line a pixel high, and a ring of them is a dashed rule drawn
     across the sky. Far off and within a few degrees of edge on, a cloud
     goes to the sky behind it; a near one stays a slab. */
  vec3 ray = normalize(vRay);
  float edgeOn = (1.0 - smoothstep(0.012, 0.05, abs(ray.y))) * smoothstep(40.0, 90.0, vDepth);
  lit = mix(lit, skyColor(ray), max(fog * 0.85, edgeOn));
  gl_FragColor = vec4(outColor(lit), 1.0);
}
`;

/* ----------------------------------------------------------------------------
   THE LIGHT SHAFT

   Daylight falling down the pit and the shaft into the chamber -- the beam
   through the roof in reference 4, and the single thing that most says
   "underground" in a film: you only see light in the air where the air is
   dark around it.

   Drawn as a cylinder, back faces only, added onto the frame. Each pixel the
   cylinder covers is shaded exactly once whether the camera is outside the
   beam or riding down inside it: the fragment intersects its own view ray
   with the beam analytically and integrates the haze along the part of the
   ray that lies inside -- a few samples, falling off toward the beam's edge,
   broken into vertical streaks by a slow noise. The depth test stops it at
   any wall or figure in front of its far side.

   GLSL ES 3.00; drawn only through the film pass, where it can glow.
-------------------------------------------------------------------------------*/

export const BEAM_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
/** Axis x and z, radius, and the bottom and top of the beam. */
uniform vec4 uBeam;
uniform float uBeamTop;
out vec3 vWorld;
void main() {
  vec3 world = vec3(
    uBeam.x + position.x * uBeam.z,
    mix(uBeam.w, uBeamTop, position.y),
    uBeam.y + position.z * uBeam.z
  );
  vWorld = world;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

export const BEAM_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 cameraPosition;
uniform vec4 uBeam;
uniform float uBeamTop;
/** The light in the beam, linear, gain included. */
uniform vec3 uBeamCol;
uniform float uTime;
in vec3 vWorld;
out vec4 fragColor;

float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1.0, 0.0)), u.x),
             mix(bhash(i + vec2(0.0, 1.0)), bhash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = vWorld - ro;
  float tBack = length(rd);
  rd /= tBack;
  float r = uBeam.z;

  // The ray against the infinite vertical cylinder...
  vec2 oc = ro.xz - uBeam.xy;
  float a = dot(rd.xz, rd.xz);
  float c = dot(oc, oc) - r * r;
  float t0 = -1e5;
  float t1 = 1e5;
  if (a > 1e-6) {
    float b = dot(oc, rd.xz);
    float h = b * b - a * c;
    if (h <= 0.0) discard;
    float s = sqrt(h);
    t0 = (-b - s) / a;
    t1 = (-b + s) / a;
  } else if (c > 0.0) {
    discard;
  }
  // ...then against the slab between its bottom and top.
  if (abs(rd.y) > 1e-5) {
    float ya = (uBeam.w - ro.y) / rd.y;
    float yb = (uBeamTop - ro.y) / rd.y;
    t0 = max(t0, min(ya, yb));
    t1 = min(t1, max(ya, yb));
  }
  t0 = max(t0, 0.0);
  t1 = min(t1, tBack);
  if (t1 <= t0) discard;

  /* Haze along the inside of the ray. Brightest on the axis, nothing at the
     rim; fading in over the last stretch above the floor and out toward the
     sky, so neither end of the cylinder shows as an edge. Streaks run with
     the light -- the noise varies across the beam, not along it. */
  float span = uBeamTop - uBeam.w;
  float dt = (t1 - t0) / 8.0;
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    vec2 q = p.xz - uBeam.xy;
    float d = length(q) / r;
    float radial = 1.0 - smoothstep(0.25, 1.0, d);
    float h = (p.y - uBeam.w) / span;
    float vert = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.62, 1.0, h));
    float streak = bnoise(q * 2.3 + vec2(uTime * 0.05, -uTime * 0.03));
    sum += radial * radial * vert * (0.45 + 1.1 * streak) * dt;
  }
  /* Thin. Seen across, the beam is a pale column; seen down its length from
     inside -- the whole descent -- the same density over twenty-odd units
     filled the frame with white haze. */
  float scatter = 1.0 - exp(-sum * 0.075);
  fragColor = vec4(uBeamCol * scatter, 1.0);
}
`;

/* ----------------------------------------------------------------------------
   MOTES

   Dust turning in the beam, and sparks of light drifting round the crystal.
   One instanced draw of small camera-facing squares, added onto the frame.

   Every mote's position is a function of time and its own seed -- a slow
   wander about where it was laid, and for the dust a slow fall that wraps
   from the floor back to the top of the beam -- so nothing is simulated and
   nothing is uploaded after the first frame.

   A dust mote is lit by the beam it is in, so the specks are bright on the
   axis and gone at the edge; the crystal's sparks carry their own light and
   twinkle.
-------------------------------------------------------------------------------*/

export const MOTE_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 position;
/** Where it was laid, and a phase. */
in vec4 aMote;
/** 0 dust in the beam, 1 a crystal spark. */
in float aKind;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform vec4 uBeam;
uniform float uBeamTop;
/** World size of one pixel at unit distance, so no mote shrinks below one. */
uniform float uPixel;
uniform vec2 uGain;
out vec2 vUv;
out float vLight;
flat out float vKind;

void main() {
  float ph = aMote.w;
  vec3 p = aMote.xyz;
  p.x += 0.35 * sin(uTime * 0.21 + ph * 6.1);
  p.z += 0.35 * cos(uTime * 0.17 + ph * 4.3);
  float light;
  if (aKind < 0.5) {
    // Settling through the beam, and round again from the top.
    float span = uBeamTop - uBeam.w;
    p.y = uBeam.w + mod(p.y - uBeam.w - uTime * (0.08 + 0.1 * ph), span);
    float d = length(p.xz - uBeam.xy) / uBeam.z;
    float h = (p.y - uBeam.w) / span;
    light = (1.0 - smoothstep(0.2, 1.0, d))
          * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.6, 1.0, h))
          * uGain.x;
  } else {
    p.y += 0.4 * sin(uTime * 0.6 + ph * 9.0);
    light = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 2.3 + ph * 21.0), 4.0)) * uGain.y;
  }
  vLight = light;
  vKind = aKind;
  vUv = position;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  /* Gone before it reaches the lens: a mote a hand's width from the camera
     is a third of the screen, and through the glow a white disc. */
  vLight *= smoothstep(0.8, 2.4, -mv.z);
  float size = max(aKind < 0.5 ? 0.045 : 0.07, uPixel * 1.6 * -mv.z);
  mv.xy += position * size;
  gl_Position = vLight > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const MOTE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uDustCol;
uniform vec3 uSparkCol;
in vec2 vUv;
in float vLight;
flat in float vKind;
out vec4 fragColor;
void main() {
  float r = length(vUv);
  float a = 1.0 - smoothstep(0.2, 1.0, r);
  vec3 col = vKind < 0.5 ? uDustCol : uSparkCol;
  fragColor = vec4(col * a * a * vLight, 1.0);
}
`;

/* ----------------------------------------------------------------------------
   PLANTS

   Tufts, flowers, vines and roots: cards, not cubes, cut out of the atlas by
   their coverage. One instanced draw for all of them. Each card set is two
   quads; what they become depends on the kind:

     0  standing on a top face, the two quads crossed -- tufts and flowers
     1  flat against a cliff face, hanging down it -- vines (one quad)
     2  hanging from an underside, crossed -- roots

   Lit by the same sun and shadow as the ground, with an upward normal for
   the standing kinds: a card lit by its own facing flickers as the camera
   moves round it, which is the thing that gives cards away.
-------------------------------------------------------------------------------*/

export const PLANT_VERTEX = /* glsl */ `#version 300 es
precision highp float;
/** Across the card -0.5..0.5, up it 0..1, which of the two cards. */
in vec3 position;
/** Base position and atlas tile. */
in vec4 aPlant;
/** Kind, facing, length, and whether it grows on the half that slides away. */
in vec4 aPlant2;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
uniform vec3 uOpenShift;
out vec3 vWorld;
out vec3 vRest;
out vec3 vRay;
out float vDepth;
out vec2 vUv;
flat out float vTile;
flat out vec3 vNormal;
flat out float vKind;
flat out float vLen;

void main() {
  float kind = aPlant2.x;
  float len = aPlant2.z;
  vec3 base = aPlant.xyz;
  vec3 world;
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  float card = position.z;
  if (kind < 0.5 || kind > 1.5) {
    vec3 across = card < 0.5 ? vec3(0.7071, 0.0, 0.7071) : vec3(0.7071, 0.0, -0.7071);
    float w = kind < 0.5 ? 0.92 : 0.8;
    float dir = kind < 0.5 ? 1.0 : -1.0;
    world = base + across * position.x * w + vec3(0.0, dir * position.y * len, 0.0);
    if (kind < 0.5) {
      // A breeze, more at the tips than the roots, out of step plant to plant.
      float ph = base.x * 0.37 + base.z * 0.61;
      world.xz += vec2(0.7, 0.4) * sin(uTime * 1.3 + ph) * 0.05 * position.y * position.y;
    } else {
      nrm = vec3(0.0, -1.0, 0.0);
    }
  } else {
    // A vine: one card on the face, the second folded away out of sight.
    int f = int(aPlant2.y + 0.5);
    vec3 n = f == 0 ? vec3(1.0, 0.0, 0.0) : f == 1 ? vec3(-1.0, 0.0, 0.0) : f == 4 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 0.0, -1.0);
    vec3 t = vec3(-n.z, 0.0, n.x);
    world = base + n * 0.53 + t * position.x + vec3(0.0, 0.5 - position.y * len, 0.0);
    nrm = n;
    if (card > 0.5) world = base;
  }
  vRest = world;
  if (aPlant2.w > 0.5) world += uOpenShift;
  vWorld = world;
  vRay = world - cameraPosition;
  vUv = vec2(position.x + 0.5, position.y);
  vTile = aPlant.w;
  vNormal = nrm;
  vKind = kind;
  vLen = len;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PLANT_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uAtlas;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}
in vec3 vWorld;
in vec3 vRest;
in vec3 vRay;
in float vDepth;
in vec2 vUv;
flat in float vTile;
flat in vec3 vNormal;
flat in float vKind;
flat in float vLen;
out vec4 fragColor;

${SKY_FN}
${LIGHT_FN}
${SHADOW_FN}
${ATLAS_FN}

void main() {
  /* Row 0 of a plant tile is the top of the plant. Vines and roots repeat
     their tile once per block of length, and the footprint is taken before
     the cut so the level choice never depends on which pixels survived it. */
  float rows = vKind < 0.5 ? 1.0 : vLen;
  vec2 fw = fwidth(vec2(vUv.x, vUv.y * rows)) * 16.0;
  float foot = max(fw.x, fw.y);
  vec2 tuv = vec2(vUv.x, vKind < 0.5 ? 1.0 - vUv.y : fract(vUv.y * rows));
  vec4 tex = tileSample(int(vTile + 0.5), tuv, foot);
  if (tex.a < 0.5) discard;
  vec3 albedoL = toLinear(tex.rgb);
  // Roots hang in the island's shadow; vines see half the sky.
  float sky = vKind > 1.5 ? 0.35 : (vKind > 0.5 ? 0.8 : 1.0);
  // The foot of a tuft sits in the ground's own contact shadow.
  float occl = vKind < 0.5 ? mix(0.62, 1.0, vUv.y) : 1.0;
  float sun = sunShadow(vRest, vNormal);
  vec3 lit = voxelShade(albedoL, vNormal, sky, occl, sun, 0.0, vWorld, 0.0);
  fragColor = vec4(outColor(voxelFog(lit, vRay, vDepth)), 1.0);
}
`;
