/* Ordered-dither field.

   The whole image is reduced to three ink levels through an 8x8 Bayer
   threshold, so what you see is genuinely 1-bit-per-channel output rather
   than a smooth gradient with a noise overlay. That constraint is the point:
   it is impossible to arrive at this look by accident, and it reads as
   printed matter rather than as a web gradient. */

export const DITHER_FRAG = `#version 300 es
precision highp float;

out vec4 outColor;

uniform float u_time;
uniform vec2  u_res;
uniform vec2  u_pointer;
uniform float u_energy;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return sum;
}

/* Classic 8x8 Bayer matrix built by interleaving the bits of x and y.
   Cheaper than a texture lookup and exact. */
float bayer(ivec2 c) {
  int x = c.x & 7;
  int y = c.y & 7;
  int v = 0;
  for (int i = 2; i >= 0; i--) {
    int xb = (x >> i) & 1;
    int yb = (y >> i) & 1;
    v = (v << 2) | ((yb ^ xb) << 1) | xb;
  }
  return float(v) / 64.0;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;
  float ar = u_res.x / max(u_res.y, 1.0);

  vec2 p = vec2(uv.x * ar, uv.y);
  vec2 ptr = vec2(u_pointer.x * ar, u_pointer.y);

  float t = u_time * 0.05;
  float f = fbm(p * 2.6 + vec2(t, -t * 0.7));
  f += 0.24 * sin(p.y * 3.1 - u_time * 0.2 + f * 3.4);

  // The pointer is a light source pressed into the plate.
  float d = distance(p, ptr);
  f += exp(-d * 3.2) * (0.30 + 0.45 * u_energy);

  // Tonal ramp: dense at the bottom, open at the top, like an exposure.
  // The constants are a gain and a bias on a field whose mean is ~0.5; they
  // were tuned on screen, because 1-bit coverage is impossible to predict.
  float v = clamp((f - 0.34 - 0.10 * uv.y) * 1.25, 0.0, 1.0);

  // Clamp the tails. Without this the "empty" areas carry a 5% speckle and
  // the plate never reads as having clean paper in it.
  v = smoothstep(0.06, 0.94, v);

  // Quantise the sampling grid so dots are visible rather than pixel-fine.
  float th = bayer(ivec2(floor(frag / 2.0)));

  float ink = step(th, v);
  // Accent is a tight hotspot under the cursor only — never a wash.
  float core = step(th, v - 0.38) * exp(-d * 4.5);

  vec3 paper = vec3(0.910, 0.894, 0.855);
  vec3 black = vec3(0.043, 0.043, 0.043);
  vec3 accent = vec3(1.000, 0.302, 0.000);

  vec3 col = mix(paper, black, ink);
  col = mix(col, accent, core);

  outColor = vec4(col, 1.0);
}
`;
