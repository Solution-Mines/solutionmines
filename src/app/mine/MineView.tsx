"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./mine.css";
import { MineField } from "@/components/mine/MineField";
import { stages } from "@/content/site";

/* Development harness for the mine sequence. Deliberately not the real
   section: this exists to judge the geometry and the flow pulse against a
   plain scroll driver, before any of it is wired into the delivery spine. */

export function MineView() {
  const progress = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [readout, setReadout] = useState(0);

  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      progress.current = p;
      setReadout(p);
    };
    // Coalesce to one read per frame: a scroll listener that measures on every
    // event forces layout far more often than the screen can show it.
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const level = Math.min(stages.length - 1, Math.floor(readout * stages.length));

  return (
    <div ref={scrollRef} style={{ height: "340vh", position: "relative" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
          backgroundColor: "var(--color-ink-1000)",
        }}
      >
        <MineField
          progress={progress}
          onReady={onReady}
          className="mine-canvas"
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "clamp(1.5rem, 1rem + 3vw, 4rem)",
            pointerEvents: "none",
            opacity: ready ? 1 : 0,
            transition: "opacity 600ms ease-out",
          }}
        >
          <p
            className="u-eyebrow"
            style={{ color: "var(--color-signal-300)", margin: 0 }}
          >
            Mine sequence — development harness
          </p>

          <div>
            <p
              className="u-eyebrow"
              style={{ color: "var(--color-ink-300)", margin: "0 0 0.4rem" }}
            >
              {stages[level].index} — {stages[level].name}
            </p>
            <p
              style={{
                margin: 0,
                color: "var(--color-ink-100)",
                fontSize: "var(--text-body-sm)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              depth {(readout * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
