"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useMotion } from "@/lib/motion/MotionProvider";

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "outline";
};

/* Magnetic CTA.

   Two things make this accessible rather than a hover gimmick:
   1. The bounding rect is measured ONCE on pointerenter and cached. Reading
      layout inside pointermove is the classic INP killer on sites like this.
   2. The visual END STATE is reachable by keyboard via :focus-visible in CSS,
      so no affordance is hover-only. The magnetism is decoration on top of a
      state that already exists for everyone.
   Disabled entirely under reduced motion and on coarse pointers.             */

export function MagneticButton({ href, children, variant = "solid" }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const rect = useRef<DOMRect | null>(null);
  const xTo = useRef<((v: number) => void) | null>(null);
  const yTo = useRef<((v: number) => void) | null>(null);
  const { reduced } = useMotion();

  const enter = (e: React.PointerEvent) => {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    rect.current = ref.current.getBoundingClientRect();
    xTo.current = gsap.quickTo(ref.current, "x", {
      duration: 0.4,
      ease: "power3.out",
    });
    yTo.current = gsap.quickTo(ref.current, "y", {
      duration: 0.4,
      ease: "power3.out",
    });
  };

  const move = (e: React.PointerEvent) => {
    const r = rect.current;
    if (!r || !xTo.current || !yTo.current) return;
    // Max displacement 10px. Beyond that it stops reading as a button.
    const dx = ((e.clientX - (r.left + r.width / 2)) / r.width) * 20;
    const dy = ((e.clientY - (r.top + r.height / 2)) / r.height) * 20;
    xTo.current(gsap.utils.clamp(-10, 10, dx));
    yTo.current(gsap.utils.clamp(-10, 10, dy));
  };

  const leave = () => {
    if (!ref.current || !rect.current) return;
    rect.current = null;
    gsap.to(ref.current, { x: 0, y: 0, duration: 0.5, ease: "power2.out" });
  };

  return (
    <a
      ref={ref}
      href={href}
      className={`btn btn--${variant}`}
      onPointerEnter={enter}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <span>{children}</span>
      <span className="btn__arrow" aria-hidden="true">
        &rarr;
      </span>
    </a>
  );
}
