import { Camera, Mesh, RenderTarget, type Geometry, type Renderer } from "ogl";
import { FACE_BASIS } from "./blocks.glsl";
import { Program } from "./program";

/* ----------------------------------------------------------------------------
   THE SUN'S SHADOWS

   The single largest thing a film render has that the island did not: every
   tree, ledge and overhang throws a shadow, and the shadow is what tells the
   eye where the light is and how far apart things are.

   The island never moves and neither does the sun, so the shadow map is
   drawn ONCE, from the sun, just before the first frame -- one extra draw at
   startup and none per frame. Every textured program then compares its own
   depth from the sun against it.

   Back faces only. Rendering the side of each surface turned AWAY from the
   sun means a lit surface is compared against the far side of whatever it
   belongs to, a whole block away, rather than against itself -- which is
   what makes a face flicker between lit and shadowed. The faces that do
   compare against themselves are the ones turned away from the sun, which
   the lighting already leaves unlit.
-------------------------------------------------------------------------------*/

const SHADOW_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec3 position;
in vec3 aOffset;
in float aFace;
in float aMaterial;
in float aHalf;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
/** 0: the island closed. 1: open, without the half that slides away. */
uniform float uPass;
${FACE_BASIS}
void main() {
  bool front = mod(aHalf, 2.0) > 0.5;
  bool section = aHalf > 1.5;
  /* Water throws no shadow: a pond is a mirror, and the falls are a sheet of
     spray a shadow would read straight through. */
  if ((aMaterial > 5.5 && aMaterial < 7.5) || (uPass < 0.5 && section) || (uPass > 0.5 && front)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 n, t, b;
  faceBasis(aFace, n, t, b);
  vec3 world = aOffset + n * 0.5 + t * position.x + b * position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const SHADOW_FRAGMENT = /* glsl */ `#version 300 es
precision mediump float;
void main() {}
`;

/** What a receiving program needs: three uniforms, and its own registration
    so the sampler can be pointed at the right texture unit. */
export type SunShadow = {
  uniforms: {
    uShadowMap: { value: { texture: WebGLTexture; update: (unit: number) => void } };
    uShadowMapOpen: { value: { texture: WebGLTexture; update: (unit: number) => void } };
    uShadowMat: { value: Float32Array | number[] };
    uShadowOn: { value: number };
  };
  /** Call once per program that samples the map. Its sampler is looked up
      when the map is baked, by which time the program has linked. */
  register: (program: Program) => void;
  /** Draws the map, the first time it is called; nothing after that. Before
      any frame that samples it -- and after the shaders have compiled, or
      drawing here waits for them. */
  bake: () => void;
  dispose: () => void;
};

/** Null geometry gives a one-texel map that is never consulted: the shaders
    that declare the sampler still need a depth texture bound to it, or the
    draw is rejected outright. */
export function bakeSunShadow(
  renderer: Renderer,
  geometry: Geometry | null,
  faceOffset: Float32Array | null,
  sunDir: [number, number, number],
  mapSize: number,
): SunShadow {
  const gl = renderer.gl;
  const g2 = gl as unknown as WebGL2RenderingContext;
  const size = geometry && faceOffset ? mapSize : 1;
  const offsets = faceOffset ?? new Float32Array(3);

  /* The island's bounds, from the faces themselves. */
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < offsets.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], offsets[i + k] - 0.5);
      hi[k] = Math.max(hi[k], offsets[i + k] + 0.5);
    }
  }
  const centre: [number, number, number] = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;

  /* A camera at the sun, looking back at the middle of the island. Fitted to
     the box's eight corners in its own frame, so no texel of the map is spent
     on empty sky. */
  const cam = new Camera(gl, { left: -1, right: 1, bottom: -1, top: 1, near: 1, far: 2 });
  const back = radius + 10;
  cam.position.set(
    centre[0] + sunDir[0] * back,
    centre[1] + sunDir[1] * back,
    centre[2] + sunDir[2] * back,
  );
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const v = cam.viewMatrix;
  const bx = [Infinity, -Infinity];
  const by = [Infinity, -Infinity];
  const bz = [Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? hi[0] : lo[0];
    const y = c & 2 ? hi[1] : lo[1];
    const z = c & 4 ? hi[2] : lo[2];
    const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
    const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
    const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
    bx[0] = Math.min(bx[0], vx);
    bx[1] = Math.max(bx[1], vx);
    by[0] = Math.min(by[0], vy);
    by[1] = Math.max(by[1], vy);
    bz[0] = Math.min(bz[0], vz);
    bz[1] = Math.max(bz[1], vz);
  }
  cam.orthographic({
    left: bx[0] - 1,
    right: bx[1] + 1,
    bottom: by[0] - 1,
    top: by[1] + 1,
    near: Math.max(0.1, -bz[1] - 1),
    far: -bz[0] + 1,
  });
  cam.updateMatrixWorld();

  /* Depth only. Filtered with comparison on, so each lookup in the shader is
     already a 2x2 soft test rather than a hard one. Two of them: the island
     closed, and open with the half that slides away left out -- the sun into
     the opened mine. Both drawn now, once. */
  const depthTarget = () => {
    const target = new RenderTarget(gl, {
      width: size,
      height: size,
      color: 0,
      depth: true,
      depthTexture: true,
    });
    const depth = target.depthTexture;
    renderer.activeTexture(0);
    depth.bind();
    g2.texParameteri(g2.TEXTURE_2D, g2.TEXTURE_MIN_FILTER, g2.LINEAR);
    g2.texParameteri(g2.TEXTURE_2D, g2.TEXTURE_MAG_FILTER, g2.LINEAR);
    g2.texParameteri(g2.TEXTURE_2D, g2.TEXTURE_COMPARE_MODE, g2.COMPARE_REF_TO_TEXTURE);
    g2.texParameteri(g2.TEXTURE_2D, g2.TEXTURE_COMPARE_FUNC, g2.LEQUAL);
    // Tell OGL's own record, or the next update() would put NEAREST back.
    depth.minFilter = depth.magFilter = g2.LINEAR;
    depth.state.minFilter = depth.state.magFilter = g2.LINEAR;
    return { target, depth };
  };
  const closed = depthTarget();
  const open = depthTarget();

  renderer.bindFramebuffer(closed.target);
  const complete = g2.checkFramebufferStatus(g2.FRAMEBUFFER) === g2.FRAMEBUFFER_COMPLETE;
  renderer.bindFramebuffer();

  /* Made now, so its program compiles alongside every other (program.ts);
     drawn by bake(). */
  const pass = { value: 0 };
  const depthMesh =
    complete && geometry
      ? new Mesh(gl, {
          geometry,
          program: new Program(gl, {
            vertex: SHADOW_VERTEX,
            fragment: SHADOW_FRAGMENT,
            uniforms: { uPass: pass },
            depthTest: true,
            depthWrite: true,
            cullFace: gl.FRONT,
          }),
        })
      : null;
  if (depthMesh) depthMesh.frustumCulled = false;

  /* OGL has no case for a shadow sampler in its uniform switch, so it never
     tells the program which unit the map is on. Each sampler value does it
     itself: OGL hands it the unit just before it would have set the uniform,
     with the program already in use. */
  const state = (gl as unknown as { renderer: { state: { currentProgram: number } } }).renderer.state;
  const samplerFor = (depth: (typeof closed)["depth"]) => {
    const locations = new Map<number, WebGLUniformLocation>();
    return {
      locations,
      value: {
        texture: depth.texture,
        update(unit: number) {
          depth.update(unit);
          const at = locations.get(state.currentProgram);
          if (at) gl.uniform1i(at, unit);
        },
      },
    };
  };
  const closedSampler = samplerFor(closed.depth);
  const openSampler = samplerFor(open.depth);

  /* At the bake, not at registration: asking a program for a location waits
     for it to link. */
  const locate = (program: Program) => {
    const a = gl.getUniformLocation(program.program, "uShadowMap");
    if (a) closedSampler.locations.set(program.id, a);
    const b = gl.getUniformLocation(program.program, "uShadowMapOpen");
    if (b) openSampler.locations.set(program.id, b);
  };
  const registered: Program[] = [];
  let baked = false;

  return {
    uniforms: {
      uShadowMap: { value: closedSampler.value },
      uShadowMapOpen: { value: openSampler.value },
      uShadowMat: { value: cam.projectionViewMatrix },
      uShadowOn: { value: complete && geometry ? 1 : 0 },
    },
    register(program: Program) {
      if (baked) locate(program);
      else registered.push(program);
    },
    bake() {
      if (baked) return;
      baked = true;
      if (depthMesh) {
        renderer.render({ scene: depthMesh, camera: cam, target: closed.target });
        pass.value = 1;
        renderer.render({ scene: depthMesh, camera: cam, target: open.target });
        depthMesh.program.remove();
      }
      registered.forEach(locate);
    },
    dispose() {
      // Torn down before the first frame: the depth program was never drawn.
      if (!baked) depthMesh?.program.remove();
      for (const t of [closed, open]) {
        g2.deleteFramebuffer(t.target.buffer);
        g2.deleteTexture(t.depth.texture);
      }
    },
  };
}
