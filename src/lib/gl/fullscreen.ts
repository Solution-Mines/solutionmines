/* ----------------------------------------------------------------------------
   Minimal fullscreen-quad WebGL2 renderer.

   Both shader prototypes are single fragment shaders over a fullscreen quad,
   so Three.js would be ~150KB gzip for a feature this file provides in a
   couple of hundred lines with no dependency. That matters: the point of the
   prototypes is to judge the IDEA, and a fair judgement includes its real cost.

   What it handles so each prototype does not re-solve it:
   - device pixel ratio, capped (an uncapped DPR on a 3x phone quadruples the
     fragment count for no visible gain)
   - resize via ResizeObserver, not window.resize
   - pausing when the canvas scrolls out of view or the tab is hidden — an
     always-running shader off-screen is pure battery waste
   - a smoothed pointer, so shaders get motion rather than teleporting values
   - full teardown of the rAF loop, observers and GL objects
-------------------------------------------------------------------------------*/

export type Uniforms = {
  u_time: number;
  u_res: [number, number];
  /** Smoothed pointer in 0..1 space, origin bottom-left to match GL. */
  u_pointer: [number, number];
  /** 0 when idle, rises toward 1 while the pointer moves. */
  u_energy: number;
};

export type FullscreenOptions = {
  fragment: string;
  /** Hard cap on devicePixelRatio. 1.5 is plenty for a soft shader field. */
  maxDpr?: number;
  /** Render one frame and stop — used for reduced motion. */
  still?: boolean;
  onError?: (message: string) => void;
};

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("could not create shader");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

export function mountFullscreenShader(
  canvas: HTMLCanvasElement,
  opts: FullscreenOptions,
): () => void {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });

  if (!gl) {
    opts.onError?.("WebGL2 unavailable");
    return () => {};
  }

  let program: WebGLProgram | null = null;
  try {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, opts.fragment);
    program = gl.createProgram();
    if (!program) throw new Error("could not create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  } catch (e) {
    opts.onError?.(e instanceof Error ? e.message : String(e));
    return () => {};
  }

  gl.useProgram(program);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, "u_time");
  const uRes = gl.getUniformLocation(program, "u_res");
  const uPtr = gl.getUniformLocation(program, "u_pointer");
  const uEnergy = gl.getUniformLocation(program, "u_energy");

  const maxDpr = opts.maxDpr ?? 1.5;
  let w = 0;
  let h = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const rect = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(rect.width * dpr));
    const nh = Math.max(1, Math.round(rect.height * dpr));
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /* Pointer is tracked on the window, not the canvas: the canvas usually sits
     behind content, so canvas-local listeners would never fire. */
  const target = { x: 0.5, y: 0.5 };
  const smooth = { x: 0.5, y: 0.5 };
  let energy = 0;

  const onPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    target.x = (e.clientX - rect.left) / Math.max(rect.width, 1);
    // flip Y: CSS grows downward, GL upward
    target.y = 1 - (e.clientY - rect.top) / Math.max(rect.height, 1);
    energy = 1;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let visible = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  const onVisibility = () => {
    hidden = document.hidden;
  };
  let hidden = document.hidden;
  document.addEventListener("visibilitychange", onVisibility);

  let raf = 0;
  let timer = 0;
  const start = performance.now();

  const draw = (now: number) => {
    const t = (now - start) / 1000;

    smooth.x += (target.x - smooth.x) * 0.06;
    smooth.y += (target.y - smooth.y) * 0.06;
    energy *= 0.95;

    gl.uniform1f(uTime, t);
    gl.uniform2f(uRes, w, h);
    gl.uniform2f(uPtr, smooth.x, smooth.y);
    gl.uniform1f(uEnergy, energy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (opts.still) return;

    /* Off-screen or backgrounded: fall back to a slow poll rather than a
       per-frame loop. Keep the rAF handle and the timeout handle in separate
       variables — cancelAnimationFrame cannot cancel a setTimeout, and
       conflating them leaks a loop on unmount. */
    if (visible && !hidden) {
      raf = requestAnimationFrame(draw);
    } else {
      timer = window.setTimeout(() => {
        raf = requestAnimationFrame(draw);
      }, 250);
    }
  };

  raf = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener("pointermove", onPointer);
    document.removeEventListener("visibilitychange", onVisibility);
    gl.deleteBuffer(buf);
    gl.deleteVertexArray(vao);
    if (program) gl.deleteProgram(program);
  };
}
