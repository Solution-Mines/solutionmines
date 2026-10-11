"use client";

import { useEffect, useRef, useState } from "react";
import { useMotion } from "@/lib/motion/MotionProvider";

const LINKS = [
  { href: "#services", label: "Services" },
  { href: "#work", label: "Work" },
  { href: "#process", label: "How we work" },
];

export function Nav() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { reduced, toggleReduced } = useMotion();

  /* Scroll state. Debounced by an 8px threshold so it cannot flicker.
     The nav HEIGHT never changes between states — a 4px padding change on
     scroll is a real, measurable CLS event. */
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        setSolid(window.scrollY > 8);
        frame = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /* Mobile panel: Esc closes, focus returns to the trigger, body scroll locks
     without changing body width (scrollbar-gutter handles that globally). */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50"
      style={{
        backgroundColor: solid ? "color-mix(in srgb, var(--color-surface) 88%, transparent)" : "transparent",
        backdropFilter: solid ? "blur(14px) saturate(1.2)" : "none",
        borderBottom: `1px solid ${solid ? "var(--color-hairline)" : "transparent"}`,
        transition:
          "background-color var(--dur-base) var(--ease-standard), border-color var(--dur-base) var(--ease-standard)",
      }}
    >
      <nav aria-label="Main" className="shell shell--wide">
        {/* fixed height in BOTH states */}
        <div className="flex h-[72px] items-center justify-between">
          <a
            href="#main"
            className="u-display link-quiet"
            style={{ fontSize: "1.375rem", letterSpacing: "-0.02em" }}
          >
            SolutionMines
            <span style={{ color: "var(--color-accent)" }}>.</span>
          </a>

          <div className="hidden items-center gap-10 md:flex">
            <ul className="flex items-center gap-8">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="u-eyebrow link-quiet">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <a href="#contact" className="btn btn--solid" style={{ padding: "0.7rem 1.25rem", minHeight: 40 }}>
              <span>Start a project</span>
            </a>
          </div>

          <button
            ref={toggleRef}
            type="button"
            className="u-eyebrow md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            style={{
              minHeight: 44,
              minWidth: 44,
              color: "var(--color-text-primary)",
            }}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </nav>

      {/* Mobile panel. `inert`-equivalent: unmounted when closed, so it is
          never a hidden tab stop. */}
      {open && (
        <div
          id="mobile-nav"
          ref={panelRef}
          className="md:hidden"
          style={{
            backgroundColor: "var(--color-surface)",
            borderBottom: "1px solid var(--color-hairline)",
            height: "calc(100dvh - 72px)",
          }}
        >
          <div className="shell flex h-full flex-col justify-between py-10">
            <ul className="flex flex-col gap-2">
              {LINKS.map((l) => (
                <li key={l.href} style={{ borderTop: "1px solid var(--color-hairline)" }}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="t-display-md link-quiet block py-4"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-4">
              <a href="#contact" onClick={() => setOpen(false)} className="btn btn--solid justify-center">
                <span>Start a project</span>
                <span className="btn__arrow" aria-hidden="true">&rarr;</span>
              </a>
              <button type="button" onClick={toggleReduced} className="u-eyebrow py-2" style={{ color: "var(--color-text-subtle)" }}>
                Motion: {reduced ? "reduced" : "full"} &middot; tap to change
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
