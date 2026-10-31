import { Geometry, Mesh, Program, RenderTarget, type Renderer, type Transform, type Camera } from "ogl";
import {
  POST_VERTEX,
  PREFILTER_FRAGMENT,
  DOWN_FRAGMENT,
  UP_FRAGMENT,
  COMPOSITE_FRAGMENT,
} from "./post.glsl";

/* ----------------------------------------------------------------------------
   THE FILM PIPELINE

   Owns the half-float target the scene is drawn into, the chain of shrinking
   targets the bloom is blurred through, and the four small programs that run
   over them. One call per frame: draw the scene, find its glow, grade it,
   put it on the canvas.

   Five bloom levels, from half resolution down to a thirty-second. Each pass
   is one triangle covering the screen at that level's size, so the whole
   chain costs about as many pixels as a third of one full-resolution pass.

   Built only where a half-float target can actually be rendered to. Where it
   cannot, `createFilm` returns null and the renderer keeps drawing straight
   to the canvas, tone-mapping in each shader instead -- no glow, but a
   correct picture.
-------------------------------------------------------------------------------*/

export type Grade = {
  /** Scene brightness into the tone curve. Raised underground, where the eye
      would have adapted to the dark. */
  exposure: number;
  /** How much glow is added back. */
  bloom: number;
  /** Linear light above which things glow, and how soft the onset is. */
  threshold: number;
  knee: number;
  saturation: number;
  contrast: number;
  /** Added to the shadows and the highlights respectively, in display space. */
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  vignette: number;
  /** How far the deepest shadows are lifted, in display space: a film toe.
      Zero leaves the curve alone. */
  toe: number;
};

const LEVELS = 5;

export type Film = {
  render: (scene: Transform, camera: Camera, grade: Grade) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

export function createFilm(renderer: Renderer, width: number, height: number): Film | null {
  const gl = renderer.gl;
  if (!renderer.isWebgl2) return null;
  const g2 = gl as unknown as WebGL2RenderingContext;

  const hdrTarget = (w: number, h: number, depth: boolean) =>
    new RenderTarget(gl, {
      width: Math.max(1, w),
      height: Math.max(1, h),
      type: g2.HALF_FLOAT,
      internalFormat: g2.RGBA16F,
      format: g2.RGBA,
      depth,
      minFilter: g2.LINEAR,
      magFilter: g2.LINEAR,
    });

  const scene = hdrTarget(width, height, true);
  /* Ask, rather than assume. Rendering to a half-float target needs an
     extension most WebGL2 contexts have and some do not, and a framebuffer
     that cannot be completed draws nothing at all -- a black page. */
  renderer.bindFramebuffer(scene);
  const ok = g2.checkFramebufferStatus(g2.FRAMEBUFFER) === g2.FRAMEBUFFER_COMPLETE;
  renderer.bindFramebuffer();
  if (!ok) {
    g2.deleteFramebuffer(scene.buffer);
    g2.deleteTexture(scene.texture.texture);
    return null;
  }

  const size = (i: number, w: number, h: number) => [Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))];
  const chain: RenderTarget[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const [w, h] = size(i, width, height);
    chain.push(hdrTarget(w, h, false));
  }

  const triangle = new Geometry(gl, {
    position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
  });
  const pass = (fragment: string, uniforms: Record<string, { value: unknown }>) => {
    const program = new Program(gl, {
      vertex: POST_VERTEX,
      fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
      cullFace: false,
    });
    const mesh = new Mesh(gl, { geometry: triangle, program });
    mesh.frustumCulled = false;
    return { program, mesh };
  };

  const pre = pass(PREFILTER_FRAGMENT, {
    uSrc: { value: scene.texture },
    uTexel: { value: [1 / width, 1 / height] },
    uThreshold: { value: 1 },
    uKnee: { value: 0.5 },
  });
  const down = pass(DOWN_FRAGMENT, { uSrc: { value: null }, uTexel: { value: [0, 0] } });
  const up = pass(UP_FRAGMENT, { uSrc: { value: null }, uTexel: { value: [0, 0] } });
  // Added onto what the larger level already holds: that is the accumulation.
  up.program.setBlendFunc(gl.ONE, gl.ONE);
  const comp = pass(COMPOSITE_FRAGMENT, {
    uScene: { value: scene.texture },
    uBloom: { value: chain[0].texture },
    uExposure: { value: 1 },
    uBloomStrength: { value: 0.8 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uShadowTint: { value: [0, 0, 0] },
    uHighlightTint: { value: [0, 0, 0] },
    uVignette: { value: 0 },
    uToe: { value: 0 },
  });

  let w = width;
  let h = height;

  const render = (root: Transform, camera: Camera, grade: Grade) => {
    renderer.render({ scene: root, camera, target: scene });

    const pu = pre.program.uniforms;
    pu.uTexel.value = [1 / w, 1 / h];
    pu.uThreshold.value = grade.threshold;
    pu.uKnee.value = grade.knee;
    renderer.render({ scene: pre.mesh, target: chain[0] });

    for (let i = 0; i < LEVELS - 1; i++) {
      down.program.uniforms.uSrc.value = chain[i].texture;
      down.program.uniforms.uTexel.value = [1 / chain[i].width, 1 / chain[i].height];
      renderer.render({ scene: down.mesh, target: chain[i + 1] });
    }
    for (let i = LEVELS - 1; i > 0; i--) {
      up.program.uniforms.uSrc.value = chain[i].texture;
      up.program.uniforms.uTexel.value = [0.5 / chain[i].width, 0.5 / chain[i].height];
      renderer.render({ scene: up.mesh, target: chain[i - 1], clear: false });
    }

    const cu = comp.program.uniforms;
    cu.uExposure.value = grade.exposure;
    cu.uBloomStrength.value = grade.bloom;
    cu.uSaturation.value = grade.saturation;
    cu.uContrast.value = grade.contrast;
    cu.uShadowTint.value = grade.shadowTint;
    cu.uHighlightTint.value = grade.highlightTint;
    cu.uVignette.value = grade.vignette;
    cu.uToe.value = grade.toe;
    renderer.render({ scene: comp.mesh });
  };

  const resize = (nw: number, nh: number) => {
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    scene.setSize(w, h);
    chain.forEach((t, i) => {
      const [cw, ch] = size(i, w, h);
      t.setSize(cw, ch);
    });
  };

  const dispose = () => {
    for (const t of [scene, ...chain]) {
      g2.deleteFramebuffer(t.buffer);
      for (const tex of t.textures) g2.deleteTexture(tex.texture);
    }
    // The scene target's depth is a renderbuffer, not a texture.
    const depth = (scene as unknown as { depthBuffer?: WebGLRenderbuffer }).depthBuffer;
    if (depth) g2.deleteRenderbuffer(depth);
    triangle.remove();
    for (const p of [pre, down, up, comp]) p.program.remove();
  };

  return { render, resize, dispose };
}
