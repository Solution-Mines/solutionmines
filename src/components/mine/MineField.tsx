"use client";

import { useEffect, useRef, useState } from "react";
import { Renderer, Camera, Transform, Geometry, Program, Mesh } from "ogl";
import { buildVeins } from "@/lib/mine/veins";

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

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uProgress;
/* drawingBufferHeight / (2 * tan(fov/2)). Converts a world-space diameter
   into pixels at unit distance, which is the term that was missing: without
   it point size has no relationship to the projection, so every point floors
   at 1px and nine thousand of them read as dust rather than as veins. */
uniform float uPointScale;

varying float vAlong;
varying float vThick;
varying float vSeed;
varying float vLit;
varying float vOre;

void main() {
  vec3 p = position;

  /* Breathing. Amplitude rises with depth so the surface stays stable and the
     deep rock feels alive -- the opposite reads as an earthquake at the
     entrance and dead ground below. */
  float wobble = sin(uTime * 0.6 + seed * 31.4) * 0.004 * (0.3 + depth);
  p.x += wobble;
  p.z += wobble * 0.5;

  /* The descending cut. uProgress is a plane travelling down through the
     rock; rock above it has been exposed, rock below is still buried. The
     0.18 band is the soft edge of the cut rather than a hard horizon. */
  float exposed = 1.0 - smoothstep(uProgress - 0.02, uProgress + 0.18, depth);

  /* The flow pulse: light running outward from the shaft along each vein.
     Driven by 'along' (0 at the shaft wall, 1 at the tip) so it reads as
     something travelling THROUGH the vein, not a global brightness cycle.
     Levels are offset by 'level' so the five seams do not pulse in unison. */
  float phase = fract(uTime * 0.22 - along * 0.9 + level * 0.19);
  float pulse = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.1, 0.42, phase));

  /* Ore sits in the thick trunks, with enough per-point noise that the
     boundary is ragged instead of a clean threshold. */
  vOre = smoothstep(0.18, 0.62, thickness * 0.75 + seed * 0.4);

  vAlong = along;
  vThick = thickness;
  vSeed = seed;
  vLit = exposed * (0.62 + pulse * 0.52);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);

  /* A world-space diameter, converted to pixels by the projection. Hair-thin
     capillaries land around 3px and ore trunks around 13px, which is the
     range where neighbouring sprites fuse into a continuous vein instead of
     either dotting or smearing. */
  float size = (0.0035 + thickness * 0.012) * (0.7 + pulse * 0.6);
  gl_PointSize = max(1.0, size * uPointScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
precision highp float;

uniform vec3 uOre;
uniform vec3 uRock;

varying float vAlong;
varying float vThick;
varying float vSeed;
varying float vLit;
varying float vOre;

void main() {
  /* Round sprite with a soft exponential falloff. An exponential rather than
     a smoothstep because additive blending stacks these by the thousand, and
     a long tail is what fuses neighbouring points into a continuous vein
     instead of a dotted line. */
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  /* A wider tail than looks right in isolation: the overlap between
     neighbouring sprites is what fuses them into a seam. */
  float a = exp(-d * 4.6) * vLit;

  vec3 col = mix(uRock, uOre, vOre);
  /* The brightest part of a pulse pushes toward white-hot rather than just
     more orange, which is what makes it read as light rather than paint. */
  col = mix(col, vec3(1.0, 0.86, 0.78), smoothstep(0.55, 1.0, vLit) * 0.5);

  /* NOT premultiplied. The blend is (SRC_ALPHA, ONE), so the pipeline already
     multiplies by 'a' - doing it here as well weights every point by a
     squared, which is why nine thousand additive sprites can still come out
     near-invisible. */
  gl_FragColor = vec4(col, a);
}
`;

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
      setFailed(true);
      return;
    }

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const FOV = 42;
    const camera = new Camera(gl, { fov: FOV, near: 0.1, far: 20 });
    camera.position.set(0, 0, 1.85);

    const scene = new Transform();
    /* The structure spans y -0.96..-0.06. Lifting the whole scene puts its
       middle on the origin so the camera does not need an offset, and so a
       scroll-driven camera move later is a straight translation. */
    scene.position.y = 0.51;

    const veins = buildVeins();

    const geometry = new Geometry(gl, {
      position: { size: 3, data: veins.position },
      along: { size: 1, data: veins.along },
      depth: { size: 1, data: veins.depth },
      level: { size: 1, data: veins.level },
      thickness: { size: 1, data: veins.thickness },
      seed: { size: 1, data: veins.seed },
    });

    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: reduced ? 1 : 0.08 },
        uPointScale: { value: 1 },
        uOre: { value: ORE },
        uRock: { value: ROCK },
      },
      transparent: true,
      // Additive. Depth testing is off on purpose: these are emissive points
      // with no occlusion, and sorting thousands of them every frame would
      // cost more than the overlap is worth.
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
         stylesheet rule that stretches it — so measuring the canvas means
         measuring whatever OGL last wrote, and the very first measurement
         (taken before layout, when a canvas is its default 300x150) gets
         frozen in permanently. */
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

    onReady?.();

    const start = performance.now();
    let raf = 0;
    let timer = 0;
    let eased = reduced ? 1 : 0.08;

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      program.uniforms.uTime.value = t;

      if (progress) {
        // Eased toward the scroll value rather than assigned: a scrubbed
        // ScrollTrigger delivers steps, and the cut should glide between them.
        eased += (progress.current - eased) * 0.08;
        program.uniforms.uProgress.value = eased;
      }

      /* A slow yaw, so the structure reads as volume rather than a flat
         drawing. Small: past a few degrees the cross-section stops reading
         as a cutaway and starts reading as an object spinning in a void. */
      scene.rotation.y = Math.sin(t * 0.08) * 0.13;

      renderer.render({ scene, camera });

      if (reduced) return;

      /* Off-screen or backgrounded: a slow poll instead of a per-frame loop.
         The rAF handle and the timeout handle stay separate because
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
      /* Delete the GL objects, but do NOT force the context lost. A canvas
         hands back the same context object every time, and a lost one stays
         lost — so under StrictMode's deliberate mount/unmount/mount the
         second run would rebuild onto a dead context and every shader would
         fail to compile with a null info log. The context dies with the
         canvas when React removes it, which is soon enough. */
      geometry.remove();
      program.remove();
    };
  }, [maxDpr, progress, onReady]);

  if (failed) return null;

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
