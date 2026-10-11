"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   THE TRACE — the signature brand element.

   A single hairline that routes down the left margin and is DRAWN BY YOUR
   SCROLL. It branches at section boundaries into labelled nodes, exactly like
   a CAD leader line or a circuit trace.

   Why this and not an ambient particle field or a WebGL blob:
   - It is semantically true. SolutionMines sells connected systems; a line
     that routes, branches and converges is a literal diagram of that.
   - It does a job. It is simultaneously a progress indicator, a section index
     and a wayfinding device, so it REPLACES two pieces of UI rather than
     decorating on top of them.
   - It costs almost nothing: one SVG path, one scrubbed property, a repaint
     region of roughly 28px x viewport.
   - It degrades cleanly: static full-length diagram under reduced motion,
     a 2px progress bar on mobile, and it is server-rendered so it survives
     with JS disabled.

   The UNDRAWN portion stays faintly visible. That is the detail that makes it
   read as a schematic rather than as a loading bar.
-------------------------------------------------------------------------------*/

const NODES = [
  { at: 0.06, label: "01" },
  { at: 0.26, label: "02" },
  { at: 0.46, label: "03" },
  { at: 0.66, label: "04" },
  { at: 0.88, label: "05" },
];

/* A single straight rail. The branch stubs that make it read as a schematic
   are drawn per-node in HTML, so they stay pixel-aligned with the dots
   regardless of how the non-uniform viewBox scaling stretches the path. */
const RAIL_X = 14;
const PATH = `M${RAIL_X} 0 V 1000`;

export function Trace() {
  const drawnRef = useRef<SVGPathElement>(null);
  const nodeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const { reduced } = useMotion();

  useEffect(() => {
    const drawn = drawnRef.current;
    if (!drawn) return;

    const nodes = nodeRefs.current.filter(Boolean) as HTMLSpanElement[];

    if (reduced) {
      // Static diagram: fully drawn, nodes filled. The brand idea survives
      // intact without a single frame of motion.
      drawn.style.strokeDashoffset = "0";
      nodes.forEach((n) => n.setAttribute("data-on", "true"));
      return;
    }

    drawn.style.strokeDashoffset = "1";

    const st = ScrollTrigger.create({
      trigger: document.documentElement,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.6,
      onUpdate: (self) => {
        const p = self.progress;
        drawn.style.strokeDashoffset = String(1 - p);
        nodes.forEach((n, i) => {
          const on = p >= NODES[i].at;
          if ((n.dataset.on === "true") !== on) {
            n.dataset.on = String(on);
          }
        });
      },
    });

    return () => st.kill();
  }, [reduced]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-20 hidden h-screen w-[56px] lg:block"
    >
      <svg
        className="absolute left-4 top-0 h-full w-[28px]"
        viewBox="0 0 28 1000"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* The route, always faintly present — this is what makes it a diagram. */}
        <path
          d={PATH}
          stroke="var(--color-hairline)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
        {/* The drawn portion. pathLength=1 lets us scrub 1 -> 0 directly. */}
        <path
          ref={drawnRef}
          d={PATH}
          stroke="var(--color-accent)"
          strokeWidth="1.25"
          pathLength={1}
          strokeDasharray="1"
          strokeDashoffset="1"
          vectorEffect="non-scaling-stroke"
          shapeRendering="geometricPrecision"
        />
      </svg>

      {NODES.map((node, i) => (
        <span
          key={node.label}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          data-on="false"
          className="trace-node"
          style={{ top: `${node.at * 100}%` }}
        >
          <span className="trace-node__dot" />
          <span className="trace-node__stub" />
          <span className="trace-node__label">{node.label}</span>
        </span>
      ))}
    </div>
  );
}
