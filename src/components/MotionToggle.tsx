"use client";

import { useMotion } from "@/lib/motion/MotionProvider";

/* An in-page motion control.

   `prefers-reduced-motion` is the correct primary signal, but it is an OS
   setting that many people never discover. On a site that leans this hard on
   motion, offering an explicit switch is both a courtesy and the fastest way
   for a reviewer to verify the reduced-motion path actually works. */

export function MotionToggle() {
  const { reduced, toggleReduced } = useMotion();

  return (
    <button
      type="button"
      className="motion-toggle"
      data-reduced={reduced}
      onClick={toggleReduced}
      aria-pressed={reduced}
    >
      <span className="motion-toggle__dot" aria-hidden="true" />
      <span>Motion {reduced ? "off" : "on"}</span>
    </button>
  );
}
