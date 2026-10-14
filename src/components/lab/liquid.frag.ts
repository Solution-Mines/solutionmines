/* A signed-distance metaball field, solved per pixel.

   Six sources — five on slow orbits plus your pointer — unioned with a
   polynomial smooth-min so they merge into each other rather than overlapping
   like circles. The colour is derived from the field value itself (iso-bands,
   a rim where the gradient is steep), so nothing here is a texture or a
   pre-baked gradient: change the pointer and the geometry genuinely re-solves. */

export const LIQUID_FRAG = `#version 300 es
precision highp float;

out vec4 outColor;

uniform float u_time;
uniform vec2  u_res;
uniform vec2  u_pointer;
uniform float u_energy;

/* Quadratic polynomial smooth minimum (Quilez). k controls the blend radius. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float field(vec2 p, float t, vec2 ptr, float energy, float ar) {
  float d = 1e9;

  // Five orbiting sources. Irrational-ish frequency ratios keep the loop from
  // visibly repeating.
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = t * (0.17 + fi * 0.043) + fi * 2.399;
    /* Centred at ~2/3 across rather than at 0.5: the headline occupies the
       left of the hero, and a field that drifts under type is a legibility
       problem no text-shadow fully solves. Offsets stay in y-units so the
       sources remain round at any aspect ratio. */
    /* Both the centre AND the orbit radius scale with aspect ratio. Keeping
       the radius in absolute y-units looked right at 16:9 and swept the whole
       width on a phone, straight through the headline. */
    float yBias = 0.46 - 0.26 * smoothstep(1.0, 0.55, ar);
    vec2 c = vec2(
      ar * (0.62 + cos(a) * (0.20 + 0.04 * sin(t * 0.3 + fi))),
      yBias + sin(a * 0.83 + fi) * 0.24
    );
    float r = 0.085 + 0.035 * sin(t * 0.41 + fi * 1.7);
    d = smin(d, distance(p, c) - r, 0.16);
  }

  // The pointer is a sixth source that swells as you move.
  float pr = 0.075 + 0.055 * energy;
  d = smin(d, distance(p, ptr) - pr, 0.18);

  return d;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float ar = u_res.x / max(u_res.y, 1.0);

  vec2 p = vec2(uv.x * ar, uv.y);
  vec2 ptr = vec2(u_pointer.x * ar, u_pointer.y);
  float t = u_time;

  float d = field(p, t, ptr, u_energy, ar);

  vec3 bg = vec3(0.020, 0.024, 0.039);
  vec3 mint = vec3(0.180, 1.000, 0.769);
  vec3 violet = vec3(0.478, 0.361, 1.000);

  // Interior: a violet-to-mint ramp driven by depth inside the surface.
  float inside = smoothstep(0.012, -0.075, d);
  vec3 col = mix(bg, mix(violet, mint, smoothstep(0.0, -0.16, d)) * 0.55, inside);

  // Rim: a bright, thin iso-line exactly at the surface. This is what makes it
  // read as liquid rather than as a blurred blob.
  float rim = exp(-abs(d) * 115.0);
  col += mint * rim * 0.85;

  // Outer falloff, so the field lights the page rather than sitting on it.
  col += violet * exp(-max(d, 0.0) * 9.0) * 0.22;

  // Interior contour bands — the "solved" look.
  float bands = smoothstep(0.92, 1.0, abs(sin(d * 62.0)));
  col += mint * bands * inside * 0.16;

  // Vignette, then a touch of ordered noise to kill 8-bit banding in the
  // large dark areas.
  col *= 1.0 - 0.55 * pow(length(uv - 0.5) * 1.35, 2.2);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;

  outColor = vec4(col, 1.0);
}
`;
