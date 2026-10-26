"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MineField } from "./MineField";
import { useMotion } from "@/lib/motion/MotionProvider";
import { stages } from "@/content/site";

/* ----------------------------------------------------------------------------
   THE MINE SEQUENCE

   This replaces the delivery spine rather than sitting beside it. The spine
   already said "five stages, each hands you something" and already owned the
   site's single pin; this is the same content with the visual arguing it
   instead of decorating it, and it inherits that pin rather than adding a
   second one.

   The dark band is earned by the subject, not borrowed from award sites:
   globals.css reserves black for things that actually do something, and
   underground is dark. Light above, dark below, light again for the work and
   the contact — you come back up holding the thing that was dug out.

   WHAT IS PINNED AND WHAT IS NOT
   Desktop only, and only when motion is allowed. Everywhere else there is no
   pin, no scrub, and every stage is simply listed: the stage names and their
   artifacts are the content, and content may never depend on a scroll
   position that some visitors will never produce.
-------------------------------------------------------------------------------*/

export function MineSequence() {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const { reduced, fontsReady } = useMotion();

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    /* No pin: hold the cut partway down so the field reads as a populated
       cross-section rather than an empty or fully-worked one. */
    if (reduced || !fontsReady) {
      progress.current = 0.55;
      return;
    }

    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();

    mm.add(
      {
        isDesktop: "(min-width: 64rem)",
        noReduce: "(prefers-reduced-motion: no-preference)",
      },
      (ctx) => {
        const { isDesktop, noReduce } = ctx.conditions as Record<string, boolean>;
        if (!isDesktop || !noReduce) {
          progress.current = 0.55;
          return;
        }

        setPinned(true);
        progress.current = 0;

        const trigger = ScrollTrigger.create({
          trigger: section,
          start: "top top",
          // Capped travel, matching what the spine allowed itself.
          end: () => "+=" + window.innerHeight * 2.5,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
          scrub: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            // Written to a ref: scrolling must never re-render the canvas.
            progress.current = self.progress;
            const idx = Math.min(
              stages.length - 1,
              Math.floor(self.progress * stages.length + 0.0001),
            );
            setActive(idx);
          },
        });

        return () => {
          // kill(true) reverts the pin, removing the pin-spacer and putting
          // the section back where React left it.
          trigger.kill(true);
          setPinned(false);
        };
      },
    );

    return () => mm.revert();
  }, [reduced, fontsReady]);

  const current = stages[active];

  /* The wrapper is load-bearing, not cosmetic.

     ScrollTrigger implements `pin` by inserting a `.pin-spacer` div and
     MOVING the pinned element inside it. That reparenting happens outside
     React's knowledge, so on a client-side navigation React calls removeChild
     on a node that is no longer a child of where it expects — throwing "The
     node to be removed is not a child of this node" and blanking the next
     page. With this wrapper GSAP only ever rearranges nodes INSIDE it, and
     React removes the wrapper from a parent GSAP never touched. */
  return (
    <div className="mine-mount">
      <section
        ref={sectionRef}
        className={`mine-sec${pinned ? " is-pinned" : ""}`}
        data-surface="dark"
        aria-labelledby="process-heading"
      >
        <MineField progress={progress} className="mine-sec__canvas" />
        {/* Keeps the type legible over the brightest part of the shaft. */}
        <div className="mine-sec__scrim" aria-hidden="true" />

        <div className="shell mine-sec__inner">
          <div className="section-head" data-reveal>
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>
              05
            </span>
            <span className="u-eyebrow">How the work runs</span>
          </div>

          <h2
            id="process-heading"
            className="t-display-lg line-mask mine-sec__head"
            data-reveal-delay={60}
          >
            <span>Every stage hands you something.</span>
          </h2>

          <p className="mine-sec__lede" data-reveal data-reveal-delay={120}>
            Stage names are easy to write. Artifacts are not. Each stage below
            names the thing you actually receive — which is what makes a
            process claim checkable.
          </p>

          <div className="mine-sec__body">
            {/* The ledger. Every stage is always present and always readable;
                `is-active` is emphasis, never the difference between visible
                and invisible. */}
            <ol className="mine-ledger">
              {stages.map((s, i) => (
                <li
                  key={s.index}
                  className={`mine-ledger__row${i === active && pinned ? " is-active" : ""}`}
                >
                  <span className="mine-ledger__n" aria-hidden="true">
                    {s.index}
                  </span>
                  <div className="mine-ledger__text">
                    <h3 className="t-title-lg mine-ledger__name">{s.name}</h3>
                    <p className="mine-ledger__body">{s.body}</p>
                    <p className="mine-ledger__artifact">
                      <span className="u-eyebrow">You receive</span>
                      {s.artifact}
                    </p>
                  </div>
                </li>
              ))}
            </ol>

            {/* The extraction readout. Only meaningful while the sequence is
                actually being scrubbed, so it is only rendered then. */}
            {pinned ? (
              <aside className="mine-readout" aria-hidden="true">
                <p className="u-eyebrow mine-readout__label">Extracting</p>
                <p className="mine-readout__stage">{current.name}</p>
                <p className="mine-readout__artifact">{current.artifact}</p>
                <div className="mine-readout__bar">
                  <span
                    style={{
                      transform: `scaleY(${(active + 1) / stages.length})`,
                    }}
                  />
                </div>
              </aside>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
