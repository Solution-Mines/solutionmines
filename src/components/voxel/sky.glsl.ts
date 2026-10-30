/* ----------------------------------------------------------------------------
   ONE SKY, THREE CONSUMERS

   The sky is not just the background. The island's haze has to fade toward
   whatever the sky is doing BEHIND that pixel, and the water has to reflect
   it. If each of those three shaders carried its own idea of the sky they
   would disagree, and the disagreement shows up as a seam at the horizon --
   which is the single most common way a scene like this falls apart.

   So the function lives here once, as a string, and is pasted into all three
   programs. Same uniforms, same maths, same answer.
-------------------------------------------------------------------------------*/

/** Declarations the sky function needs. Paste before SKY_FN. */
export const SKY_UNIFORMS = /* glsl */ `
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uSunTint;
uniform vec3 uSunDir;
`;

/** `skyColor(dir)` for a world-space, normalised view direction.

    Returns LINEAR light, not a display colour. Everything downstream adds,
    multiplies and mixes it, and all of that is only meaningful in linear --
    see the note on toSRGB below. */
export const SKY_FN = /* glsl */ `
/* ---------------------------------------------------------------------------
   COLOUR SPACE

   Every colour in this scene was authored by eye against a display, so the
   constants are sRGB. Light is not: doubling the light on a surface does not
   double its sRGB value. Until now the whole renderer multiplied, mixed and
   fogged sRGB numbers directly and wrote them straight out, which is why the
   darks collapsed -- an ambient of 0.035 was being WRITTEN as 0.035, about
   five values out of 255, instead of being lit to roughly ten times that.

   So: decode on the way in, do the arithmetic in linear, encode once on the
   way out. The 2.2 power is the usual approximation of the sRGB curve; the
   exact piecewise version costs a branch and is not distinguishable here.

   The one rule that matters: encode EXACTLY once, at the end of a fragment
   shader. Encoding twice looks like washed-out fog and is hard to spot. */
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec3 skyColor(vec3 dir) {
  /* Decoded once, up front. The gradient below is a chain of mixes, and a
     mix between two sRGB values is not the colour halfway between the two
     lights -- it is darker, which is what made the old horizon band muddy
     rather than hazy. */
  vec3 skyTop = toLinear(uSkyTop);
  vec3 skyMid = toLinear(uSkyMid);
  vec3 skyHor = toLinear(uSkyHorizon);
  vec3 sunCol = toLinear(uSunTint);

  /* Deep overhead, mid blue at eye level. */
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(skyMid, skyTop, pow(up, 0.55));

  /* Then a NARROW pale band hugging the waterline -- not a ramp running all
     the way to the zenith. Real haze sits in the last few degrees above the
     horizon, and spreading it up the whole dome is what makes a gradient
     read as wallpaper. It is also why the first pass of this had no blue in
     it anywhere: a camera pitched down sees only the bottom ten degrees of
     sky, and the ramp had not got going by then. */
  col = mix(col, skyHor, 1.0 - smoothstep(0.0, 0.085, up));

  /* Below eye level the dome keeps going. We only ever see this band in the
     far distance past the water, so it is the horizon colour knocked down a
     little -- enough to stop the waterline glowing. Written as
     1.0 - smoothstep(low, high, y) rather than smoothstep(high, low, y),
     because a reversed-edge smoothstep is undefined in GLSL. */
  col = mix(col, skyHor * 0.74, 1.0 - smoothstep(-0.18, 0.0, dir.y));

  /* The sun in three widths. The narrow term is the disc, the middle one the
     bloom that actually reaches into frame, and the broad one lifts the whole
     sun side of the sky so the island has a direction to be lit from. */
  /* Retuned for linear light. The broad term especially: added to an sRGB
     sky it was a gentle warm lift, added to a linear one it swamped the
     blue, because a linear sky sits far lower numerically than it looks. */
  float s = max(dot(dir, uSunDir), 0.0);
  col += sunCol * pow(s, 420.0) * 1.10;
  col += sunCol * pow(s, 9.0) * 0.16;
  col += sunCol * pow(s, 1.6) * 0.030;

  return col;
}
`;

/* Cheap value noise, shared by the water. Same hash shape as the terrain
   generator so the two never drift apart in character. */
export const NOISE_FN = /* glsl */ `
float vhash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
    mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
`;
