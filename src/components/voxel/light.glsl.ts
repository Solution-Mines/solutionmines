/* ----------------------------------------------------------------------------
   SHARED VOXEL LIGHTING

   The island is one instanced draw of static buffers. The one block that can
   be mined is a separate draw, because it has to move, crack and change
   material -- none of which a buffer uploaded once can do.

   But that block sits IN the island's wall. Its neighbours on five sides are
   ordinary terrain faces from the other draw, and if the two programs compute
   light even slightly differently the block reads as a patch in the rock --
   which is exactly what it must not do until the visitor is invited to hit
   it. So the arithmetic lives here once and every program pastes it in.

   THE MODEL, AND WHY IT CHANGED

   The first model shaded each face by which way it pointed -- six constants,
   top brightest -- with a faint warm wash toward the sun. That is how the
   game itself does it, and it is why the island looked lit from everywhere
   at once: no side of anything was ever in shadow, nothing cast a shadow,
   and the sun sat almost exactly behind the opening camera.

   Now there are three lights, which is what every one of the reference
   renders has:

   1. THE SUN. A warm key from one side, brighter than white before exposure,
      blocked by whatever stands between it and the face (the shadow map).
      Faces turned away from it get none of it at all.

   2. THE SKY. A cool fill from the whole dome -- blue from above, paler from
      the horizon, warm bounce off the ground from below -- scaled by how much
      of the sky a face can actually see. This is what the shadow side is lit
      by, and why shadows here are blue rather than grey.

   3. BLOCK LIGHT. Lanterns and crystal, baked as floods and lit here. Below
      ground there is no sun and almost no sky, so this is the whole picture:
      pools of warm light with cool dark between them.

   Requires SKY_UNIFORMS + SKY_FN (for skyColor and the sun) and
   LIGHT_UNIFORMS, in that order, above it.
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
/* Block light: the baked lantern and crystal floods. The levels arrive per
   corner from the emitter; these say what colour each is and how strongly
   it reads, so the reveal can turn the crystal up without a rebuild. */
uniform vec3 uWarmCol;
uniform vec3 uCrystalCol;
uniform float uWarmGain;
uniform float uCrystalGain;
/* How far underground the CAMERA is, 0..1. Not a property of any surface --
   that is what sky access is for -- but of the air between the eye and it:
   outdoors the distance fades toward the sky, underground toward the dark. */
uniform float uUnder;
/* The colour that air fades to underground. Driven per frame, so the haze in
   the crystal room can take on the crystal's own light. */
uniform vec3 uCaveFog;
`;

export const LIGHT_FN = /* glsl */ `
/* The sun, in linear light. Above 1: a face square to it is brighter than
   white before the exposure, which is what lets a sunlit edge bloom. */
const float SUN_GAIN = 2.8;
/* The dome, as a fill. */
const float SKY_GAIN = 1.5;
/* What comes back up from below. Under a floating island the ground below is
   the sea -- bright, and blue -- so the underside and the shaded cliffs take
   a cool fill from it rather than a warm one from turf. Without it the
   shaded rock face under the ledge went to black across half the frame. */
const vec3 BOUNCE = vec3(0.13, 0.19, 0.25);
/* The floor of the dark underground. Cool, and low: this is what the far
   side of a lantern's pool falls to, and it is a blue-black rather than a
   brown one because the warm light only means something against cold. */
const vec3 CAVE_AMB = vec3(0.04, 0.055, 0.09);

/* The whole light model, in linear light.

   albedoL  the material's own colour, LINEAR, jitter already applied
   n        the face normal, axis-aligned
   ao       sky access, 0..1 -- how much of the dome this face can see
   occl     the corner occlusion at this point of the face, 0..1
   sun      how much of the sun reaches this point: the shadow map, or an
            estimate where there is none
   emit     light the surface gives off itself, already scaled
   world    world position, for the lamps
   isWater  1 for still water and the falls, which take a flatter key */
vec3 voxelShade(vec3 albedoL, vec3 n, float ao, float occl, float sun,
                float emit, vec3 world, float isWater) {
  vec3 sunL = toLinear(uSunTint) * SUN_GAIN;
  vec3 zenith = toLinear(uSkyMid);
  vec3 horizon = toLinear(uSkyHorizon);

  /* The sun. Gated by sky access as well as the shadow map: the map only
     covers the island's bounds, and a face sealed in rock that falls outside
     it must not read as sunlit. */
  float ndl = max(dot(n, uSunDir), 0.0);
  float reach = smoothstep(0.02, 0.16, ao);
  vec3 direct = sunL * ndl * sun * reach;

  /* The dome. Up-facing faces see the deep blue overhead, sides see mostly
     horizon, down-facing faces see only the ground's warm bounce. */
  float up = n.y * 0.5 + 0.5;
  vec3 dome = mix(BOUNCE, mix(horizon, zenith, 0.5), up);
  /* Sky access eased up toward the dark end. Light bounces round the walls of
     a pit as well as falling into it, and at the bare figure the shaded side
     of the pit went to black -- a fifth of the rim frame crushed. */
  vec3 ambient = dome * SKY_GAIN * mix(ao, sqrt(ao), 0.5);

  /* Corner occlusion darkens the fill fully and the sun only partly. Direct
     light pours into a corner in a way the sky does not; taking it fully
     would put a dark seam along every sunlit step. */
  vec3 lit = albedoL * (direct * mix(1.0, occl, 0.4) + ambient * occl);

  /* Water: a sheet with sky in it and sun across it, not a wall that faces
     one way. Flat, bright, and nearly the same on every face. */
  vec3 water = albedoL * (dome * 1.25 + sunL * (0.16 + 0.22 * ndl));
  lit = mix(lit, water, isWater);

  /* Underground ambient, where the sky does not reach. Masked by the lack of
     sky access, not by where the camera is, so the bottom of the pit seen
     from its rim is as dark as it is from inside. */
  float sealed = 1.0 - smoothstep(0.05, 0.45, ao);
  lit += albedoL * CAVE_AMB * sealed * occl * (1.0 - isWater);

  /* The lamp that rides with the journey. A fill now, not the light: the
     lanterns are the light. Kept so the shaft has something on its walls
     between one lantern and the next. */
  vec3 toLamp = uLampPos - world;
  float lampDist = length(toLamp);
  float lampReach = 1.0 - smoothstep(0.0, uLampRange, lampDist);
  float lambert = max(dot(n, toLamp / max(lampDist, 0.0001)), 0.0);
  lit += albedoL * toLinear(uLampCol) * uLampGain * lampReach * lampReach
       * (0.15 + 0.85 * lambert) * occl;

  /* The find. A steep falloff, so the brightest surfaces in the room are the
     formation's own, and a floor under the lambert so a crystal face turned
     away from the eye still glows. */
  if (uLamp2Gain > 0.0) {
    vec3 to2 = uLamp2Pos - world;
    float d2 = length(to2);
    float reach2 = 1.0 - smoothstep(0.0, uLamp2Range, d2);
    float lam2 = max(dot(n, to2 / max(d2, 0.0001)), 0.0);
    lit += albedoL * toLinear(uLamp2Col) * uLamp2Gain * reach2 * reach2
         * (0.3 + 0.7 * lam2);
  }

  return lit + albedoL * emit;
}

/* The old entry point, for the programs that have neither a shadow map nor
   corner occlusion: the WebGL1 fallbacks, the chips. Sun is estimated from
   sky access, which is right for open ground and wrong only in the shadow of
   a tree. Ore lights itself a little. */
vec3 voxelLit(vec3 col, vec3 n, float ao, vec3 world,
              float isWater, float isOre, float glint) {
  float emit = isOre * (0.06 + glint * 0.05);
  return voxelShade(toLinear(col), n, ao, 1.0, smoothstep(0.35, 0.9, ao),
                    emit, world, isWater);
}

/* Aerial perspective. Outdoors the distance fades toward the sky BEHIND it
   rather than toward one fog constant -- that is the difference between haze
   and a grey wash, and it is why the sky function is shared rather than
   copied. Underground it fades toward the dark, which is what turns the far
   end of a drift into depth instead of into a wall.

   Split from the lighting so light that is not part of it can be added
   BEFORE the haze, not painted over the top of it. */
vec3 voxelFog(vec3 lit, vec3 ray, float depth) {
  float fog = smoothstep(uFogRange.x, uFogRange.y, depth) * 0.72 * (1.0 - uUnder);
  lit = mix(lit, skyColor(normalize(ray)), fog);
  float haze = (1.0 - exp(-max(depth - 2.5, 0.0) * 0.05)) * uUnder;
  return mix(lit, uCaveFog, haze);
}

/* The same function every program has always called. */
vec3 voxelLight(vec3 col, vec3 n, float ao, vec3 world, vec3 ray, float depth,
                float isWater, float isOre, float glint) {
  return voxelFog(voxelLit(col, n, ao, world, isWater, isOre, glint), ray, depth);
}

/* Block light, for an albedo already in linear light.

   The flood arrives as (level / 15) squared, which falls off the way the game
   does -- softly, a lantern lighting most of a room. That is a game reading,
   not a film one. Raised again here, it pulls each lantern's light into a
   pool with darkness between pools, and the gain pushes the middle of the
   pool past white so it glows.

   The flames flicker and the crystal does not. Flicker is two slow sines per
   CELL rather than per fragment -- per fragment it shimmers across a face
   like a bad signal -- and stays within six per cent either way. */
vec3 blockLit(vec3 albedoL, float warm, float crystal, vec3 cell, float time) {
  float flick = 1.0 + 0.06 * sin(time * 9.0 + dot(cell, vec3(1.3, 2.1, 0.7)))
                          * sin(time * 5.3 + cell.x * 0.9 + cell.z * 1.7);
  float w = pow(max(warm, 0.0), 1.6);
  float c = pow(max(crystal, 0.0), 1.35);
  return albedoL * (toLinear(uWarmCol) * w * uWarmGain * flick
                  + toLinear(uCrystalCol) * c * uCrystalGain);
}
`;

/* The sun's shadow map, for the programs that can read one (GLSL ES 3.00).

   Rendered once from the sun when the world is built -- the island does not
   move, so neither do its shadows -- and sampled here with four filtered
   comparisons. Each comparison is itself a 2x2 filter in hardware, so the
   edge is a soft gradient a few texels wide rather than a staircase.

   The lookup is offset along the normal before projecting. A face compared
   against its own depth flickers between lit and shadowed ("acne"); a few
   hundredths of a block of lift puts it cleanly in front. */
export const SHADOW_FN = /* glsl */ `
uniform highp sampler2DShadow uShadowMap;
/* The same sun with the island open: drawn once more with the half that
   slides away left out, so the daylight falls into the opened mine. */
uniform highp sampler2DShadow uShadowMapOpen;
uniform mat4 uShadowMat;
uniform float uShadowOn;
/** How far open the island is, 0..1. */
uniform float uOpen;

float shadowTaps(highp sampler2DShadow map, vec3 p) {
  vec2 tx = 1.0 / vec2(textureSize(map, 0));
  float z = p.z - 0.0006;
  return (texture(map, vec3(p.xy + vec2(-0.7, -0.7) * tx, z))
        + texture(map, vec3(p.xy + vec2( 0.7, -0.7) * tx, z))
        + texture(map, vec3(p.xy + vec2(-0.7,  0.7) * tx, z))
        + texture(map, vec3(p.xy + vec2( 0.7,  0.7) * tx, z))) * 0.25;
}

/* For a point on the half that stays, or that does not belong to either --
   a figure, a plant. Pass the point's position BEFORE any slide. */
float sunShadow(vec3 world, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMat * vec4(world + n * 0.05, 1.0);
  vec3 p = s.xyz / s.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  /* One map at either end, both only while the island is moving: through
     most of the mine it is wide open, and sampling the closed island's map
     there as well doubled every fragment's shadow lookups for nothing. */
  if (uOpen > 0.999) return shadowTaps(uShadowMapOpen, p);
  float closed = shadowTaps(uShadowMap, p);
  if (uOpen < 0.001) return closed;
  return mix(closed, shadowTaps(uShadowMapOpen, p), uOpen);
}

/* For the half that slides away: its own shadows, as it was. */
float sunShadowClosed(vec3 world, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 s = uShadowMat * vec4(world + n * 0.05, 1.0);
  vec3 p = s.xyz / s.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  return shadowTaps(uShadowMap, p);
}
`;
