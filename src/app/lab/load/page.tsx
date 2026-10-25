"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import "./load.css";
import { LoadField, type LoadStats } from "@/components/lab/LoadField";
import { LabScope } from "@/components/lab/LabScope";
import { site, stages } from "@/content/site";

/* ----------------------------------------------------------------------------
   DIRECTION 05 — UNDER LOAD

   The hero is not type over a backdrop. The topology behind it is carrying
   traffic, and the readout under the headline is that simulation's own
   numbers: requests completed, latency as congestion rises, nodes tripped.
   Move the pointer in and the figures move, because you are the load.

   That is the whole argument. An engineering firm claiming it keeps systems
   up under pressure can either say so in a paragraph, or show one staying up.
-------------------------------------------------------------------------------*/

const EMPTY: LoadStats = { rps: 0, p99: 0, saturated: 0, depth: 0 };

export default function LoadPage() {
  const [s, setS] = useState<LoadStats>(EMPTY);

  /* Stable identity: LoadField keeps the callback in a ref, but a changing
     prop would still churn React needlessly four times a second. */
  const onStats = useCallback((next: LoadStats) => setS(next), []);

  const health =
    s.saturated > 1 ? "degraded" : s.saturated === 1 ? "shedding" : "nominal";

  return (
    <LabScope className="load-scope">
      <div className="load">
        <section className="load-hero">
          <div className="load-hero__fallback" aria-hidden="true" />
          <LoadField className="load-hero__canvas" onStats={onStats} />
          <div className="load-hero__scrim" aria-hidden="true" />

          <div className="load-hero__inner">
            <p className="load-hero__eyebrow">
              <span
                className={`load-dot load-dot--${health}`}
                aria-hidden="true"
              />
              Direction 05 — under load
            </p>

            <h1 className="load-hero__head">
              <span className="load-hero__l1">It stays up</span>
              <span className="load-hero__l2">
                when the <em>load</em>
              </span>
              <span className="load-hero__l3">arrives.</span>
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
                <span style={{ transform: `scaleX(${Math.max(0.02, s.depth)})` }} />
              </div>
            </div>

            <p className="load-hero__lede">{site.qualifier}</p>

            <div className="load-actions">
              <Link href="/contact" className="load-btn">
                Start a project
              </Link>
              <Link href="/work" className="load-btn load-btn--ghost">
                See the work
              </Link>
            </div>

            <p className="load-hero__hint" aria-hidden="true">
              Move the pointer into the field — you become the load
            </p>
          </div>
        </section>

        <section className="load-sec" aria-labelledby="load-stages">
          <div className="load-sec__head">
            <h2 id="load-stages">How the work runs</h2>
            <span className="load-sec__count">
              {String(stages.length).padStart(2, "0")} stages
            </span>
          </div>

          <ol className="load-pipeline">
            {stages.map((st) => (
              <li key={st.index} className="load-stage">
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
            {site.capabilities.map((c) => (
              <li key={c}>{c}</li>
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
    <div className={`load-stat${warn ? " is-warn" : ""}`}>
      <span className="load-stat__k">{label}</span>
      {/* tabular-nums so the row does not jitter as digits change */}
      <span className="load-stat__v">{value}</span>
    </div>
  );
}
