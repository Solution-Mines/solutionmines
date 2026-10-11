"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { stages } from "@/content/site";
import { useMotion } from "@/lib/motion/MotionProvider";

/* ----------------------------------------------------------------------------
   THE DELIVERY SPINE — the signature interactive section.

   This is the ONE pin on the site, and it has to justify itself.

   The plan's rule: a pin is only earned when the content is genuinely
   sequential AND the horizontal axis carries meaning. A delivery process is
   both — the stages are ordered, each depends on the last, and travelling
   sideways through them maps to progression far better than stacking them
   vertically. (Pinning the hero, or the services list, would fail that test,
   which is why neither is pinned.)

   Guardrails, all deliberate:
   - Scroll distance is capped at 2.5 viewport heights. Longer and users
     believe the page has broken.
   - `invalidateOnRefresh` recalculates the travel distance on resize, so the
     track cannot end up short or overshooting.
   - The horizontal layout is gated on `.js`. Without JavaScript the track
     stays a vertical ordered list, so the content is never trapped off-screen
     behind a scroll effect that never initialises.
   - Below lg, and under reduced motion, there is no pin at all — it is simply
     an <ol>. The information is identical; only the choreography is lost.
-------------------------------------------------------------------------------*/

export function DeliverySpine() {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const { reduced, fontsReady } = useMotion();

  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track || reduced || !fontsReady) return;

    const mm = gsap.matchMedia();

    mm.add(
      {
        isDesktop: "(min-width: 64rem)",
        noReduce: "(prefers-reduced-motion: no-preference)",
      },
      (ctx) => {
        const { isDesktop, noReduce } = ctx.conditions as Record<string, boolean>;
        if (!isDesktop || !noReduce) return;

        const distance = () =>
          Math.max(0, track.scrollWidth - section.clientWidth);

        const tween = gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top top",
            // capped travel — never more than 2.5 viewports of scroll
            end: () =>
              "+=" + Math.min(distance(), window.innerHeight * 2.5),
            pin: true,
            pinSpacing: true,
            anticipatePin: 1,
            scrub: 1,
            invalidateOnRefresh: true,
            onUpdate: (self) => {
              const idx = Math.min(
                stages.length - 1,
                Math.floor(self.progress * stages.length + 0.0001),
              );
              setActive(idx);
            },
          },
        });

        return () => {
          // kill(true) reverts the pin, removing the pin-spacer and putting
          // the section back where React left it.
          tween.scrollTrigger?.kill(true);
          tween.kill();
          gsap.set(track, { clearProps: "transform" });
        };
      },
    );

    return () => mm.revert();
  }, [reduced, fontsReady]);

  /* The wrapper is load-bearing, not cosmetic.

     ScrollTrigger implements `pin` by inserting a `.pin-spacer` div and
     MOVING the pinned element inside it. That reparenting happens outside
     React's knowledge, so on a client-side navigation React calls
     removeChild on a node that is no longer a child of where it expects —
     throwing "The node to be removed is not a child of this node" and
     blanking the next page.

     With this wrapper, GSAP only ever rearranges nodes INSIDE it. React
     removes the wrapper from its own parent, which GSAP never touched, so
     unmounting is safe regardless of pin state. */
  return (
    <div className="spine-mount">
    <section
      ref={sectionRef}
      className="section spine"
      id="process"
      data-surface="dark"
      aria-labelledby="process-heading"
    >
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>04</span>
          <span className="u-eyebrow">How the work runs</span>
        </div>

        <div className="spine__head">
          <h2
            id="process-heading"
            className="t-display-lg"
            style={{ maxWidth: "15ch" }}
          >
            Every stage hands you something.
          </h2>
          <p style={{ color: "var(--color-text-muted)", maxWidth: "40ch" }}>
            Stage names are easy to write. Artifacts are not. Each stage below
            names the thing you actually receive — which is what makes a
            process claim checkable.
          </p>
        </div>

        {/* progress readout, desktop only */}
        <div className="spine__progress" aria-hidden="true">
          <span className="u-eyebrow">
            {String(active + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}
          </span>
          <span className="spine__bar">
            <span
              className="spine__fill"
              style={{ transform: `scaleX(${(active + 1) / stages.length})` }}
            />
          </span>
          <span className="u-eyebrow">{stages[active].name}</span>
        </div>
      </div>

      <div className="spine__viewport">
        <ol ref={trackRef} className="spine__track">
          {stages.map((s, i) => (
            <li
              key={s.index}
              className="spine__card"
              data-active={i === active}
            >
              <span className="spine__index">{s.index}</span>
              <h3 className="u-display spine__name">{s.name}</h3>
              <p className="spine__body">{s.body}</p>
              <div className="spine__artifact">
                <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>
                  You get
                </span>
                <p>{s.artifact}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
    </div>
  );
}
