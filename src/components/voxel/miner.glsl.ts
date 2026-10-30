import { SKY_UNIFORMS, SKY_FN } from "./sky.glsl";
import { LIGHT_UNIFORMS, LIGHT_FN } from "./light.glsl";

/* ----------------------------------------------------------------------------
   THE FIGURE BATCH

   One instanced draw of the same unit cube the island and the mineable block
   already use, carrying every person, the cart, the rail road, the lanterns
   and the loose gear in the mine.

   Each box is one instance and carries everything about itself: its place in
   its own figure's local space, the same place in that figure's OTHER pose,
   its colour, and -- the part that makes a crowd possible -- the position,
   facing and pose of the figure it belongs to. Putting those last three on
   the instance rather than in a uniform is the whole difference between one
   draw and a dozen: OGL keeps uniforms on the Program, so figures sharing a
   program would otherwise share a pose as well.

   Everyone is lit by the same voxelLight() as the ground they stand on. That
   is not tidiness. A figure lit even slightly differently from the terrain
   reads as a sticker on the photograph, and the job of these figures is to
   belong to the island well enough to give it a size.
-------------------------------------------------------------------------------*/

export const FIGURE_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
/** This box, in its figure's local space. */
attribute vec3 aPart;
attribute vec3 aSize;
/** The same box in that figure's other pose. */
attribute vec3 aPartB;
attribute vec3 aSizeB;
attribute vec3 aColor;
attribute float aAO;
attribute float aEmit;
/** The figure this box belongs to: where its feet are, and its scale. */
attribute vec4 aXform;
/** And how it is standing: facing sine, facing cosine, pose, hidden. */
attribute vec4 aMotion;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying vec3 vColor;
varying float vAO;
varying float vEmit;

void main() {
  if (aMotion.w > 0.5) {
    /* Collapsed outside the clip volume. The batch is a fixed size on
       purpose -- figures come and go with the scroll, and rebuilding the
       buffers as they do would upload the whole crowd several times a
       second to hide one man. */
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  /* Blend the two poses per box. Linear between two authored positions is
     enough at this size: it is the silhouette changing that reads as a
     swing, not the path any one elbow takes. */
  vec3 partAt = mix(aPart, aPartB, aMotion.z);
  vec3 partSize = mix(aSize, aSizeB, aMotion.z);
  vec3 local = position * partSize + partAt;

  /* Turned about the figure's own up axis, then scaled, then put where the
     figure is. One rotation for the whole person, worked out on the CPU --
     it is a single value per figure and there is no reason to spend two trig
     calls per vertex on it. */
  vec3 turned = vec3(
    local.x * aMotion.y + local.z * aMotion.x,
    local.y,
    -local.x * aMotion.x + local.z * aMotion.y
  );
  vec3 world = aXform.xyz + turned * aXform.w;

  /* The normal is turned but not scaled. The scale is uniform across all
     three axes, so it cannot shear a normal -- and the boxes are axis-aligned
     before the yaw, which is what keeps the flat per-face shading intact. */
  vNormal = vec3(
    normal.x * aMotion.y + normal.z * aMotion.x,
    normal.y,
    -normal.x * aMotion.x + normal.z * aMotion.y
  );
  vColor = aColor;
  vAO = aAO;
  vEmit = aEmit;
  vWorld = world;
  vRay = world - cameraPosition;

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const FIGURE_FRAGMENT = /* glsl */ `
precision highp float;

uniform float uTime;
${SKY_UNIFORMS}
${LIGHT_UNIFORMS}

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vRay;
varying float vDepth;
varying vec3 vColor;
varying float vAO;
varying float vEmit;

${SKY_FN}
${LIGHT_FN}

void main() {
  /* The lamp pulse, reusing the self-lit channel the ores already go through
     rather than adding a second emissive path. Above ground it is barely
     visible, which is correct -- a head torch in daylight should not read.
     Keyed off world position so the lanterns down the drift are not all
     breathing in time with each other. */
  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + vWorld.x * 1.7 + vWorld.z * 2.3);
  vec3 lit = voxelLight(
    vColor, normalize(vNormal), vAO, vWorld, vRay, vDepth, 0.0, vEmit, glint);
  gl_FragColor = vec4(toSRGB(lit), 1.0);
}
`;
