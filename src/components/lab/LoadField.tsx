"use client";

import { useEffect, useRef } from "react";

/* ----------------------------------------------------------------------------
   LOAD FIELD — a service topology in three dimensions, carrying real traffic.

   Nodes accumulate load as packets arrive and shed it over time; when one
   saturates it goes amber, stops forwarding, and its neighbours take the
   overflow — then it recovers. The readout the page draws from this is the
   simulation's own, not a timer.

   On the 3D: this is a real perspective projection with depth sorting, fog
   and parallax, written out rather than imported. Three.js would give the
   same picture for ~150 KB gzip before post-processing, and a scene graph is
   not what a few dozen points and lines need — there are no meshes, no
   materials, no loaders here. The cost of the whole file is about 9 KB.

   What makes it read as volume rather than a flat diagram: nodes are placed
   on three shells in depth, the camera orbits slowly, the pointer tilts it,
   everything is painted back-to-front, and size, brightness and glow all
   fall off with distance. Those four together are most of what a 3D engine
   would be doing for this scene anyway.
-------------------------------------------------------------------------------*/

type Node = {
  // model space, roughly -1..1
  x: number;
  y: number;
  z: number;
  load: number; // 0..1+
  saturated: number; // seconds remaining amber
  tier: number; // 0 edge, 1 service, 2 data
  // filled per frame
  sx: number;
  sy: number;
  sz: number;
  scale: number;
};

type Edge = { a: number; b: number };

type Packet = {
  e: number;
  t: number;
  speed: number;
  heat: number;
};

export type LoadStats = {
  rps: number;
  p99: number;
  saturated: number;
  depth: number;
};

/* Deterministic PRNG: the structure must be identical on every load. A
   topology that reshuffles on refresh reads as noise, not as a system. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTopology() {
  const rnd = mulberry32(0x5e1f);
  const nodes: Node[] = [];

  /* Three shells in depth rather than three columns on a plane. Each tier is
     a ring at its own z, phase-offset so edges cross the volume instead of
     running parallel — that crossing is what sells the depth. */
  const shells = [
    { z: -0.95, r: 0.58, n: 6, tier: 0, phase: 0.0 },
    { z: 0.0, r: 0.95, n: 11, tier: 1, phase: 0.42 },
    { z: 0.95, r: 0.66, n: 7, tier: 2, phase: 0.15 },
  ];

  for (const s of shells) {
    for (let i = 0; i < s.n; i++) {
      const a = ((i + s.phase) / s.n) * Math.PI * 2;
      const wobble = 0.82 + rnd() * 0.36;
      nodes.push({
        x: Math.cos(a) * s.r * wobble,
        y: Math.sin(a) * s.r * wobble * 0.72,
        z: s.z + (rnd() - 0.5) * 0.22,
        load: rnd() * 0.25,
        saturated: 0,
        tier: s.tier,
        sx: 0,
        sy: 0,
        sz: 0,
        scale: 1,
      });
    }
  }

  const edges: Edge[] = [];
  const start = [0, shells[0].n, shells[0].n + shells[1].n];
  const end = [shells[0].n, shells[0].n + shells[1].n, nodes.length];

  // each node fans to the two nearest in the next shell, in 3D
  for (let c = 0; c < 2; c++) {
    for (let a = start[c]; a < end[c]; a++) {
      const cand: { b: number; d: number }[] = [];
      for (let b = start[c + 1]; b < end[c + 1]; b++) {
        const dx = nodes[a].x - nodes[b].x;
        const dy = nodes[a].y - nodes[b].y;
        const dz = nodes[a].z - nodes[b].z;
        cand.push({ b, d: dx * dx + dy * dy + dz * dz });
      }
      cand.sort((p, q) => p.d - q.d);
      for (const { b } of cand.slice(0, 3)) edges.push({ a, b });
    }
  }

  return { nodes, edges };
}

export function LoadField({
  className,
  onStats,
  progress,
}: {
  className?: string;
  onStats?: (s: LoadStats) => void;
  /* 0..1, written by a scrubbed ScrollTrigger. A ref rather than a prop so
     scrolling never re-renders React — the camera reads it each frame. */
  progress?: { current: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const statsCb = useRef(onStats);
  statsCb.current = onStats;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";

    const { nodes, edges } = buildTopology();
    const packets: Packet[] = [];
    const pointer = { x: 0, y: 0, active: false };

    let w = 0;
    let h = 0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    canvas.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });

    let emitAccum = 0;
    const emit = (heat: number) => {
      const entry = Math.floor(Math.random() * 6);
      const outs: number[] = [];
      for (let i = 0; i < edges.length; i++) if (edges[i].a === entry) outs.push(i);
      if (!outs.length) return;
      packets.push({
        e: outs[Math.floor(Math.random() * outs.length)],
        t: 0,
        speed: 0.3 + Math.random() * 0.32,
        heat,
      });
    };

    /* Camera. yaw drifts on its own; the pointer adds a bounded tilt that
       eases back to centre when it leaves, so the scene never sits skewed. */
    let yaw = 0.4;
    let tiltX = 0;
    let tiltY = 0;
    let scroll = 0; // eased copy of the scrubbed progress
    const FOCAL = 2.15;
    const CAM_Z = 3.1;

    let raf = 0;
    let last = performance.now();
    let completed = 0;
    let statAccum = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // --- telemetry --------------------------------------------------------
      statAccum += dt;
      if (statAccum >= 0.25) {
        const cb = statsCb.current;
        if (cb) {
          const sat = nodes.filter((n) => n.saturated > 0).length;
          const deepest = nodes.reduce((m, n) => Math.max(m, n.load), 0);
          cb({
            rps: Math.round(completed / statAccum),
            p99: Math.round(34 + deepest * 190 + sat * 55),
            saturated: sat,
            depth: Math.min(1, deepest / 1.35),
          });
        }
        completed = 0;
        statAccum = 0;
      }

      // --- simulate ---------------------------------------------------------
      if (!reduced) {
        yaw += dt * 0.16;
        const targetX = pointer.active ? pointer.y * 0.28 : 0;
        const targetY = pointer.active ? pointer.x * 0.42 : 0;
        /* Scroll drives the camera as well as the pointer: the structure
           swings round and pulls back as the hero leaves, so the section
           change is one continuous move rather than a cut. */
        scroll += ((progressRef.current?.current ?? 0) - scroll) * Math.min(1, dt * 6);
        tiltX += (targetX - tiltX) * Math.min(1, dt * 3);
        tiltY += (targetY - tiltY) * Math.min(1, dt * 3);

        emitAccum += dt * (pointer.active ? 26 : 11);
        while (emitAccum >= 1) {
          emitAccum -= 1;
          emit(pointer.active ? 0.55 + Math.random() * 0.45 : Math.random() * 0.5);
        }

        for (let i = packets.length - 1; i >= 0; i--) {
          const p = packets[i];
          p.t += p.speed * dt;
          if (p.t >= 1) {
            const arrived = nodes[edges[p.e].b];
            arrived.load = Math.min(1.35, arrived.load + 0.11 + p.heat * 0.14);
            packets.splice(i, 1);
            completed++;
            if (arrived.saturated <= 0) {
              const outs: number[] = [];
              for (let k = 0; k < edges.length; k++) {
                if (edges[k].a === edges[p.e].b) outs.push(k);
              }
              if (outs.length) {
                packets.push({
                  e: outs[Math.floor(Math.random() * outs.length)],
                  t: 0,
                  speed: 0.3 + Math.random() * 0.32,
                  heat: p.heat,
                });
              }
            }
          }
        }

        for (const n of nodes) {
          n.load = Math.max(0, n.load - dt * 0.33);
          if (n.saturated > 0) n.saturated -= dt;
          else if (n.load > 1) n.saturated = 1.6;
        }
      }

      // --- project ----------------------------------------------------------
      const cy = Math.cos(yaw + tiltY + scroll * 1.1);
      const sy = Math.sin(yaw + tiltY + scroll * 1.1);
      const cx = Math.cos(tiltX);
      const sx = Math.sin(tiltX);
      const unit = Math.min(w, h) * 0.56;
      /* On a wide viewport the headline owns the left, so the structure is
         pushed into the clear side of the scrim rather than sitting under
         the type. Narrow viewports stack, so centre is correct there. */
      const cxFrac = w / h > 1.3 ? 0.67 : 0.5;
      const cyFrac = w / h > 1.3 ? 0.5 : 0.56;

      for (const n of nodes) {
        // rotate Y then X
        const x1 = n.x * cy + n.z * sy;
        const z1 = -n.x * sy + n.z * cy;
        const y2 = n.y * cx - z1 * sx;
        const z2 = n.y * sx + z1 * cx;

        const d = CAM_Z + scroll * 1.5 + z2;
        const k = FOCAL / Math.max(0.35, d);
        n.sx = w * cxFrac + x1 * k * unit;
        n.sy = h * cyFrac + y2 * k * unit;
        n.sz = d;
        n.scale = k;
      }

      const fog = (d: number) => {
        // 1 at the front plane, falling off behind it
        const t = (d - (CAM_Z - 1.1)) / 2.2;
        return Math.max(0.3, Math.min(1, 1 - t * 0.62));
      };

      // --- draw, back to front ---------------------------------------------
      ctx.clearRect(0, 0, w, h);

      const order = edges
        .map((e, i) => ({ i, z: (nodes[e.a].sz + nodes[e.b].sz) / 2 }))
        .sort((p, q) => q.z - p.z);

      for (const { i } of order) {
        const a = nodes[edges[i].a];
        const b = nodes[edges[i].b];
        const f = fog((a.sz + b.sz) / 2);
        const heat = Math.min(1, (a.load + b.load) / 1.6);
        ctx.strokeStyle = `rgba(155,200,235,${(0.22 + heat * 0.34) * f})`;
        ctx.lineWidth = Math.max(0.5, 1.15 * ((a.scale + b.scale) / 2));
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      for (const p of packets) {
        const a = nodes[edges[p.e].a];
        const b = nodes[edges[p.e].b];
        const x = a.sx + (b.sx - a.sx) * p.t;
        const y = a.sy + (b.sy - a.sy) * p.t;
        const sc = a.scale + (b.scale - a.scale) * p.t;
        const f = fog(a.sz + (b.sz - a.sz) * p.t);
        const warm = p.heat > 0.72;
        ctx.fillStyle = warm
          ? `rgba(255,170,110,${(0.8 + p.heat * 0.2) * f})`
          : `rgba(170,225,255,${(0.7 + p.heat * 0.3) * f})`;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, (warm ? 2.7 : 2.2) * sc), 0, Math.PI * 2);
        ctx.fill();
      }

      const nodeOrder = nodes
        .map((n, i) => ({ i, z: n.sz }))
        .sort((p, q) => q.z - p.z);

      for (const { i } of nodeOrder) {
        const n = nodes[i];
        const f = fog(n.sz);
        const r = [3.4, 5.2, 4.3][n.tier] * n.scale;
        const load = Math.min(1, n.load);
        const tripped = n.saturated > 0;

        if (load > 0.1 || tripped) {
          const glow = (tripped ? 22 : 8 + load * 18) * n.scale;
          const g = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, glow);
          g.addColorStop(
            0,
            tripped
              ? `rgba(255,150,80,${0.4 * f})`
              : `rgba(140,210,255,${(0.2 + load * 0.3) * f})`,
          );
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, glow, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = tripped
          ? `rgba(255,160,95,${0.95 * f})`
          : `rgba(${175 + load * 70},${215 + load * 25},245,${(0.72 + load * 0.28) * f})`;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, Math.max(0.9, r + load * 1.3 * n.scale), 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      for (let i = 0; i < 140; i++) emit(Math.random() * 0.5);
      frame(performance.now());
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
