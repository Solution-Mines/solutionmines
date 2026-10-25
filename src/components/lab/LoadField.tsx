"use client";

import { useEffect, useRef } from "react";

/* ----------------------------------------------------------------------------
   LOAD FIELD

   A service topology carrying real traffic. Nodes accumulate load as packets
   arrive and shed it over time; when one saturates it goes amber, stops
   accepting, and its neighbours take the overflow — then it recovers.

   The point of building it rather than animating a gradient: this is the thing
   the firm is actually selling. A decorative field says "we have taste"; a
   system visibly staying up under load says the other thing. The design
   system reserves near-black for the parts of the page that genuinely
   compute, and this one does.

   Canvas 2D on purpose. A graph is geometry, not a per-pixel function, so a
   fragment shader would be the harder way to draw it and would add a compile
   step that can fail. Nothing here can fail to a blank box: if the canvas is
   missing the caller keeps its CSS fallback.
-------------------------------------------------------------------------------*/

type Node = {
  x: number; // 0..1, resolution independent
  y: number;
  load: number; // 0..1
  saturated: number; // seconds remaining in the amber state
  tier: number; // 0 edge, 1 service, 2 data — drives size
};

type Edge = { a: number; b: number };

type Packet = {
  e: number; // edge index
  t: number; // 0..1 along the edge
  dir: 1 | -1;
  speed: number;
  heat: number; // 0..1, how hot this request is
};

/* A small deterministic PRNG. The layout must be identical on every load —
   a topology that reshuffles on refresh reads as noise, not as a system. */
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

  /* Three columns: edge → services → data. Jittered so it reads as a real
     system rather than a diagram of one. */
  /* Weighted to the right half. The scrim has to be heaviest where the
     headline sits, so a graph centred in the viewport would spend most of
     itself under the darkest part of the gradient and read as noise. */
  const cols = [
    { x: 0.44, n: 4, tier: 0 },
    { x: 0.66, n: 7, tier: 1 },
    { x: 0.88, n: 5, tier: 2 },
  ];

  for (const c of cols) {
    for (let i = 0; i < c.n; i++) {
      const spread = 0.82;
      const y = 0.09 + (spread * (i + 0.5)) / c.n;
      nodes.push({
        x: c.x + (rnd() - 0.5) * 0.07,
        y: y + (rnd() - 0.5) * 0.05,
        load: rnd() * 0.25,
        saturated: 0,
        tier: c.tier,
      });
    }
  }

  const edges: Edge[] = [];
  const colStart = [0, cols[0].n, cols[0].n + cols[1].n];
  const colEnd = [cols[0].n, cols[0].n + cols[1].n, nodes.length];

  /* Each node fans out to the two nearest in the next column. Nearest rather
     than random so the edges do not cross into a hairball. */
  for (let c = 0; c < 2; c++) {
    for (let a = colStart[c]; a < colEnd[c]; a++) {
      const candidates: { b: number; d: number }[] = [];
      for (let b = colStart[c + 1]; b < colEnd[c + 1]; b++) {
        candidates.push({ b, d: Math.abs(nodes[a].y - nodes[b].y) });
      }
      candidates.sort((p, q) => p.d - q.d);
      for (const { b } of candidates.slice(0, 2)) edges.push({ a, b });
    }
  }

  return { nodes, edges };
}

export type LoadStats = {
  rps: number; // requests completed in the last second
  p99: number; // ms, derived from the slowest in-flight hop
  saturated: number; // nodes currently tripped
  depth: number; // deepest queue, as a share of capacity
};

export function LoadField({
  className,
  onStats,
}: {
  className?: string;
  onStats?: (s: LoadStats) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /* Kept in a ref so a new callback identity does not tear down the
     simulation and reshuffle a topology the visitor is looking at. */
  const statsCb = useRef(onStats);
  statsCb.current = onStats;

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
    const pointer = { x: -1, y: -1, active: false };

    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.75);
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
      pointer.x = (e.clientX - r.left) / r.width;
      pointer.y = (e.clientY - r.top) / r.height;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    canvas.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerleave", onLeave, { passive: true });

    /* Emit a request from a random edge node. Rate rises while the pointer is
       over the field — the visitor is the load. */
    let emitAccum = 0;
    const emit = (heat: number) => {
      const entry = Math.floor(Math.random() * 4); // an edge-tier node
      const outs = edges.filter((e) => e.a === entry);
      if (!outs.length) return;
      const e = outs[Math.floor(Math.random() * outs.length)];
      packets.push({
        e: edges.indexOf(e),
        t: 0,
        dir: 1,
        speed: 0.28 + Math.random() * 0.3,
        heat,
      });
    };

    const px = (n: Node) => n.x * w;
    const py = (n: Node) => n.y * h;

    let raf = 0;
    let last = performance.now();

    /* Telemetry. These are the simulation's own numbers, not decoration —
       completed is incremented where a packet actually lands. */
    let completed = 0;
    let statAccum = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      statAccum += dt;
      if (statAccum >= 0.25) {
        const cb = statsCb.current;
        if (cb) {
          const sat = nodes.filter((n) => n.saturated > 0).length;
          const deepest = nodes.reduce((m, n) => Math.max(m, n.load), 0);
          cb({
            rps: Math.round(completed / statAccum),
            /* Slower hops and a congested graph both show up as latency; the
               mapping is invented but it moves for the right reasons. */
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
        const baseRate = pointer.active ? 26 : 11;
        emitAccum += dt * baseRate;
        while (emitAccum >= 1) {
          emitAccum -= 1;
          emit(pointer.active ? 0.55 + Math.random() * 0.45 : Math.random() * 0.5);
        }

        for (let i = packets.length - 1; i >= 0; i--) {
          const p = packets[i];
          p.t += p.speed * dt;
          if (p.t >= 1) {
            const edge = edges[p.e];
            const arrived = nodes[edge.b];
            arrived.load = Math.min(1.35, arrived.load + 0.11 + p.heat * 0.14);
            packets.splice(i, 1);
            completed++;

            // forward it on, unless this node is saturated and shedding
            if (arrived.saturated <= 0) {
              const outs = edges.filter((e) => e.a === edge.b);
              if (outs.length) {
                const nxt = outs[Math.floor(Math.random() * outs.length)];
                packets.push({
                  e: edges.indexOf(nxt),
                  t: 0,
                  dir: 1,
                  speed: 0.28 + Math.random() * 0.3,
                  heat: p.heat,
                });
              }
            }
          }
        }

        for (const n of nodes) {
          n.load = Math.max(0, n.load - dt * 0.33);
          if (n.saturated > 0) n.saturated -= dt;
          else if (n.load > 1) n.saturated = 1.6; // trip
        }

        // the pointer adds local pressure to whatever is nearest
        if (pointer.active) {
          let best = -1;
          let bestD = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            const dx = nodes[i].x - pointer.x;
            const dy = nodes[i].y - pointer.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          if (best >= 0 && bestD < 0.02) {
            nodes[best].load = Math.min(1.35, nodes[best].load + dt * 1.5);
          }
        }
      }

      // --- draw -------------------------------------------------------------
      ctx.clearRect(0, 0, w, h);

      // edges
      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        const heat = Math.min(1, (a.load + b.load) / 1.6);
        ctx.strokeStyle = `rgba(140,185,220,${0.16 + heat * 0.3})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px(a), py(a));
        ctx.lineTo(px(b), py(b));
        ctx.stroke();
      }

      // packets
      for (const p of packets) {
        const e = edges[p.e];
        const a = nodes[e.a];
        const b = nodes[e.b];
        const x = px(a) + (px(b) - px(a)) * p.t;
        const y = py(a) + (py(b) - py(a)) * p.t;
        const warm = p.heat > 0.72;
        ctx.fillStyle = warm
          ? `rgba(255,170,110,${0.75 + p.heat * 0.25})`
          : `rgba(170,225,255,${0.65 + p.heat * 0.35})`;
        ctx.beginPath();
        ctx.arc(x, y, warm ? 2.6 : 2.1, 0, Math.PI * 2);
        ctx.fill();
      }

      // nodes
      for (const n of nodes) {
        const r = [3.4, 5.2, 4.3][n.tier];
        const load = Math.min(1, n.load);
        const tripped = n.saturated > 0;

        if (load > 0.12 || tripped) {
          const glow = tripped ? 20 : 6 + load * 16;
          const g = ctx.createRadialGradient(px(n), py(n), 0, px(n), py(n), glow);
          g.addColorStop(
            0,
            tripped ? "rgba(255,150,80,0.34)" : `rgba(140,210,255,${0.2 + load * 0.3})`,
          );
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px(n), py(n), glow, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = tripped
          ? "rgba(255,160,95,0.95)"
          : `rgba(${175 + load * 70},${215 + load * 25},${245},${0.75 + load * 0.25})`;
        ctx.beginPath();
        ctx.arc(px(n), py(n), r + load * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    };

    /* Reduced motion still gets the topology — it simply stops moving. One
       frame is drawn and nothing is scheduled. */
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
