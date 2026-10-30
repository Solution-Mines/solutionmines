"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./voxel.css";
import {
  VoxelField,
  ALL_LAYERS,
  type VoxelStats,
  type GeometryMode,
  type BenchResult,
  type Layers,
  type MineState,
  type TargetScreen,
  type VoxelControls,
} from "@/components/voxel/VoxelField";
import {
  VOXEL_SIZE,
  type MineInfo,
  type VoxelTerrain,
} from "@/lib/voxel/terrain";
import {
  ACTS,
  STAGE_SPANS,
  actAt,
  depthAt,
  stratumAt,
} from "@/lib/voxel/journey";
import { site } from "@/content/site";

/* ----------------------------------------------------------------------------
   THE SCROLL JOURNEY

   Scroll drives the camera and nothing else. ScrollTrigger writes a number
   into a box; the renderer's own animation loop -- the one that was already
   running for the water -- reads that box once per frame and places the
   camera from it. There is exactly ONE loop touching the GL context, and the
   scroll machinery cannot reach it.

   Getting that wrong is the usual way these break: calling render() from
   onUpdate means a flung scrollbar submits frames faster than the display can
   take them, while the animation loop submits its own on top, and the result
   tears in a way that looks like a shader bug for a long time before anyone
   suspects the scroll.

   There is no pin. The canvas is held by position: sticky, which is the
   browser's own mechanism -- nothing rewrites the scroll position, no spacer
   element is injected, and the page scrolls exactly as a page does. The copy
   is ordinary sections in the flow, so it scrolls past naturally and needs no
   JavaScript to be readable or to be reached by a screen reader.

   HOW THE WORDS AND THE CAMERA STAY TOGETHER
   Each act declares how many screens tall it is. That number lays the section
   out HERE, through a custom property, and computes the act's camera key over
   in journey.ts. Neither file owns it, so retiming an act moves its copy and
   its shot together -- the alternative is a storyboard that is correct on the
   day it is written.

   Query string, for development only:
     ?mode=cubes|faces   which geometry form to draw
     ?bench=1            run the synchronous timing pass and print the result
     ?layers=a,b         build only these on top of the island: sky, water, falls
     ?p=0.73             hold the journey at one progress, for stills
     ?aa=1 ?dpr=1.25     rendering trades, for measurement
-------------------------------------------------------------------------------*/

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; terrain: VoxelTerrain }
  | { kind: "error"; message: string };

type Opts = {
  mode: GeometryMode;
  bench: boolean;
  layers: Layers;
  /** Rendering trade switches, for measurement: ?aa=1 and ?dpr=1.25 */
  aa: boolean;
  dpr: number;
  /** A fixed progress to hold, instead of reading the scrollbar. */
  hold: number | null;
};

const LAYER_NAMES = ["sky", "water", "falls"] as const;

function readOpts(search: string): Opts {
  const q = new URLSearchParams(search);
  const raw = q.get("layers");
  const layers: Layers = raw
    ? { sky: false, water: false, falls: false }
    : { ...ALL_LAYERS };
  if (raw) {
    for (const name of raw.split(",").map((s) => s.trim())) {
      if ((LAYER_NAMES as readonly string[]).includes(name)) {
        layers[name as keyof Layers] = true;
      }
    }
  }
  const p = q.get("p");
  const hold = p === null ? null : Math.min(1, Math.max(0, Number(p) || 0));
  const dprRaw = Number(q.get("dpr"));
  return {
    mode: q.get("mode") === "cubes" ? "cubes" : "faces",
    bench: q.has("bench"),
    layers,
    hold,
    aa: q.get("aa") === "1",
    dpr: Number.isFinite(dprRaw) && dprRaw > 0 ? Math.min(3, dprRaw) : 1.5,
  };
}

function describe(layers: Layers) {
  const on = LAYER_NAMES.filter((n) => layers[n]);
  return on.length ? `island+${on.join("+")}` : "island";
}

/** One screen of hold at the end, matching the tail journey.ts allows for. */
const TAIL = STAGE_SPANS - ACTS.reduce((n, a) => n + a.span, 0);

/** The act the mining interaction belongs to: the working face. */
const MINING_ACT = 3;

export function VoxelView() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [stats, setStats] = useState<VoxelStats | null>(null);
  const [bench, setBench] = useState<BenchResult | null>(null);
  const [act, setAct] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [mine, setMine] = useState<MineState>({
    stage: 0,
    stages: 4,
    broken: false,
    available: false,
  });

  /* Scroll position, 0 to 1. A ref and not state, deliberately: this changes
     on every scroll event, and a state update per event would re-render the
     page sixty times a second to no visible effect -- the canvas is not React
     and does not need telling. */
  const progress = useRef(0);
  const actRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const mineRef = useRef<MineInfo | null>(null);
  const controlsRef = useRef<VoxelControls | null>(null);
  const mineBtnRef = useRef<HTMLButtonElement>(null);
  /* The last visibility we wrote. The projection runs every frame; toggling
     `hidden` on every one of them would thrash the accessibility tree. */
  const mineShown = useRef<boolean | null>(null);
  const metresRef = useRef<HTMLSpanElement>(null);
  const stratumRef = useRef<HTMLSpanElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /* Read in an effect rather than a state initialiser: the server has no
     query string, so initialising from it would make the first client render
     disagree with the server's and trip a hydration mismatch.

     Null until it has been read, and the field does not mount before then.
     Starting with a default and correcting it builds the whole scene once
     with the wrong layers and immediately throws it away. */
  const [opts, setOpts] = useState<Opts | null>(null);
  useEffect(() => {
    setOpts(readOpts(window.location.search));
  }, []);

  /* Resolved here as well as inside the renderer. They read the same two
     sources, and the renderer cannot be handed this one as a prop without
     making a preference change rebuild the whole scene. */
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const resolve = () =>
      setReduced(
        mql.matches || document.documentElement.dataset.motion === "reduced",
      );
    resolve();
    mql.addEventListener("change", resolve);
    return () => mql.removeEventListener("change", resolve);
  }, []);

  const onReady = useCallback((terrain: VoxelTerrain) => {
    mineRef.current = terrain.mine;
    setState({ kind: "ready", terrain });
  }, []);
  const onError = useCallback(
    (message: string) => setState({ kind: "error", message }),
    [],
  );
  const onStats = useCallback((s: VoxelStats) => setStats(s), []);
  const onBench = useCallback((b: BenchResult) => setBench(b), []);

  /* Written straight to the DOM, once per frame. Going through state here
     would put a React render between the camera and the number that describes
     it, and the readout would lag the picture it is reporting on. */
  const onFrame = useCallback(({ p, y }: { p: number; y: number }) => {
    const info = mineRef.current;
    if (!info) return;
    if (metresRef.current) {
      metresRef.current.textContent = String(Math.round(depthAt(y, info)));
    }
    if (stratumRef.current) {
      stratumRef.current.textContent = stratumAt(y, info);
    }
    dialRef.current?.style.setProperty("--vx-p", p.toFixed(4));
    trackRef.current?.style.setProperty("--vx-p", p.toFixed(4));
  }, []);

  const onMine = useCallback((s: MineState) => setMine(s), []);

  /* Positioning only -- written straight to the element, like the depth
     readout, because it happens once per frame and a React render per frame
     to move a button would be absurd. */
  const onTarget = useCallback((t: TargetScreen) => {
    const el = mineBtnRef.current;
    if (!el) return;
    if (mineShown.current !== t.visible) {
      mineShown.current = t.visible;
      /* `hidden` rather than opacity: a button that cannot be seen must not
         be in the tab order either, and this takes it out of the
         accessibility tree as well. */
      el.hidden = !t.visible;
    }
    if (!t.visible) return;
    // Never smaller than a comfortable touch target, however far away it is.
    const size = Math.max(48, t.size * 1.2);
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.transform = `translate(${t.x - size / 2}px, ${t.y - size / 2}px)`;
  }, []);

  const hover = useCallback((on: boolean) => controlsRef.current?.hover(on), []);
  const activate = useCallback(() => {
    const c = controlsRef.current;
    if (!c) return;
    if (mine.broken) c.reset();
    else c.strike();
  }, [mine.broken]);

  /* --- the one trigger ---------------------------------------------------- */
  useEffect(() => {
    if (!opts) return;

    // Held at a fixed frame for stills: nothing to listen to.
    if (opts.hold !== null) {
      progress.current = opts.hold;
      setAct(actAt(opts.hold));
      return;
    }
    if (reduced) {
      progress.current = 0;
      return;
    }

    const stage = stageRef.current;
    if (!stage) return;

    const trigger = ScrollTrigger.create({
      trigger: stage,
      /* The stage is exactly as tall as its sections, and the sticky canvas
         stops sticking the moment its bottom edge arrives -- so these two
         edges are the same two the camera path is defined between. */
      start: "top top",
      end: "bottom bottom",
      /* scrub with no number: report the scrollbar exactly, and let the
         renderer do the smoothing. GSAP's own scrub lerp would be a second
         filter in series with that one, and two lags in a row read as the
         camera being heavy rather than smooth. */
      scrub: true,
      onUpdate: (self) => {
        progress.current = self.progress;
        /* No fudge factor here any more. An act's threshold is now the
           progress at which its section's TOP edge reaches the middle of the
           screen, computed from the same spans that lay the section out, so
           the act that is highlighted is the act being read. */
        const next = actAt(self.progress);
        if (next !== actRef.current) {
          actRef.current = next;
          setAct(next);
        }
      },
    });

    /* The trigger measured the page during mount. Fonts land after that and
       change every section's height, which moves the end point. */
    let frame = 0;
    const settle = () => ScrollTrigger.refresh();
    if (document.fonts?.status === "loaded") frame = requestAnimationFrame(settle);
    else document.fonts?.ready.then(settle).catch(settle);

    return () => {
      cancelAnimationFrame(frame);
      // Kills this trigger only. ScrollTrigger.killAll() would take out
      // anything the rest of the app had created.
      trigger.kill();
    };
  }, [opts, reduced]);

  const scene = opts ? describe(opts.layers) : describe(ALL_LAYERS);
  const debug = Boolean(opts?.bench);

  /* Jumping to an act. Under reduced motion there is no scroll to move
     through, so the same control shows that act's frame instead -- which is
     why this is one handler and not two separate pieces of UI. */
  const goTo = useCallback(
    (i: number) => {
      actRef.current = i;
      setAct(i);
      if (reduced) {
        progress.current = ACTS[i].still;
        controlsRef.current?.showAt(ACTS[i].still);
      }
    },
    [reduced],
  );

  return (
    /* id="main" because the root layout renders a skip link pointing at it on
       every route, and this one sits outside the group that provides it. */
    <div
      className={`vx${reduced ? " is-static" : ""}${opts?.hold != null ? " is-held" : ""}`}
      id="main"
    >
      {/* The chapter rail: a progress indicator and a table of contents in
          one element.

          Real anchors, so it works with scripting off and a keyboard user
          gets the browser's own in-page navigation rather than a hand-rolled
          imitation of it. The fill underneath is written per frame by the
          renderer, like the depth dial. */}
      <nav className="vx__chapters" aria-label="Chapters">
        <div className="vx__track" ref={trackRef} aria-hidden="true">
          <span className="vx__track-fill" />
        </div>
        <ol className="vx__chapter-list">
          {ACTS.map((a, i) => (
            <li key={a.id} className="vx__chapter">
              <a
                href={`#vx-act-${a.id}`}
                className={`vx__chapter-link${i === act ? " is-live" : ""}`}
                aria-current={i === act ? "step" : undefined}
                onClick={() => goTo(i)}
              >
                <span className="vx__chapter-no">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="vx__chapter-name">{a.nav}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="vx__stage" ref={stageRef}>
        <div className="vx__sticky">
          {opts ? (
            <VoxelField
              key={`${opts.mode}:${opts.bench}:${scene}:${opts.aa}:${opts.dpr}`}
              className="vx__canvas"
              geometry={opts.mode}
              antialias={opts.aa}
              maxDpr={opts.dpr}
              layers={opts.layers}
              bench={opts.bench}
              progress={progress}
              controls={controlsRef}
              onReady={onReady}
              onError={onError}
              onStats={onStats}
              onBench={onBench}
              onFrame={onFrame}
              onMine={onMine}
              onTarget={onTarget}
            />
          ) : null}

          {state.kind === "loading" ? (
            <p className="vx__note" role="status">
              Building terrain&hellip;
            </p>
          ) : null}

          {state.kind === "error" ? (
            <div className="vx__note vx__note--error" role="alert">
              {/* The real reason, not a shrug: a blank box teaches nobody
                  anything, and WebGL failures are usually specific. */}
              <p className="vx__note-head">This scene could not start</p>
              <p className="vx__note-body">{state.message}</p>
              <p className="vx__note-body">
                The prototype needs WebGL. Everything else on the site works
                without it.
              </p>
            </div>
          ) : null}

          {/* The mineable block's control.

              A real button, positioned over the block rather than drawn in
              the scene. Everything the brief asks for on the input side --
              hover, keyboard focus, Enter, Space, touch -- is what a button
              already does; hit-testing the canvas would mean rebuilding all
              of it badly and still leaving the interaction invisible to
              assistive technology. The scene reacts by being told, through
              `hover`, what the button is doing. */}
          {mine.available ? (
            <button
              ref={mineBtnRef}
              type="button"
              hidden
              className={`vx__mine${mine.broken ? " is-broken" : ""}`}
              onPointerEnter={() => hover(true)}
              onPointerLeave={() => hover(false)}
              onFocus={() => hover(true)}
              onBlur={() => hover(false)}
              onClick={activate}
              aria-label={
                mine.broken
                  ? "Ore exposed. Activate to reset the block."
                  : `Strike the rock face. ${mine.stage} of ${mine.stages} strikes landed.`
              }
            >
              <span className="vx__mine-ring" aria-hidden="true" />
            </button>
          ) : null}

          {/* The payoff.

              The one place in the prototype where the metaphor has to pay
              for itself. It names a real stage and a real artifact from the
              content layer rather than a slogan about digging, and it only
              exists once the block is actually open. Gated on the act as
              well, so scrolling away does not leave it hanging over a sky. */}
          {mine.broken && act === MINING_ACT ? (
            <aside className="vx__payoff">
              <p className="vx__payoff-kicker">{ACTS[1].kicker}</p>
              <p className="vx__payoff-body">
                Finding what is actually in the rock is the work. It is why
                Discovery ends with {ACTS[1].artifact?.toLowerCase()}, rather
                than an estimate.
              </p>
            </aside>
          ) : null}

          {/* Said once per stage, not per frame. The dial deliberately has no
              live region for the same reason: a number that changes sixty
              times a second would never stop being announced. */}
          <p className="u-sr-only" aria-live="polite">
            {mine.broken
              ? "The stone gives way. Gold ore is exposed."
              : mine.stage > 0
                ? `Strike ${mine.stage} of ${mine.stages}. The rock is cracking.`
                : ""}
          </p>

          {/* The depth readout. Its numbers are written per frame by the
              renderer; aria-live is deliberately absent, because a figure
              that changes sixty times a second would be announced
              continuously and make the page unusable with a screen reader.
              The headings below carry the same information in prose. */}
          <div className="vx__dial" ref={dialRef} aria-hidden="true">
            <div className="vx__dial-track">
              <div className="vx__dial-fill" />
            </div>
            <div className="vx__dial-read">
              <span className="vx__dial-metres" ref={metresRef}>
                0
              </span>
              <span className="vx__dial-unit">m</span>
            </div>
            <span className="vx__dial-stratum" ref={stratumRef}>
              Surface
            </span>
          </div>
        </div>

        {/* Reduced motion gets one frame and no loop, so without this the
            journey below the surface -- and the block at the bottom of it --
            is simply unreachable. These are not an animation: each one draws
            a single still, on request, the way a figure in an article
            changes when you choose a different one. */}
        {reduced ? (
          <div className="vx__views">
            <span className="vx__views-label" id="vx-views">
              Show
            </span>
            <span className="vx__views-row" role="group" aria-labelledby="vx-views">
              {ACTS.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  className={`vx__view${i === act ? " is-on" : ""}`}
                  aria-pressed={i === act}
                  onClick={() => goTo(i)}
                >
                  {a.nav}
                </button>
              ))}
            </span>
          </div>
        ) : null}

        {/* Real sections in the normal flow, pulled back over the sticky
            canvas. They scroll by themselves -- no JavaScript positions them,
            and with styles or scripting unavailable they are simply an
            article about the scene. */}
        <div className="vx__rail">
          {ACTS.map((a, i) => (
            <section
              key={a.id}
              id={`vx-act-${a.id}`}
              className={`vx__beat${i === act ? " is-live" : ""}`}
              /* The one number that lays this act out AND decides where its
                 camera key lands. Set from the same field journey.ts reads. */
              style={{ "--vx-span": a.span } as React.CSSProperties}
              aria-labelledby={`vx-act-${a.id}-h`}
            >
              <div className="vx__card">
                {/* The kicker alone. It already carries the delivery
                    stage's own number where there is one, and printing the
                    act's position beside it gave cards reading "04 03 -
                    Build" -- two numbering systems side by side, which reads
                    as a bug. Position is the chapter rail's job. */}
                <p className="vx__kicker">{a.kicker}</p>
                <h2 className="vx__title" id={`vx-act-${a.id}-h`}>
                  {a.title}
                </h2>
                <p className="vx__body">{a.body}</p>

                {a.list ? (
                  <ul className="vx__list">
                    {a.list.map((item) => (
                      <li key={item.lead} className="vx__list-item">
                        <span className="vx__list-lead">{item.lead}</span>
                        {item.note ? (
                          <span className="vx__list-note">{item.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* What the client is actually handed. Artifacts are what
                    make a process section credible; stage names alone are
                    not, and this prototype has no case studies to lean on
                    because none have been verified. */}
                {a.artifact ? (
                  <p className="vx__artifact">
                    <span className="vx__artifact-label">You receive</span>
                    {a.artifact}
                  </p>
                ) : null}

                {a.id === "outcome" ? (
                  <a className="vx__cta" href={`mailto:${site.email}`}>
                    Start a conversation
                    <span aria-hidden="true">&nbsp;&rarr;</span>
                  </a>
                ) : null}
              </div>
            </section>
          ))}
          {/* A last hold with nothing in it, so progress can reach 1 with the
              final card already gone and the island held on its own. */}
          <div
            className="vx__tail"
            style={{ "--vx-span": TAIL } as React.CSSProperties}
            aria-hidden="true"
          />
        </div>
      </div>

      <footer className="vx__bar">
        <span className="vx__bar-title">
          {VOXEL_SIZE}&times;{VOXEL_SIZE}&times;{VOXEL_SIZE}
          <i>/</i>
          {opts?.mode === "cubes" ? "instanced cubes" : "instanced faces"}
          <i>/</i>
          {scene}
          {bench ? (
            <>
              <i>/</i>
              <b>
                {bench.msMin.toFixed(3)}/{bench.msMedian.toFixed(3)}/
                {bench.msMax.toFixed(3)} ms
              </b>
              <i>/</i>
              {bench.runs}&times;{bench.framesPerRun}
              <i>/</i>
              {(bench.pixels / 1e6).toFixed(2)} MPX
              <i>/</i>
              build {bench.buildMs.toFixed(1)} ms
            </>
          ) : null}
        </span>
        {state.kind === "ready" ? (
          <span className="vx__bar-stats">
            <b>{state.terrain.faceCount.toLocaleString()}</b> faces
            <i>/</i>
            <b>{(state.terrain.faceCount * 2).toLocaleString()}</b> tris
            <i>/</i>
            <b>{state.terrain.mine.ore}</b> ore
            <i>/</i>
            <b>{state.terrain.falls.length}</b> falls
            {debug ? (
              <>
                <i>/</i>
                <b>{bench ? bench.drawCalls : "--"}</b> draws
                <i>/</i>
                <b>{stats ? stats.fps : "--"}</b> fps
              </>
            ) : null}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
