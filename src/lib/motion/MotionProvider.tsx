"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

/* ----------------------------------------------------------------------------
   The single owner of all page-level motion.

   Deliberate architecture (see plan §4.7–§4.8):
   - ONE IntersectionObserver drives every scroll reveal on the page. The plan's
     rule is: if it does not scrub, do not use a ScrollTrigger. One observer
     with N targets is far cheaper than N ScrollTrigger instances.
   - ONE Lenis instance, bridged into gsap.ticker so GSAP and smooth scroll
     share a single rAF loop. Two loops produce a frame-offset judder that is
     painful to diagnose.
   - Reduced motion is resolved HERE and nowhere else, then handed down. No
     component calls matchMedia itself.
-------------------------------------------------------------------------------*/

type MotionState = {
  reduced: boolean;
  toggleReduced: () => void;
  /** True once fonts are ready — text splitting must wait for this. */
  fontsReady: boolean;
};

const MotionContext = createContext<MotionState>({
  reduced: false,
  toggleReduced: () => {},
  fontsReady: false,
});

export const useMotion = () => useContext(MotionContext);

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const lenisRef = useRef<Lenis | null>(null);

  /* --- resolve the reduced-motion preference ------------------------------ */
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stored = document.documentElement.getAttribute("data-motion");
    const resolve = () => setReduced(mql.matches || stored === "reduced");
    resolve();
    mql.addEventListener("change", resolve);
    return () => mql.removeEventListener("change", resolve);
  }, []);

  const toggleReduced = useCallback(() => {
    setReduced((prev) => {
      const next = !prev;
      const root = document.documentElement;
      if (next) {
        root.setAttribute("data-motion", "reduced");
      } else {
        root.removeAttribute("data-motion");
      }
      try {
        localStorage.setItem("sm-motion", next ? "reduced" : "full");
      } catch {
        /* private mode — the in-memory state still applies */
      }
      return next;
    });
  }, []);

  /* --- fonts ------------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) {
        setFontsReady(true);
        // Pin spacers and trigger positions computed against fallback metrics
        // are wrong. Refresh once, after fonts settle — not per image.
        ScrollTrigger.refresh();
      }
    };
    if (document.fonts?.status === "loaded") done();
    else document.fonts?.ready.then(done).catch(done);
    return () => {
      cancelled = true;
    };
  }, []);

  /* --- Lenis + GSAP ticker bridge ----------------------------------------- */
  useEffect(() => {
    if (reduced) {
      // Smooth scroll decouples scroll position from input and is a textbook
      // vestibular trigger. Under reduced motion it is destroyed outright,
      // not merely shortened.
      lenisRef.current?.destroy();
      lenisRef.current = null;
      return;
    }

    const lenis = new Lenis({
      duration: 1.0,
      smoothWheel: true,
      // Native touch momentum is better tuned than any emulation and costs no
      // main-thread time. Hijacked touch scrolling is the single most
      // complained-about mobile pattern.
      syncTouch: false,
    });
    lenisRef.current = lenis;

    const onScroll = () => ScrollTrigger.update();
    lenis.on("scroll", onScroll);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      lenis.off("scroll", onScroll);
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduced]);

  /* --- the one shared reveal observer ------------------------------------- */
  useEffect(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal], .line-mask"),
    );

    if (reduced) {
      targets.forEach((el) => el.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const delay = Number(el.dataset.revealDelay ?? 0);
          if (delay > 0) {
            el.style.transitionDelay = `${delay}ms`;
          }
          el.classList.add("is-revealed");
          // once:true semantics — a revealed element costs nothing further.
          observer.unobserve(el);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reduced, fontsReady]);

  return (
    <MotionContext.Provider value={{ reduced, toggleReduced, fontsReady }}>
      {children}
    </MotionContext.Provider>
  );
}
