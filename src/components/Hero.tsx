"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { site } from "@/content/site";
import { MagneticButton } from "./MagneticButton";
import { Ticker } from "./Ticker";
import { useMotion } from "@/lib/motion/MotionProvider";
import { ShaderCanvas } from "./lab/ShaderCanvas";
import { DITHER_FRAG } from "./lab/dither.frag";

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

  /* Set once the hero has been revealed by the CSS fallback rather than by
     GSAP. Guards the rare ordering where fonts resolve AFTER the stall timer
     has already shown the hero — without it the headline would reveal a
     second time, for no reason the visitor can see. */
  const settled = useRef(false);

  /* The stall timer deliberately does NOT live in state.
     It used to: `timedOut` was a useState in this component's dependency
     array, so at 1500ms React tore down the GSAP context — reverting every
     element to its CSS start position — and rebuilt the timeline from
     scratch. The entire hero reveal visibly played twice on every single
     page load, with a hard snap back at the 1.7s mark.
     Keeping the timer local to this effect means fonts resolving simply
     cancels it, and nothing re-runs. */
  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const settle = () => {
      settled.current = true;
      scope.classList.add("hero-ready");
    };

    if (reduced) {
      settle();
      return;
    }

    if (!fontsReady) {
      // Never leave the hero invisible because a webfont stalled.
      const t = window.setTimeout(settle, 1500);
      return () => window.clearTimeout(t);
    }

    // Already revealed by the fallback — animating now would replay it.
    if (settled.current) return;

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
        .to('[data-hero="plate"]', { opacity: 1, duration: 0.5 }, "-=1.1");
    }, scope);

    return () => ctx.revert();
  }, [reduced, fontsReady]);

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

            {/* The plate. Decorative, so aria-hidden: every claim it makes is
                already stated in the headline above it.

                The fallback behind the canvas is a static dot grid, not a
                spinner — ShaderCanvas removes itself entirely when WebGL2 is
                missing or the shader fails, and a bordered empty box would
                read as a broken image. */}
            <figure data-hero="plate" className="hero__plate" aria-hidden="true">
              <div className="hero__plate-fallback" />
              <ShaderCanvas
                fragment={DITHER_FRAG}
                className="hero__plate-canvas"
                maxDpr={1.25}
              />
              <figcaption className="hero__plate-cap">
                <span>8&times;8 ordered dither</span>
                <span>Move the cursor</span>
              </figcaption>
            </figure>
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
