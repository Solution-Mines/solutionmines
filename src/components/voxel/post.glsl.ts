/* ----------------------------------------------------------------------------
   THE FILM PASS

   The scene is rendered in linear light into a half-float target, where a
   lantern flame or a crystal facet is allowed to be brighter than white --
   which is the whole of what lets it glow. These passes then turn that into
   a picture:

   1. BLOOM. Everything above a soft threshold is pulled out, blurred down a
      chain of ever-smaller targets and back up again, and added back. Light
      that spills past the edges of its source is the single most cinematic
      thing a renderer can do, and the references are full of it: the torch in
      reference 2, the crystal in 9, the shaft of daylight in 4.

   2. TONE MAPPING. A filmic curve rather than a clip: highlights roll off
      into colour instead of slamming into flat white, and shadows keep a
      little lift. The scene shaders no longer encode for the screen at all
      when this path is on -- they hand over linear light and this pass is the
      one place it becomes pixels.

   3. GRADING. Saturation and contrast, cool shadows and warm highlights --
      the teal-and-orange split every one of the reference renders shares --
      and a gentle vignette to hold the eye in the middle of the frame.

   4. DITHER. A half-step of noise before quantising to 8 bits, because a
      dark cave fading through fog to blue is exactly the gradient that bands.
-------------------------------------------------------------------------------*/

export const POST_VERTEX = /* glsl */ `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/* Bright pass. A soft knee rather than a hard cut, so a surface brightening
   through the threshold fades its glow in instead of switching it on. Also a
   4x4 average on the way down to half resolution, which is what stops single
   bright pixels -- a sparkle, a specular glint -- flickering as fireflies. */
export const PREFILTER_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 fragColor;
vec3 bright(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = (rq * rq) / (4.0 * uKnee + 1e-4);
  return c * (max(rq, br - uThreshold) / max(br, 1e-4));
}
/* One bad pixel in the scene -- a NaN from some edge case in a shader, or a
   value past what half floats hold -- would be blurred by the chain below
   into a black octagon a third of the screen across. It has happened once,
   in one frame. So the glow refuses anything that is not a finite number,
   and caps what it accepts, before a single tap is spread. */
vec3 safe(vec3 c) {
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  return min(c, vec3(64.0));
}
void main() {
  vec3 c = safe(texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb)
         + safe(texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb)
         + safe(texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb)
         + safe(texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
  fragColor = vec4(bright(c * 0.25), 1.0);
}
`;

/* Dual-filter blur, down then up. Five taps going down and eight coming up,
   each one a bilinear fetch that already averages four texels -- a wide,
   smooth blur for a handful of samples per pixel at a fraction of the
   screen's resolution. */
export const DOWN_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 4.0
         + texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  fragColor = vec4(c / 8.0, 1.0);
}
`;

export const UP_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 t = uTexel;
  vec3 c = texture(uSrc, vUv + vec2(-2.0 * t.x, 0.0)).rgb
         + texture(uSrc, vUv + vec2( 2.0 * t.x, 0.0)).rgb
         + texture(uSrc, vUv + vec2(0.0, -2.0 * t.y)).rgb
         + texture(uSrc, vUv + vec2(0.0,  2.0 * t.y)).rgb
         + texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb * 2.0
         + texture(uSrc, vUv + vec2( t.x, -t.y)).rgb * 2.0
         + texture(uSrc, vUv + vec2(-t.x,  t.y)).rgb * 2.0
         + texture(uSrc, vUv + vec2( t.x,  t.y)).rgb * 2.0;
  fragColor = vec4(c / 12.0, 1.0);
}
`;

export const COMPOSITE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uVignette;
/** The film toe: how far the deepest shadows come up. */
uniform float uToe;
in vec2 vUv;
out vec4 fragColor;

/* The fitted ACES curve. Filmic: it lifts the darks a touch, keeps the mids
   where they were, and rolls the highlights off over a long shoulder. */
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 hdr = texture(uScene, vUv).rgb;
  // The same refusal as the bright pass, for the pixel itself.
  if (any(isnan(hdr)) || any(isinf(hdr))) hdr = vec3(0.0);
  vec3 glow = texture(uBloom, vUv).rgb;
  vec3 c = aces((hdr + glow * uBloomStrength) * uExposure);
  vec3 s = encode(c);

  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  s = mix(vec3(l), s, uSaturation);
  s = (s - 0.5) * uContrast + 0.5;
  // Cool into the shadows, warm into the highlights: the split every
  // reference render shares, kept to a tint rather than a wash.
  s += uShadowTint * (1.0 - l) * (1.0 - l) * 0.5;
  s += uHighlightTint * l * l * 0.5;

  vec2 q = vUv - 0.5;
  s *= 1.0 - dot(q, q) * uVignette;

  /* A toe, last, so it holds in the vignetted corners too. A cliff in
     shadow went to a flat black in the frame -- a fifth of the second act's
     picture -- with all the stone in it lost. This lifts only the bottom of
     the range, fading to nothing by a third of the way up: the blacks stay
     dark, the shadows get their texture back, and the mids and highlights
     are untouched. */
  float toe = max(0.0, 1.0 - max(s.r, max(s.g, s.b)) / 0.3);
  s += uToe * toe * toe;

  s += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
}
`;
