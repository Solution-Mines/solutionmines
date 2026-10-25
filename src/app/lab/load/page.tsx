"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./load.css";
import { LoadField, type LoadStats } from "@/components/lab/LoadField";
import { LabScope } from "@/components/lab/LabScope";
import { site, stages } from "@/content/site";

/* ----------------------------------------------------------------------------
   DIRECTION 05 — UNDER LOAD

   The hero is not type over a backdrop. The topology behind it is carrying
   traffic, and the readout under the headline is that simulation's own
   numbers. Move the pointer in and the figures move, because you are the
   load.

   MOTION
   /lab has its own layout and does NOT mount MotionProvider, so there is no
   Lenis here and ScrollTrigger is not registered for us. Both are handled
   locally, and the reduced-motion preference is read the same way the
   provider reads it (media query OR the data-motion attribute the boot
   script sets) so the lab honours the site-wide toggle.

   Following the provider's own rule — "if it does not scrub, do not use a
   ScrollTrigger" — there is exactly one scrubbed trigger, for the camera,
   because that genuinely tracks scroll position. Every other reveal is one
   IntersectionObserver with N targets. No pin: the site has one, and it is
   the delivery spine.
-------------------------------------------------------------------------------*/

const EMPTY: LoadStats = { rps: 0, p99: 0, saturated: 0, depth: 0 };

export default function LoadPage() {
  const [s, setS] = useState<LoadStats>(EMPTY);
  const root = useRef<HTMLDivElement>(null);
  const progress = useRef(0);

  const onStats = useCallback((next: LoadStats) => setS(next), []);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";

    /* Settled state. Also the no-JS and reduced-motion fallback: nothing is
       ever left invisible because a timeline did not run. */
    const settle = () => scope.classList.add("load-ready");

    if (reduced) {
      settle();
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      /* Entrance. Line 1 is unmasked and painted at full opacity on frame
         one — it is the LCP candidate, and Chrome will not count a clipped
         or transparent element, so a fully-masked headline reports LCP at
         the END of its own reveal. It is offset by transform only. */
      const tl = gsap.timeline({
        defaults: { ease: "expo.out" },
        onStart: settle,
      });

      tl.to('[data-load="eyebrow"]', { opacity: 1, y: 0, duration: 0.5 })
        .to(".load-hero__l1", { y: 0, duration: 0.9 }, "-=0.25")
        .fromTo(
          ".load-mask > span",
          { yPercent: 112 },
          { yPercent: 0, duration: 0.95, stagger: 0.09 },
          "-=0.72",
        )
        /* The readout boots cell by cell, left to right, like a panel coming
           up — which is what it is. */
        .to(
          '[data-load="cell"]',
          {
            opacity: 1,
            scaleY: 1,
            duration: 0.42,
            stagger: 0.055,
            ease: "power3.out",
          },
          "-=0.5",
        )
        /* The depth bar is deliberately NOT animated in: its transform is
           written inline from live telemetry every quarter second, so a
           tween would fight React for the same property. */
        .to(
          '[data-load="fade"]',
          { opacity: 1, y: 0, duration: 0.55, stagger: 0.07, ease: "power3.out" },
          "-=0.45",
        );

      /* The one scrubbed trigger. The camera dollies back and swings round
         as the hero leaves, so hero -> pipeline is one continuous move
         rather than a cut. Writes to a ref: scrolling must not re-render. */
      ScrollTrigger.create({
        trigger: ".load-hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.6,
        onUpdate: (self) => {
          progress.current = self.progress;
        },
      });

      /* Everything below the fold is a plain reveal, so it is ONE observer
         with N targets rather than N ScrollTriggers. */
      const targets = scope.querySelectorAll<HTMLElement>("[data-load='rise']");
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            gsap.to(e.target, {
              opacity: 1,
              y: 0,
              duration: 0.6,
              ease: "power3.out",
              delay: Number((e.target as HTMLElement).dataset.delay ?? 0),
            });
          }
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
      );
      targets.forEach((t) => io.observe(t));

      return () => io.disconnect();
    }, scope);

    /* Nothing should stay hidden if a webfont stalls the timeline. */
    const t = window.setTimeout(settle, 1600);

    return () => {
      window.clearTimeout(t);
      ctx.revert();
    };
  }, []);

  const health =
    s.saturated > 1 ? "degraded" : s.saturated === 1 ? "shedding" : "nominal";

  return (
    <LabScope className="load-scope">
      <div className="load" ref={root}>
        <section className="load-hero">
          <div className="load-hero__fallback" aria-hidden="true" />
          <LoadField
            className="load-hero__canvas"
            onStats={onStats}
            progress={progress}
          />
          <div className="load-hero__scrim" aria-hidden="true" />

          <div className="load-hero__inner">
            <p className="load-hero__eyebrow" data-load="eyebrow">
              <span
                className={`load-dot load-dot--${health}`}
                aria-hidden="true"
              />
              Direction 05 — under load
            </p>

            <h1 className="load-hero__head">
              {/* unmasked, painted on frame one — the LCP candidate */}
              <span className="load-hero__l1">It stays up</span>
              <span className="load-hero__l2 load-mask">
                <span>
                  when the <em>load</em>
                </span>
              </span>
              <span className="load-hero__l3 load-mask">
                <span>arrives.</span>
              </span>
            </h1>

            <div className="load-readout" role="group" aria-label="Live telemetry">
              <Stat label="req/s" value={String(s.rps).padStart(3, "0")} />
              <Stat label="p99" value={`${s.p99}ms`} warn={s.p99 > 260} />
              <Stat
                label="tripped"
                value={String(s.saturated)}
                warn={s.saturated > 0}
              />
              <Stat label="state" value={health} warn={health !== "nominal"} />
              <div className="load-readout__bar" aria-hidden="true">
                <span
                  style={{ transform: `scaleX(${Math.max(0.02, s.depth)})` }}
                />
              </div>
            </div>

            <p className="load-hero__lede" data-load="fade">
              {site.qualifier}
            </p>

            <div className="load-actions" data-load="fade">
              <Link href="/contact" className="load-btn">
                Start a project
              </Link>
              <Link href="/work" className="load-btn load-btn--ghost">
                See the work
              </Link>
            </div>

            <p className="load-hero__hint" data-load="fade" aria-hidden="true">
              Move the pointer into the field — you become the load
            </p>
          </div>
        </section>

        <section className="load-sec" aria-labelledby="load-stages">
          <div className="load-sec__head" data-load="rise">
            <h2 id="load-stages">How the work runs</h2>
            <span className="load-sec__count">
              {String(stages.length).padStart(2, "0")} stages
            </span>
          </div>

          <ol className="load-pipeline">
            {stages.map((st, i) => (
              <li
                key={st.index}
                className="load-stage"
                data-load="rise"
                data-delay={(i * 0.07).toFixed(2)}
              >
                <span className="load-stage__n" aria-hidden="true">
                  {st.index}
                </span>
                <h3>{st.name}</h3>
                <p>{st.body}</p>
                <p className="load-stage__artifact">{st.artifact}</p>
              </li>
            ))}
          </ol>

          <ul className="load-caps">
            {site.capabilities.map((c, i) => (
              <li key={c} data-load="rise" data-delay={(i * 0.05).toFixed(2)}>
                {c}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </LabScope>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={`load-stat${warn ? " is-warn" : ""}`} data-load="cell">
      <span className="load-stat__k">{label}</span>
      {/* tabular-nums so the row does not jitter as digits change */}
      <span className="load-stat__v">{value}</span>
    </div>
  );
}
