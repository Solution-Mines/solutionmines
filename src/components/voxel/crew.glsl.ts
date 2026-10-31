import { SKY_UNIFORMS, SKY_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN, SHADOW_FN } from "./light.glsl";
import { ATLAS_FN } from "./blocks.glsl";

/* ----------------------------------------------------------------------------
   THE CREW, AND EVERYTHING ELSE MADE OF BOXES

   One instanced draw for every person, the cart, the rails, the lanterns and
   the crates. Each box is an instance carrying everything about itself --
   where it sits in its figure, which joint it turns about, how it is
   coloured -- and, rewritten every frame, everything about its figure:
   where it stands, which way it faces, the angles of its bone and of the
   body that bone hangs from, and how much lantern and crystal light reaches
   it.

   Written once and emitted twice. WebGL2 gets the textured version: skins
   folded onto the boxes as nets, tiles on the props. WebGL1 gets the same
   rig in flat colour, so a device without WebGL2 still has people in it.
-------------------------------------------------------------------------------*/

function vertex(es3: boolean) {
  const IN = es3 ? "in" : "attribute";
  const OUT = es3 ? "out" : "varying";
  const FLAT = es3 ? "flat out" : "varying";
  return /* glsl */ `${es3 ? "#version 300 es\n" : ""}precision highp float;

${IN} vec3 position;
${IN} vec3 normal;
${IN} vec3 aPart;
${IN} vec3 aSize;
${IN} vec3 aPivot;
${IN} vec3 aColor;
/** Texture mode, atlas u, atlas v, skin texels per pixel. */
${IN} vec4 aTex;
/** The box's lean: rise per unit along x and along z. */
${IN} vec2 aShear;
/** Baked darkening x sky access, self-lit, warm light, crystal light. */
${IN} vec4 aShade;
/** The figure: feet position and scale. */
${IN} vec4 aXform;
/** Facing sine, facing cosine, pitch nose-up, hidden. */
${IN} vec4 aMotion;
/** This box's bone, and the body under it. */
${IN} vec3 aRot;
${IN} vec3 aRotP;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

${OUT} vec3 vNormal;
${OUT} vec3 vWorld;
${OUT} vec3 vRay;
${OUT} float vDepth;
${OUT} vec3 vBoxP;
${FLAT} vec3 vBoxN;
${FLAT} vec3 vSize;
${FLAT} vec3 vColor;
${FLAT} vec4 vTex;
${FLAT} vec4 vShade;
${FLAT} vec3 vOrigin;

/* The joint the body leans about. crew.ts holds the same number. */
const vec3 HIP = vec3(0.0, 12.0, 0.0);

/* Pitch about X, then roll about Z, then yaw about Y. Negative pitch raises a
   limb forward. */
vec3 rot3(vec3 v, vec3 a) {
  float c = cos(a.x);
  float s = sin(a.x);
  v = vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
  c = cos(a.z);
  s = sin(a.z);
  v = vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
  c = cos(a.y);
  s = sin(a.y);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

vec3 face(vec3 v) {
  return vec3(v.x * aMotion.y + v.z * aMotion.x, v.y, -v.x * aMotion.x + v.z * aMotion.y);
}

void main() {
  if (aMotion.w > 0.5) {
    /* Collapsed outside the clip volume. Figures come and go with the scroll,
       and a fixed-size batch is what lets that cost nothing. */
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 local = position * aSize + aPart;
  vec3 nrm = normal;
  /* Leaned about its middle: a rail on a climb. Its sides stay upright, and
     its top and bottom tilt, so their normals do too. */
  local.y += dot(aShear, (position * aSize).xz);
  nrm = normalize(vec3(nrm.x - aShear.x * nrm.y, nrm.y, nrm.z - aShear.y * nrm.y));
  // The bone, about its own joint...
  local = aPivot + rot3(local - aPivot, aRot);
  nrm = rot3(nrm, aRot);
  // ...then the lean of the body it hangs from. Zero for the body and legs.
  local = HIP + rot3(local - HIP, aRotP);
  nrm = rot3(nrm, aRotP);
  // ...and the whole figure's tilt about its feet: a cart taking a climb.
  local = rot3(local, vec3(-aMotion.z, 0.0, 0.0));
  nrm = rot3(nrm, vec3(-aMotion.z, 0.0, 0.0));

  vec3 world = aXform.xyz + face(local) * aXform.w;

  vNormal = face(nrm);
  vWorld = world;
  vRay = world - cameraPosition;
  vBoxP = position;
  vBoxN = normal;
  vSize = aSize;
  vColor = aColor;
  vTex = aTex;
  vShade = aShade;
  vOrigin = aXform.xyz;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
}

export const CREW_VERTEX = vertex(true);
export const CREW_VERTEX_GL1 = vertex(false);

export const CREW_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform highp sampler2D uAtlas;
uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

in vec3 vNormal;
in vec3 vWorld;
in vec3 vRay;
in float vDepth;
in vec3 vBoxP;
flat in vec3 vBoxN;
flat in vec3 vSize;
flat in vec3 vColor;
flat in vec4 vTex;
flat in vec4 vShade;
flat in vec3 vOrigin;

out vec4 fragColor;

${SKY_FN}
${LIGHT_FN}
${SHADOW_FN}
${ATLAS_FN}

/* Self-lit boxes -- lantern glass, helmet lamps, the crystal in the cart --
   give off this many times their own colour. Far past white: these are the
   points the glow is built around. */
const float EMIT = 4.0;

void main() {
  vec3 col = vColor;
  float skinGlow = 0.0;
  int mode = int(vTex.x + 0.5);
  vec3 p = vBoxP;
  vec3 nn = vBoxN;

  /* Footprints before any branching: derivatives taken inside a branch that
     differs across a 2x2 pixel quad are undefined, and every box edge is
     such a quad. */
  // In TEXELS: the head carries more of them per pixel than the body. Only
  // skinned boxes use the slot this way; for tiles it is the top tile.
  float density = int(vTex.x + 0.5) == 1 ? max(vTex.w, 1.0) : 1.0;
  vec3 fwSkin = fwidth(p * vSize * density);
  float footSkin = max(fwSkin.x, max(fwSkin.y, fwSkin.z));
  vec3 fwTile = fwidth(p) * 16.0;
  float footTile = max(fwTile.x, max(fwTile.y, fwTile.z));

  /* Which face, and where on it. The fold matches paintSkin() in atlas.ts:
     column 0 of the front is the figure's own right, column 0 of the right
     side is the front edge, row 0 is always the top. */
  vec2 uv;
  int fi;
  if (nn.z > 0.5)       { uv = vec2(0.5 - p.x, 0.5 - p.y); fi = 0; }
  else if (nn.z < -0.5) { uv = vec2(p.x + 0.5, 0.5 - p.y); fi = 1; }
  else if (nn.x > 0.5)  { uv = vec2(0.5 - p.z, 0.5 - p.y); fi = 2; }
  else if (nn.x < -0.5) { uv = vec2(p.z + 0.5, 0.5 - p.y); fi = 3; }
  else if (nn.y > 0.5)  { uv = vec2(p.x + 0.5, p.z + 0.5); fi = 4; }
  else                  { uv = vec2(p.x + 0.5, 0.5 - p.z); fi = 5; }

  if (mode == 1) {
    ivec3 dims = ivec3(vSize * density + 0.5);
    int w = dims.x;
    int h = dims.y;
    int d = dims.z;
    ivec2 net = ivec2(vTex.yz + 0.5);
    ivec2 org;
    ivec2 sz;
    if (fi == 0)      { org = net + ivec2(d, d);         sz = ivec2(w, h); }
    else if (fi == 1) { org = net + ivec2(2 * d + w, d); sz = ivec2(w, h); }
    else if (fi == 2) { org = net + ivec2(0, d);         sz = ivec2(d, h); }
    else if (fi == 3) { org = net + ivec2(d + w, d);     sz = ivec2(d, h); }
    else if (fi == 4) { org = net + ivec2(d, 0);         sz = ivec2(w, d); }
    else              { org = net + ivec2(d + w, 0);     sz = ivec2(w, d); }
    ivec2 tx = clamp(ivec2(floor(uv * vec2(sz))), ivec2(0), sz - 1);
    vec4 texel = texelFetch(uAtlas, org + tx, 0);
    /* Far away the face is sub-pixel and a skin texel is noise: fade to the
       part's own colour, which is what a vest or a pair of trousers averages
       to anyway. */
    float near = 1.0 - smoothstep(0.8, 1.8, footSkin);
    col = mix(vColor, texel.rgb, near);
    skinGlow = texel.a * near;
  } else if (mode == 2) {
    // A different tile on top when one is given -- turf on a grass block.
    int tile = (fi == 4 && vTex.w > 0.5) ? int(vTex.w + 0.5) - 1 : int(vTex.y + 0.5);
    col = tileSample(tile, uv, footTile).rgb;
  }

  vec3 n = normalize(vNormal);
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vOrigin.x * 1.7 + vOrigin.z * 2.3);
  vec3 albedoL = toLinear(col);
  /* The same sun and the same shadows as the ground they stand on: a figure
     under a tree is in its shade, and one in the open throws the light off
     the same side as the hill behind him. */
  float sun = sunShadow(vWorld, n);
  float emit = vShade.y * EMIT * (0.9 + 0.2 * glint) + skinGlow * 2.5;
  vec3 lit = voxelShade(albedoL, n, vShade.x, 1.0, sun, emit, vWorld, 0.0);

  /* A rim of light round the silhouette, from behind. Every reference keeps
     its people apart from the background this way -- in the dark especially,
     where a dark-clothed figure against a dark wall is otherwise a hole. Cool
     outdoors, from the sky; underground it takes the lanterns' warmth. */
  vec3 toEye = normalize(-vRay);
  float rim = pow(1.0 - max(dot(n, toEye), 0.0), 3.0);
  vec3 rimCol = mix(toLinear(uSkyMid) * 0.9, toLinear(uWarmCol) * 0.7, uUnder);
  lit += albedoL * rimCol * rim * (0.55 + 0.6 * uUnder);
  /* The flood is read at one point, the chest, for the whole figure -- and a
     figure's faces do not all face the lantern. Taken at full strength it
     lit every side of a miner beside a lamp past white. */
  lit += blockLit(albedoL, vShade.z * 0.55, vShade.w * 0.7, floor(vOrigin), uTime);
  fragColor = vec4(outColor(voxelFog(lit, vRay, vDepth)), 1.0);
}
`;

/* The WebGL1 fragment: the same light, no textures. */
export const CREW_FRAGMENT_GL1 = /* glsl */ `
precision highp float;

uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying vec3 vBoxP;
varying vec3 vBoxN;
varying vec3 vSize;
varying vec3 vColor;
varying vec4 vTex;
varying vec4 vShade;
varying vec3 vOrigin;

${SKY_FN}
${LIGHT_FN}

void main() {
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vOrigin.x * 1.7 + vOrigin.z * 2.3);
  vec3 lit = voxelLit(vColor, normalize(vNormal), vShade.x, vWorld, 0.0, vShade.y, glint);
  lit += blockLit(toLinear(vColor), vShade.z, vShade.w, floor(vOrigin), uTime);
  gl_FragColor = vec4(outColor(voxelFog(lit, vRay, vDepth)), 1.0);
}
`;
