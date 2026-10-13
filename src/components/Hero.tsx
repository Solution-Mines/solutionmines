"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { site } from "@/content/site";
import { MagneticButton } from "./MagneticButton";
import { Lattice } from "./Lattice";
import { Ticker } from "./Ticker";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   HERO

   THE critical performance detail on this page:

   Chrome does not treat an opacity:0 or fully-clipped element as an LCP
   candidate. A hero whose headline fades in therefore reports LCP at the END
   of its animation, not at first paint — which is exactly how good-looking
   sites end up posting four-second LCPs.

   So line 1 is unmasked, painted at full opacity on frame one, and merely
   offset 20px by a transform. Lines 2 and 3 carry the masked reveal. The
   sequence reads as one movement; the metric sees a headline painted
   immediately.

   Initial states live in CSS and GSAP animates TO the final values — never
   .from(), which would snap painted text backwards.
-------------------------------------------------------------------------------*/

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const { reduced, fontsReady } = useMotion();
  const [timedOut, setTimedOut] = useState(false);

  // Safety net: the hero must never be stuck invisible because a font stalled.
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const settle = () => scope.classList.add("hero-ready");

    if (reduced) {
      settle();
      return;
    }
    if (!fontsReady) {
      if (timedOut) settle();
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      tl.to(".hero-line-1", { y: 0, duration: 0.9 })
        .fromTo(
          ".hero-mask-2 > span",
          { yPercent: 110, y: 0 },
          { yPercent: 0, duration: 0.9 },
          "-=0.78",
        )
        .fromTo(
          ".hero-mask-3 > span",
          { yPercent: 110, y: 0 },
          { yPercent: 0, duration: 0.9 },
          "-=0.78",
        )
        .to(
          '[data-hero="fade"]',
          { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: "power3.out" },
          "-=0.5",
        )
        .to(
          '[data-hero="rule"]',
          { scaleX: 1, duration: 1, ease: "power4.inOut" },
          "-=0.85",
        )
        .to('[data-hero="lattice"]', { opacity: 1, duration: 0.5 }, "-=1.1");
    }, scope);

    return () => ctx.revert();
  }, [reduced, fontsReady, timedOut]);

  const [l1, l2, l3] = site.positioning;

  return (
    <section ref={root} className="hero" aria-labelledby="hero-heading">
      <div className="shell">
        <div className="hero__grid">
          <p data-hero="fade" className="hero__status">
              <span className="hero__status-dot" aria-hidden="true" />
            <span className="u-eyebrow">
              Available for new projects &mdash; Q1
            </span>
          </p>

          <h1 id="hero-heading" className="t-display-2xl hero__headline">
            {/* unmasked — painted and LCP-eligible on frame one */}
            <span className="hero-line-1 block">{l1}</span>
            <span className="hero-mask hero-mask-2 block overflow-hidden">
              <span>{l2}</span>
            </span>
            <span className="hero-mask hero-mask-3 block overflow-hidden">
              <span>{l3}</span>
            </span>
          </h1>

          <div className="hero__lower">
            <div>
              <p data-hero="fade" className="hero__lede">
                {site.qualifier}
              </p>
              <div data-hero="fade" className="hero__actions">
                <MagneticButton href="/contact">Start a project</MagneticButton>
                <MagneticButton href="/how-we-work" variant="outline">
                  How we work
                </MagneticButton>
              </div>
            </div>

            <div data-hero="lattice" className="hero__visual" aria-hidden="true">
              <Lattice />
            </div>
          </div>
        </div>

        <Ticker />

        {/* Capability strip as an instrument readout, not a logo wall. */}
        <div className="hero__strip">
          <div
            data-hero="rule"
            aria-hidden="true"
            className="hero__strip-rule"
          />
          <ul className="hero__caps">
            {site.capabilities.map((c, i) => (
              <li key={c} data-hero="fade">
                <span className="hero__caps-n" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="hero__caps-label">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
