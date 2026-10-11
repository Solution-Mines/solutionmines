"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { site } from "@/content/site";
import { MagneticButton } from "./MagneticButton";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   HERO

   THE critical performance detail on this page:

   Chrome does not treat an opacity:0 or fully-clipped element as an LCP
   candidate. A hero whose headline fades in therefore reports LCP at the END
   of its animation, not at first paint — which is exactly how beautiful sites
   end up posting 4-second LCPs.

   So line 1 is unmasked, painted at full opacity on frame one, and merely
   offset 24px by a transform. Lines 2 and 3 carry the masked reveal. The
   sequence reads as a single choreographed movement; the metric sees a
   headline painted immediately.

   Initial states are in CSS (see globals.css "Hero choreography"), and GSAP
   animates TO the final values — never .from(), which would snap painted text
   backwards.
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

      /* fromTo, not to, for the masked lines.
         The CSS start state is `translate3d(0, 110%, 0)`, which the browser
         resolves into a PIXEL offset in the computed matrix. GSAP therefore
         reads y=91px / yPercent=0, so animating `yPercent` to 0 is a no-op and
         the line stays hidden. Declaring the start explicitly — and zeroing the
         pixel y — makes GSAP and the CSS agree, so there is still no flash. */
      tl.to(".hero-line-1", { y: 0, duration: 1.0 })
        .fromTo(
          ".hero-mask-2 > span",
          { yPercent: 110, y: 0 },
          { yPercent: 0, duration: 1.0 },
          "-=0.86",
        )
        .fromTo(
          ".hero-mask-3 > span",
          { yPercent: 110, y: 0 },
          { yPercent: 0, duration: 1.0 },
          "-=0.86",
        )
        .to(
          '[data-hero="fade"]',
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            stagger: 0.07,
            ease: "power3.out",
          },
          "-=0.55",
        )
        .to(
          '[data-hero="rule"]',
          { scaleX: 1, duration: 1.1, ease: "power4.inOut" },
          "-=0.95",
        );
    }, scope);

    return () => ctx.revert();
  }, [reduced, fontsReady, timedOut]);

  const [l1, l2, l3] = site.positioning;

  return (
    <section
      ref={root}
      className="section relative"
      style={{ paddingTop: "clamp(6.5rem, 5rem + 6vw, 9rem)" }}
      aria-labelledby="hero-heading"
    >
      <div className="shell">
        {/* The statement takes the full measure. Splitting it into a narrow
            column forced it to wrap to five lines and pushed the CTA below
            the fold — the one thing a hero must never do. */}
        <p data-hero="fade" className="u-eyebrow mb-8 flex items-center gap-3">
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 1,
              background: "var(--color-accent)",
              display: "inline-block",
            }}
          />
          Software engineering
        </p>

        <h1
          id="hero-heading"
          className="t-display-2xl"
          style={{ maxWidth: "30ch" }}
        >
          {/* unmasked — painted and LCP-eligible on frame one */}
          <span className="hero-line-1 block">{l1}</span>
          <span className="hero-mask hero-mask-2 block overflow-hidden">
            <span>{l2}</span>
          </span>
          <span className="hero-mask hero-mask-3 block overflow-hidden">
            <span>{l3}</span>
          </span>
        </h1>

        {/* qualifier + actions sit BELOW the statement, in the margin
            arrangement, so the primary CTA stays in the first viewport */}
        <div className="mt-10 grid gap-8 lg:mt-14 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-16">
          <p
            data-hero="fade"
            style={{
              fontSize: "var(--text-body-lg)",
              lineHeight: 1.55,
              color: "var(--color-text-muted)",
              borderLeft: "1px solid var(--color-accent)",
              paddingLeft: "1.25rem",
              maxWidth: "46ch",
            }}
          >
            {site.qualifier}
          </p>

          <div data-hero="fade" className="flex flex-wrap items-center gap-3">
            <MagneticButton href="/contact">Start a project</MagneticButton>
            <MagneticButton href="/how-we-work" variant="outline">
              See how we work
            </MagneticButton>
          </div>
        </div>

        {/* capability strip: text and rules, never a logo wall */}
        <div className="mt-14 lg:mt-20">
          <div
            data-hero="rule"
            aria-hidden="true"
            style={{ height: 1, background: "var(--color-hairline)" }}
          />
          <ul className="cap-strip grid grid-cols-2 md:grid-cols-4">
            {site.capabilities.map((c) => (
              <li
                key={c}
                data-hero="fade"
                className="u-eyebrow py-5"
                style={{ borderRight: "1px solid var(--color-hairline)" }}
              >
                <span className="pr-4">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
