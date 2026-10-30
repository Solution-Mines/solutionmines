/* ----------------------------------------------------------------------------
   SHARED VOXEL LIGHTING

   The island is one instanced draw of static buffers. The one block that can
   be mined is a separate draw, because it has to move, crack and change
   material -- none of which a buffer uploaded once can do.

   But that block sits IN the island's wall. Its neighbours on five sides are
   ordinary terrain faces from the other draw, and if the two programs compute
   light even slightly differently the block reads as a patch in the rock --
   which is exactly what it must not do until the visitor is invited to hit
   it. So the arithmetic lives here once and both programs paste it in.

   Requires SKY_UNIFORMS + SKY_FN (for skyColor) and LIGHT_UNIFORMS, in that
   order, above it.
-------------------------------------------------------------------------------*/

export const LIGHT_UNIFORMS = /* glsl */ `
uniform vec2 uFogRange;
uniform vec3 uLampPos;
uniform vec3 uLampCol;
uniform float uLampGain;
uniform float uLampRange;
/* A second source, for the one thing in the mine that is its own light.

   Not a general light rig. Two is the number this scene actually needs: the
   lamp that travels with the journey, and the find standing in the cavern.
   A third would be an array, an array means a loop in the fragment shader,
   and a loop here costs every pixel of the island for the sake of a room the
   journey is in for a tenth of its length. */
uniform vec3 uLamp2Pos;
uniform vec3 uLamp2Col;
uniform float uLamp2Gain;
uniform float uLamp2Range;
`;

export const LIGHT_FN = /* glsl */ `
/* col      the material's own colour, jitter already applied
   n        the face normal, axis-aligned
   ao       sky access for this face, 0..1
   world    world position, for the lamp and the haze
   ray      world position minus the eye
   depth    distance from the eye, for aerial perspective
   isWater  1 for still water and the falls, which take a far flatter key
   isOre    1 for the three ores, which light themselves
   glint    0..1 slow pulse, passed in so the caller owns the one sine */
vec3 voxelLight(vec3 col, vec3 n, float ao, vec3 world, vec3 ray, float depth,
                float isWater, float isOre, float glint) {
  /* Into linear, once, here. Every caller hands this function an authored
     sRGB colour and gets lit linear light back; the caller encodes at the
     end of its own shader. One decode in one place is what stops the island,
     the mineable block and the miner drifting into three exposures. */
  col = toLinear(col);
  vec3 skyHorizonL = toLinear(uSkyHorizon);
  vec3 skyTopL = toLinear(uSkyTop);
  vec3 sunL = toLinear(uSunTint);
  vec3 lampL = toLinear(uLampCol);
  /* The cool fill was authored as a display colour too. */
  vec3 fillL = toLinear(vec3(0.30, 0.38, 0.52));

  vec3 an = abs(n);

  /* Face shading, not a light source. Every normal here is axis-aligned, so
     exactly one component of 'an' is 1 and the others are 0 -- this picks one
     constant per face. Six flat values read as blocks; a real directional
     light would round them off and lose the whole point. */
  float key = an.y * (n.y > 0.0 ? 1.00 : 0.40)
            + an.x * (n.x > 0.0 ? 0.74 : 0.60)
            + an.z * (n.z > 0.0 ? 0.88 : 0.54);

  /* A cool fill on the faces turned AWAY from the key. Without it those two
     sides land on the same dead value, the silhouette flattens, and the
     scene reads as cardboard. It is added, not blended, so the faces stay
     flat -- this is a second constant per face, not a gradient. */
  float fill = an.x * (n.x < 0.0 ? 0.17 : 0.0)
             + an.z * (n.z < 0.0 ? 0.13 : 0.0)
             + an.y * (n.y < 0.0 ? 0.08 : 0.0);

  /* How much sky a face can see. Upward faces see all of it, sides see
     roughly half, undersides almost none. Still one constant per face, so
     nothing here rounds a cube off. */
  float skyFace = an.y * (n.y > 0.0 ? 1.0 : 0.10) + (an.x + an.z) * 0.42;
  float sunFace = max(dot(n, uSunDir), 0.0);

  float shade = mix(key * ao, 0.66 + key * 0.26, isWater);
  /* ao means sky access on the island and distance-down-the-fall on a
     waterfall, so everything that is not about the island has to stop
     reading it -- otherwise the ambient brightens the bottom of each fall
     for no reason at all. */
  float amb = mix(ao, 0.9, isWater);

  vec3 lit = col * shade
           + fillL * fill * ao * (1.0 - isWater)
           /* Ambient off the sky dome. Leaving it out is what makes an
              untextured island look cut from a different photograph than the
              sky behind it. Scaled by the material's own colour so it lifts
              exposure without washing the hue out. */
           + col * mix(skyHorizonL, skyTopL, 0.35) * skyFace * 0.55 * amb
           /* And a flat warm wash on whichever faces point at the sun, which
              is the only thing tying the island's key to where the sky says
              the light is coming from. */
           + sunL * sunFace * 0.055 * (1.0 - isWater);

  /* The lamp. Everything above this point is daylight, and underground the
     sky-access figure baked into ao has already taken daylight to almost
     nothing -- so below ground this term is not an addition to the lighting,
     it IS the lighting.

     Its gain is zero at the surface, which is what keeps it from quietly
     brightening a scene that was already composed. */
  vec3 toLamp = uLampPos - world;
  float lampDist = length(toLamp);
  float reach = 1.0 - smoothstep(0.0, uLampRange, lampDist);
  float lambert = max(dot(n, toLamp / max(lampDist, 0.0001)), 0.0);
  /* A floor under the lambert, because a face turned away from the only lamp
     in a sealed room goes to pure black, and pure black has no silhouette --
     the voxels stop being voxels and the frame becomes a hole. */
  lit += col * lampL * uLampGain * reach * reach * (0.22 + 0.78 * lambert);

  /* A flat cave ambient, present only where the lamp is.

     Underground the lamp is the only light, so any face it does not point at
     falls back on the sky ambient -- which the flood has already taken to
     almost nothing. Measured result: 16% of the descent frame below 1%
     luminance. Not dark, blank. This is the bounce a real lamp gives off the
     opposite wall, and it is the difference between a dark room and an
     empty one. */
  lit += col * lampL * uLampGain * 0.30;

  /* The find. Same falloff as the lamp, warmer floor under the lambert --
     a crystal face turned away from the camera is still glowing, it is just
     not glowing AT the camera, and taking it to black would turn the one
     object in the scene that emits light into a silhouette. */
  if (uLamp2Gain > 0.0) {
    vec3 lamp2L = toLinear(uLamp2Col);
    vec3 to2 = uLamp2Pos - world;
    float d2 = length(to2);
    float reach2 = 1.0 - smoothstep(0.0, uLamp2Range, d2);
    float lam2 = max(dot(n, to2 / max(d2, 0.0001)), 0.0);
    lit += col * lamp2L * uLamp2Gain * reach2 * reach2 * (0.3 + 0.7 * lam2);
  }

  /* Ore lights itself. Enough to find in a dark room, not so much that the
     block stops having sides -- at 0.30 the emissive swamped the lamp and
     the ore came out as flat pastel squares, lit but no longer voxels. */
  /* Ore, halved against the sRGB-era figure. The same number added to
     linear light is a far larger share of it, and at the old strength the
     ore pinned its red channel at 255 and lost all shape. */
  lit += col * isOre * (0.085 + glint * 0.07);

  /* Aerial perspective. The far side fades toward the sky BEHIND it rather
     than toward one fog constant -- that is the difference between haze and
     a grey wash, and it is why the sky function is shared rather than
     copied. */
  float fog = smoothstep(uFogRange.x, uFogRange.y, depth);
  return mix(lit, skyColor(normalize(ray)), fog * 0.72);
}
`;
