"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   THE LATTICE — the signature element.

   A node-and-edge graph that assembles itself, then keeps a slow idle drift
   and tilts toward the pointer. It is a picture of what SolutionMines sells:
   separate systems connected into one that works. Three nodes carry labels so
   the metaphor is explicit rather than decorative.

   Why this rather than the usual ambient blob:
   - It means something. A gradient mesh says "technology" generically; a
     resolving graph says "we connect your systems", which is the proposition.
   - It is cheap. One inline SVG, ~40 elements, animated with transform and
     stroke-dashoffset. No canvas, no WebGL. The pointer tilt uses
     gsap.quickTo, so there is no layout read per move.
   - It degrades honestly. Under reduced motion it renders fully assembled and
     still — the diagram is the point, the assembly is the flourish. It is
     server-rendered, so it survives with JavaScript disabled.

   Geometry is hand-placed, not random: a random graph looks like noise, a
   designed one looks like a system.
-------------------------------------------------------------------------------*/

type Node = {
  id: string;
  x: number;
  y: number;
  r: number;
  key?: boolean;
  label?: string;
  anchor?: "start" | "end";
};

const NODES: Node[] = [
  { id: "pay", x: 16, y: 26, r: 5, key: true, label: "PAYMENTS", anchor: "start" },
  { id: "crm", x: 12, y: 68, r: 4, label: "CRM", anchor: "start" },
  { id: "a", x: 33, y: 46, r: 2.6 },
  { id: "b", x: 30, y: 15, r: 2.2 },
  { id: "c", x: 28, y: 86, r: 2.2 },
  { id: "core", x: 52, y: 52, r: 7.5, key: true, label: "CORE", anchor: "start" },
  { id: "d", x: 50, y: 22, r: 2.6 },
  { id: "e", x: 56, y: 82, r: 2.4 },
  { id: "f", x: 72, y: 36, r: 3 },
  { id: "g", x: 74, y: 68, r: 2.6 },
  { id: "led", x: 90, y: 24, r: 5, key: true, label: "LEDGER", anchor: "end" },
  { id: "ops", x: 92, y: 74, r: 4, label: "OPS", anchor: "end" },
  { id: "h", x: 66, y: 12, r: 1.8 },
  { id: "i", x: 40, y: 70, r: 1.8 },
];

const EDGES: [string, string][] = [
  ["pay", "b"], ["pay", "a"], ["crm", "c"], ["crm", "a"],
  ["b", "d"], ["c", "i"], ["a", "core"], ["i", "core"],
  ["d", "core"], ["e", "core"], ["core", "f"], ["core", "g"],
  ["d", "h"], ["h", "led"], ["f", "led"], ["g", "ops"],
  ["e", "g"], ["f", "g"], ["led", "ops"],
];

/* Node positions are authored on a square 0-100 field because that is easier
   to reason about, then compressed vertically for display. The hero slot is
   wide and short, and a square graph overflowed it.

   The compression is applied to CENTRES only — radii are untouched — so the
   nodes stay circular. Scaling the group with a transform would squash them
   into ellipses. */
const VY = (y: number) => 9 + y * 0.49;
const VIEW_H = 68;

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

export function Lattice() {
  const wrap = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const { reduced, fontsReady } = useMotion();

  useEffect(() => {
    const el = inner.current;
    const host = wrap.current;
    if (!el || !host) return;

    const edges = el.querySelectorAll<SVGPathElement>("[data-edge]");
    const nodes = el.querySelectorAll<SVGGElement>("[data-node]");
    const labels = el.querySelectorAll<SVGGElement>("[data-label]");

    if (reduced) {
      gsap.set(edges, { strokeDashoffset: 0, opacity: 1 });
      gsap.set(nodes, { opacity: 1, scale: 1 });
      gsap.set(labels, { opacity: 1 });
      return;
    }
    if (!fontsReady) return;

    const ctx = gsap.context(() => {
      gsap.set(edges, { strokeDashoffset: 1, opacity: 0 });
      gsap.set(nodes, { opacity: 0, scale: 0.25, transformOrigin: "center" });
      gsap.set(labels, { opacity: 0 });

      gsap
        .timeline({ delay: 0.3 })
        .to(edges, {
          opacity: 1,
          strokeDashoffset: 0,
          duration: 1.2,
          ease: "power2.inOut",
          stagger: { amount: 0.75, from: "start" },
        })
        .to(
          nodes,
          {
            opacity: 1,
            scale: 1,
            duration: 0.55,
            ease: "back.out(2.2)",
            stagger: { amount: 0.5, from: "random" },
          },
          "-=0.85",
        )
        .to(labels, { opacity: 1, duration: 0.4, stagger: 0.07 }, "-=0.3");

      // Slow idle drift: enough to read as alive, far too slow to distract.
      gsap.to(el, {
        yPercent: 1.6,
        duration: 7,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
      });
    }, el);

    /* Pointer tilt. The rect is measured on enter and cached — reading layout
       inside pointermove is the classic INP killer. quickTo pre-compiles the
       setter so there is no per-move tween allocation. */
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let rect: DOMRect | null = null;
    const rx = gsap.quickTo(el, "rotationY", { duration: 0.8, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotationX", { duration: 0.8, ease: "power3.out" });

    const enter = () => {
      if (!fine.matches) return;
      rect = host.getBoundingClientRect();
    };
    const move = (e: PointerEvent) => {
      if (!rect) return;
      rx(((e.clientX - (rect.left + rect.width / 2)) / rect.width) * 14);
      ry((-(e.clientY - (rect.top + rect.height / 2)) / rect.height) * 14);
    };
    const leave = () => {
      rect = null;
      gsap.to(el, { rotationX: 0, rotationY: 0, duration: 0.9, ease: "power3.out" });
    };

    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);

    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      ctx.revert();
    };
  }, [reduced, fontsReady]);

  return (
    <div ref={wrap} className="lattice-wrap" aria-hidden="true">
      <div ref={inner} className="lattice-inner">
        <svg
          className="lattice"
          viewBox={`0 0 104 ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
        >
          <g>
            {EDGES.map(([from, to]) => {
              const a = byId[from];
              const b = byId[to];
              return (
                <path
                  key={`${from}-${to}`}
                  data-edge
                  d={`M${a.x} ${VY(a.y)} L${b.x} ${VY(b.y)}`}
                  pathLength={1}
                  strokeDasharray="1"
                  strokeDashoffset="1"
                  vectorEffect="non-scaling-stroke"
                  shapeRendering="geometricPrecision"
                />
              );
            })}
          </g>

          <g>
            {NODES.map((n) => (
              <g key={n.id} data-node>
                {n.key && (
                  <>
                    <circle className="lattice__halo" cx={n.x} cy={VY(n.y)} r={n.r + 5} />
                    <circle className="lattice__halo lattice__halo--wide" cx={n.x} cy={VY(n.y)} r={n.r + 11} />
                  </>
                )}
                <circle
                  className={n.key ? "lattice__node lattice__node--key" : "lattice__node"}
                  cx={n.x}
                  cy={VY(n.y)}
                  r={n.r}
                />
              </g>
            ))}
          </g>

          <g>
            {NODES.filter((n) => n.label).map((n) => (
              <g key={`l-${n.id}`} data-label>
                <line
                  className="lattice__leader"
                  x1={n.anchor === "end" ? n.x - n.r - 2 : n.x + n.r + 2}
                  y1={VY(n.y)}
                  x2={n.anchor === "end" ? n.x - n.r - 7 : n.x + n.r + 7}
                  y2={VY(n.y)}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  className="lattice__label"
                  x={n.anchor === "end" ? n.x - n.r - 9 : n.x + n.r + 9}
                  y={VY(n.y)}
                  textAnchor={n.anchor === "end" ? "end" : "start"}
                  dominantBaseline="middle"
                >
                  {n.label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
