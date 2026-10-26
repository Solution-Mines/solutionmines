"use client";

import { useEffect, useRef, useState } from "react";
import { Renderer, Camera, Transform, Geometry, Program, Mesh } from "ogl";
import { buildVeins, VEIN_BOUNDS, type VeinGeometry } from "@/lib/mine/veins";

/* ----------------------------------------------------------------------------
   THE MINE FIELD

   An ore-vein structure rendered as an additive point cloud. OGL rather than
   Three.js: measured in this project, three.js costs +128 KB gzipped against
   OGL's +13.5 KB for the same point cloud, and almost all of that difference
   is materials, lights, loaders and raycasting we would never call.

   The canvas is transparent and blends additively onto the CSS background,
   which means the dark of the rock is a real painted surface rather than
   something the GPU has to draw. If WebGL is unavailable the section loses a
   backdrop and keeps every word, exactly as the shader prototypes do.

   Colours are the dark-band tokens, not new ones: ore is --color-signal-300
   (#ff6a3d), the colour this design system already switches the accent to on
   near-black, and the barren rock is --color-ink-400.

   EXTRACTION
   Each seam is worked as the descending cut reaches it. That is deliberately
   derived from the single scroll uniform plus each point's own seam depth,
   rather than from five per-level uniforms: GLSL ES 1.00 is awkward about
   indexing a uniform array with a non-constant index, and more importantly a
   seam has to fire as ONE event. Trigger it per point and a vein tears in
   half as the cut crosses it.
-------------------------------------------------------------------------------*/

const ORE: [number, number, number] = [1.0, 0.416, 0.239]; // #ff6a3d
const ROCK: [number, number, number] = [0.525, 0.518, 0.494]; // #86847e

const VERTEX = `
precision highp float;

attribute vec3 position;
attribute float along;
attribute float depth;
attribute float level;
attribute float thickness;
attribute float seed;
attribute float ore;
attribute float anchorDepth;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uProgress;
/* drawingBufferHeight / (2 * tan(fov/2)). Converts a world-space diameter
   into pixels at unit distance, which is the term that was missing once:
   without it point size has no relationship to the projection, every point
   floors at 1px, and seventeen thousand of them read as dust. */
uniform float uPointScale;
uniform float uYTop;
uniform float uYBot;
uniform float uShaftR;
/* 0 disables extraction outright, for reduced motion: the travel is the part
   of this that is vestibular, the structure itself is not. */
uniform float uExtractOn;

varying float vLit;
varying float vOre;
varying float vExtract;

void main() {
  vec3 p = position;

  /* Breathing. Amplitude rises with depth so the surface stays stable and the
     deep rock feels alive -- the opposite reads as an earthquake at the
     entrance and dead ground below. */
  float wobble = sin(uTime * 0.6 + seed * 31.4) * 0.004 * (0.3 + depth);
  p.x += wobble;
  p.z += wobble * 0.5;

  /* The descending cut. uProgress is a plane travelling down through the
     rock; rock above it has been exposed, rock below is still buried. */
  float exposed = 1.0 - smoothstep(uProgress - 0.02, uProgress + 0.18, depth);

  /* The flow pulse: light running outward from the shaft along each vein.
     Driven by 'along' (0 at the shaft wall, 1 at the tip) so it reads as
     something travelling THROUGH the vein, not a global brightness cycle.
     Levels are offset by 'level' so the five seams do not pulse in unison. */
  float phase = fract(uTime * 0.22 - along * 0.9 + level * 0.19);
  float pulse = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.1, 0.42, phase));

  /* --- extraction -------------------------------------------------------- */
  float seamWorked = clamp((uProgress - anchorDepth) / 0.17, 0.0, 1.0) * uExtractOn;
  /* Only SOME of the ore rides out. If every ore point travelled, working a
     seam would delete the vein the seam is made of, and the mine would empty
     out behind you until the screen was bare -- which is precisely what the
     first attempt did. The ore that stays simply loses its colour, so a
     worked seam reads as depleted rather than erased. */
  float travels = step(0.62, seed) * step(0.45, ore);
  /* Outer ore leaves last, so a seam empties from the shaft outward -- which
     is the direction a seam is actually worked. */
  float local = clamp((seamWorked * travels - along * 0.28) / 0.72, 0.0, 1.0);

  float anchorY = uYTop + (uYBot - uYTop) * anchorDepth;
  /* Spread around the shaft axis. Without it every drained point converges on
     one coordinate and the seam leaves as a single rising dot. */
  float ang = seed * 6.2831;
  vec3 mouth = vec3(cos(ang) * uShaftR * 0.85, anchorY, sin(ang) * uShaftR * 0.5);

  // Drain inward along the vein, then ride up the shaft and out.
  p = mix(p, mouth, smoothstep(0.0, 0.55, local));
  float lift = smoothstep(0.45, 1.0, local + (seed - 0.5) * 0.22);
  p = mix(p, vec3(mouth.x, uYTop, mouth.z), lift);

  // Ore that left the mine is gone; ore that stayed is merely poorer rock.
  float spent = smoothstep(0.9, 1.0, local);

  vOre = ore * (1.0 - seamWorked * 0.45 * (1.0 - travels));
  vExtract = local;
  vLit = (exposed * (0.92 + pulse * 0.55) + local * 0.95) * (1.0 - spent * 0.92);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  /* A world-space diameter converted to pixels by the projection. Hair-thin
     capillaries land around 3px and ore trunks around 13px, which is the
     range where neighbouring sprites fuse into a continuous vein instead of
     either dotting or smearing. Travelling ore swells slightly, so a mote
     reads as a lump of something rather than a spark. */
  float size = (0.0035 + thickness * 0.012) * (0.7 + pulse * 0.6 + local * 0.5);
  gl_PointSize = max(1.0, size * uPointScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
precision highp float;

uniform vec3 uOre;
uniform vec3 uRock;

varying float vLit;
varying float vOre;
varying float vExtract;

void main() {
  /* Round sprite with a soft exponential falloff. A wider tail than looks
     right in isolation: the overlap between neighbouring sprites is what
     fuses them into a seam rather than a dotted line. */
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = exp(-d * 4.6) * vLit;

  vec3 col = mix(uRock, uOre, vOre);
  /* Both a bright pulse and ore in transit push toward white-hot rather than
     merely more orange, which is what makes them read as light rather than
     as paint. */
  float hot = max(smoothstep(0.55, 1.0, vLit), vExtract * 0.8);
  col = mix(col, vec3(1.0, 0.86, 0.78), hot * 0.55);

  /* NOT premultiplied. The blend is (SRC_ALPHA, ONE), so the pipeline already
     multiplies by 'a' - doing it here as well weights every point by a
     squared, which is why thousands of additive sprites can still come out
     near-invisible. */
  gl_FragColor = vec4(col, a);
}
`;

type Teardown = () => void;

/* Split out of the effect because it cannot run until the worker answers, and
   an effect body that conditionally sets up half a renderer is exactly where
   teardown bugs breed. */
function mountField(
  canvas: HTMLCanvasElement,
  veins: VeinGeometry,
  opts: { maxDpr: number; reduced: boolean; progress?: { current: number } },
): Teardown {
  const { maxDpr, reduced, progress } = opts;

  let renderer: Renderer;
  try {
    renderer = new Renderer({
      canvas,
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
      dpr: Math.min(window.devicePixelRatio || 1, maxDpr),
    });
  } catch {
    return () => {};
  }

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);

  const FOV = 42;
  const camera = new Camera(gl, { fov: FOV, near: 0.1, far: 20 });
  camera.position.set(0, 0, 1.85);

  const scene = new Transform();
  /* The structure spans y -0.96..-0.06. Lifting the whole scene puts its
     middle on the origin so the camera needs no offset, and so a scroll-driven
     camera move later is a straight translation. */
  scene.position.y = 0.51;

  const geometry = new Geometry(gl, {
    position: { size: 3, data: veins.position },
    along: { size: 1, data: veins.along },
    depth: { size: 1, data: veins.depth },
    level: { size: 1, data: veins.level },
    thickness: { size: 1, data: veins.thickness },
    seed: { size: 1, data: veins.seed },
    ore: { size: 1, data: veins.ore },
    anchorDepth: { size: 1, data: veins.anchorDepth },
  });

  const program = new Program(gl, {
    vertex: VERTEX,
    fragment: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: reduced ? 0.55 : 0.08 },
      uPointScale: { value: 1 },
      uYTop: { value: VEIN_BOUNDS.yTop },
      uYBot: { value: VEIN_BOUNDS.yBot },
      uShaftR: { value: VEIN_BOUNDS.shaftR },
      uExtractOn: { value: reduced ? 0 : 1 },
      uOre: { value: ORE },
      uRock: { value: ROCK },
    },
    transparent: true,
    // Additive. Depth testing is off on purpose: these are emissive points
    // with no occlusion, and sorting thousands of them every frame would cost
    // more than the overlap is worth.
    depthTest: false,
    depthWrite: false,
    cullFace: false,
  });
  program.setBlendFunc(gl.SRC_ALPHA, gl.ONE);

  const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });
  mesh.setParent(scene);

  let w = 0;
  let h = 0;
  const resize = () => {
    /* Measure the PARENT, not the canvas. OGL's setSize writes inline
       width/height in px onto the canvas, and an inline style outranks the
       stylesheet rule that stretches it -- so measuring the canvas means
       measuring whatever OGL last wrote, and the very first measurement
       (taken before layout, when a canvas is its default 300x150) gets frozen
       in permanently. */
    const box = canvas.parentElement ?? canvas;
    const rect = box.getBoundingClientRect();
    const nw = Math.max(1, Math.round(rect.width));
    const nh = Math.max(1, Math.round(rect.height));
    if (nw === w && nh === h) return;
    w = nw;
    h = nh;
    renderer.setSize(w, h);
    // Hand the element back to the stylesheet after setSize has had its way.
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.perspective({ aspect: w / h });
    /* On a wide viewport the words occupy the left half, so the structure is
       pushed clear of them rather than sitting behind a scrim dense enough to
       erase it. Narrow viewports stack the type over the field instead, and
       there is nowhere to push it to. */
    scene.position.x = w / h > 1.3 ? 0.4 : 0;
    /* Derived from the drawing buffer, which already includes DPR, so point
       size stays physically constant across a retina/non-retina move. */
    program.uniforms.uPointScale.value =
      gl.drawingBufferHeight / (2 * Math.tan((FOV * Math.PI) / 360));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement ?? canvas);
  resize();

  let visible = true;
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  let hidden = document.hidden;
  const onVisibility = () => {
    hidden = document.hidden;
  };
  document.addEventListener("visibilitychange", onVisibility);

  const t0 = performance.now();
  let raf = 0;
  let timer = 0;
  let eased = reduced ? 0.55 : 0.08;

  const draw = (now: number) => {
    const t = (now - t0) / 1000;
    program.uniforms.uTime.value = t;

    if (progress) {
      // Eased toward the scroll value rather than assigned: a scrubbed
      // ScrollTrigger delivers steps, and the cut should glide between them.
      eased += (progress.current - eased) * 0.08;
      program.uniforms.uProgress.value = eased;
    }

    /* A slow yaw, so the structure reads as volume rather than a flat drawing.
       Small: past a few degrees the cross-section stops reading as a cutaway
       and starts reading as an object spinning in a void. */
    scene.rotation.y = Math.sin(t * 0.08) * 0.13;

    renderer.render({ scene, camera });

    if (reduced) return;

    /* Off-screen or backgrounded: a slow poll instead of a per-frame loop. The
       rAF handle and the timeout handle stay separate because
       cancelAnimationFrame cannot cancel a setTimeout. */
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
    document.removeEventListener("visibilitychange", onVisibility);
    /* Delete the GL objects, but do NOT force the context lost. A canvas hands
       back the same context object every time, and a lost one stays lost -- so
       under StrictMode's deliberate mount/unmount/mount the second run would
       rebuild onto a dead context and every shader would fail to compile with
       a null info log. The context dies with the canvas when React removes it,
       which is soon enough. */
    geometry.remove();
    program.remove();
  };
}

export function MineField({
  className,
  progress,
  maxDpr = 1.5,
  onReady,
}: {
  className?: string;
  /** Scroll position 0..1, held in a ref so scrolling never re-renders. */
  progress?: { current: number };
  maxDpr?: number;
  onReady?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";

    let disposed = false;
    let teardown: Teardown | null = null;
    let worker: Worker | null = null;

    const begin = (veins: VeinGeometry) => {
      // The worker can answer after the component has already gone.
      if (disposed) return;
      teardown = mountField(canvas, veins, { maxDpr, reduced, progress });
      onReady?.();
    };

    /* Falling back to the main thread is a worse outcome than the worker but a
       far better one than no field at all: the cost is one stall on a
       decoration, where the alternative is a permanently empty section. */
    const buildHere = () => {
      try {
        begin(buildVeins());
      } catch {
        setFailed(true);
      }
    };

    try {
      worker = new Worker(
        new URL("../../lib/mine/veins.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (
        event: MessageEvent<VeinGeometry | { error: string }>,
      ) => {
        if ("error" in event.data) {
          buildHere();
          return;
        }
        begin(event.data);
        worker?.terminate();
        worker = null;
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        buildHere();
      };
      worker.postMessage({});
    } catch {
      buildHere();
    }

    return () => {
      disposed = true;
      worker?.terminate();
      teardown?.();
    };
  }, [maxDpr, progress, onReady]);

  if (failed) return null;

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
