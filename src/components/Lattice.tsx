"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   THE LATTICE — the signature element.

   A node-and-edge graph that assembles itself: edges draw, then nodes lock
   into place and light up. It is a picture of the thing SolutionMines
   actually sells — separate systems connected into one that works.

   Why this rather than the usual dark-site ambient blob:
   - It means something. A gradient mesh says "technology" generically; a
     resolving graph says "we connect your systems", which is the proposition.
   - It is cheap. One inline SVG, ~30 nodes and edges, animated with transform
     and stroke-dashoffset over a small area. No canvas, no WebGL, no
     per-frame JavaScript once the intro completes.
   - It degrades honestly. Under reduced motion it renders fully assembled —
     the diagram is the point, the assembly is the flourish. Server-rendered,
     so it survives with JavaScript disabled.

   The geometry is fixed and hand-placed rather than random: a random graph
   looks like noise, a designed one looks like a system.
-------------------------------------------------------------------------------*/

const NODES = [
  { id: "a", x: 14, y: 54, r: 4.5, key: true },
  { id: "b", x: 38, y: 22, r: 3 },
  { id: "c", x: 40, y: 78, r: 3 },
  { id: "d", x: 62, y: 38, r: 3 },
  { id: "e", x: 64, y: 66, r: 3 },
  { id: "f", x: 86, y: 30, r: 4.5, key: true },
  { id: "g", x: 88, y: 72, r: 3 },
  { id: "h", x: 50, y: 50, r: 5.5, key: true },
];

const EDGES: [string, string][] = [
  ["a", "b"], ["a", "c"], ["a", "h"],
  ["b", "d"], ["c", "e"], ["d", "h"], ["e", "h"],
  ["d", "f"], ["e", "g"], ["h", "f"], ["h", "g"], ["f", "g"],
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

export function Lattice() {
  const root = useRef<SVGSVGElement>(null);
  const { reduced, fontsReady } = useMotion();

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;

    const edges = svg.querySelectorAll<SVGPathElement>("[data-edge]");
    const nodes = svg.querySelectorAll<SVGGElement>("[data-node]");

    if (reduced) {
      gsap.set(edges, { strokeDashoffset: 0, opacity: 1 });
      gsap.set(nodes, { opacity: 1, scale: 1 });
      return;
    }
    if (!fontsReady) return;

    const ctx = gsap.context(() => {
      gsap.set(edges, { strokeDashoffset: 1, opacity: 0 });
      gsap.set(nodes, { opacity: 0, scale: 0.3, transformOrigin: "center" });

      const tl = gsap.timeline({ delay: 0.35 });

      tl.to(edges, {
        opacity: 1,
        strokeDashoffset: 0,
        duration: 1.1,
        ease: "power2.inOut",
        stagger: { amount: 0.6, from: "start" },
      }).to(
        nodes,
        {
          opacity: 1,
          scale: 1,
          duration: 0.5,
          ease: "back.out(2)",
          stagger: { amount: 0.45, from: "random" },
        },
        "-=0.75",
      );
    }, svg);

    return () => ctx.revert();
  }, [reduced, fontsReady]);

  return (
    <svg
      ref={root}
      className="lattice"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
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
              d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
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
              <circle className="lattice__halo" cx={n.x} cy={n.y} r={n.r + 4} />
            )}
            <circle
              className={n.key ? "lattice__node lattice__node--key" : "lattice__node"}
              cx={n.x}
              cy={n.y}
              r={n.r}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}
