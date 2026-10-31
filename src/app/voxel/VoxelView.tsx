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
  type Cover,
} from "@/components/voxel/VoxelField";
import {
  buildTerrain,
  VOXEL_SIZE,
  type MineInfo,
  type VoxelTerrain,
} from "@/lib/voxel/terrain";
import {
  ACTS,
  STAGE_SPANS,
  actAt,
  depthAlong,
  stratumFor,
} from "@/lib/voxel/journey";
import { buildIcons, dirtTile, type IconSet } from "@/lib/voxel/icons";
import type { Atlas } from "@/lib/voxel/atlas";
import { site } from "@/content/site";
import { PixelNumber } from "./PixelNumber";

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
     ?cam=x,y,z,lx,ly,lz[,fov]  a fixed camera for stills, with ?p= for the rest
     ?aa=1 ?dpr=1.25     rendering trades, for measurement
     ?perf=1             record main-thread stalls (long tasks) from load
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
  /** A fixed camera for stills: ?cam=x,y,z,lookX,lookY,lookZ[,fov]. */
  cam: { pos: [number, number, number]; look: [number, number, number]; fov: number } | null;
  /** Record long tasks from load: ?perf=1. */
  perf: boolean;
  /** ?dpr set by hand: hold that density, no governor. */
  dprFixed: boolean;
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
  const camNums = (q.get("cam") ?? "").split(",").map(Number);
  const cam =
    camNums.length >= 6 && camNums.every(Number.isFinite)
      ? {
          pos: [camNums[0], camNums[1], camNums[2]] as [number, number, number],
          look: [camNums[3], camNums[4], camNums[5]] as [number, number, number],
          fov: camNums[6] || 50,
        }
      : null;
  const dprRaw = Number(q.get("dpr"));
  /* Pixel density: one and a half at most on a desktop, one and a quarter
     on a touch screen -- a phone's fill rate is the limit there, and its
     own density is already three -- unless ?dpr says otherwise. */
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return {
    mode: q.get("mode") === "cubes" ? "cubes" : "faces",
    bench: q.has("bench"),
    layers,
    hold,
    cam,
    aa: q.get("aa") === "1",
    perf: q.has("perf"),
    dprFixed: Number.isFinite(dprRaw) && dprRaw > 0,
    dpr: Number.isFinite(dprRaw) && dprRaw > 0 ? Math.min(3, dprRaw) : coarse ? 1.25 : 1.5,
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
    collected: 0,
  });

  /* Scroll position, 0 to 1. A ref and not state, deliberately: this changes
     on every scroll event, and a state update per event would re-render the
     page sixty times a second to no visible effect -- the canvas is not React
     and does not need telling. */
  const progress = useRef(0);
  const actRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const mineRef = useRef<MineInfo | null>(null);
  // The ledge's floor, for the depth readout's base camp.
  const ledgeRef = useRef(0);
  const controlsRef = useRef<VoxelControls | null>(null);
  const mineBtnRef = useRef<HTMLButtonElement>(null);
  // The ore slot in the hotbar: where a piece of ore flies when picked up.
  const bagRef = useRef<HTMLElement | null>(null);
  /* The last visibility we wrote. The projection runs every frame; toggling
     `hidden` on every one of them would thrash the accessibility tree. */
  const mineShown = useRef<boolean | null>(null);
  const metresRef = useRef<HTMLSpanElement>(null);
  const stratumRef = useRef<HTMLSpanElement>(null);
  const hudRef = useRef<HTMLElement>(null);

  /* The hotbar's pictures, cut from the world's own atlas -- painted in the
     worker with the world and handed over with it -- once the world is
     here. The loading screen's ground is one tile, painted at once. */
  const [icons, setIcons] = useState<IconSet | null>(null);
  const [dirt, setDirt] = useState<string | null>(null);
  useEffect(() => {
    setDirt(dirtTile());
  }, []);

  // How far the world build has got, from the worker, for the loading screen.
  const [load, setLoad] = useState({ done: 0, stage: "Raising the island" });

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

  /* The world, built in a worker so the page answers its first scroll while
     half a million cells are filled and lit. Falling back to the main thread
     is a stall, which is a far better outcome than no scene at all. */
  const [world, setWorld] = useState<{ terrain: VoxelTerrain; ms: number; atlas?: Atlas | null } | null>(
    null,
  );
  useEffect(() => {
    if (world) setIcons(buildIcons(world.atlas));
  }, [world]);
  const falls = opts?.layers.falls;
  useEffect(() => {
    if (falls === undefined) return;
    let disposed = false;
    let worker: Worker | null = null;
    const done = (terrain: VoxelTerrain, ms: number, atlas: Atlas | null = null) => {
      performance.mark("vx:world");
      if (!disposed) setWorld({ terrain, ms, atlas });
    };
    const buildHere = () => {
      const t0 = performance.now();
      try {
        done(buildTerrain(0x7a19, { falls }), performance.now() - t0);
      } catch (e) {
        if (!disposed) {
          setState({ kind: "error", message: e instanceof Error ? e.message : "Could not build the scene" });
        }
      }
    };
    try {
      worker = new Worker(new URL("../../lib/voxel/world.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (
        event: MessageEvent<
          | { terrain: VoxelTerrain; ms: number; atlas: Atlas | null }
          | { error: string }
          | { progress: number; stage: string }
        >,
      ) => {
        if ("progress" in event.data) {
          if (!disposed) setLoad({ done: event.data.progress, stage: event.data.stage });
          return;
        }
        if ("error" in event.data) buildHere();
        else done(event.data.terrain, event.data.ms, event.data.atlas);
        worker?.terminate();
        worker = null;
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        buildHere();
      };
      worker.postMessage({ falls });
    } catch {
      buildHere();
    }
    return () => {
      disposed = true;
      worker?.terminate();
    };
  }, [falls]);

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
    performance.mark("vx:ready");
    mineRef.current = terrain.mine;
    ledgeRef.current = terrain.site.ledge.y;
    setState({ kind: "ready", terrain });
  }, []);
  const onError = useCallback(
    (message: string) => setState({ kind: "error", message }),
    [],
  );
  const onStats = useCallback((s: VoxelStats) => setStats(s), []);
  const onBench = useCallback((b: BenchResult) => {
    setBench(b);
    // For the measurement harness, which reads it rather than the footer.
    (window as unknown as { __vxBench?: BenchResult }).__vxBench = b;
  }, []);

  /* ?perf: every main-thread task over 50ms from here on, for the
     measurement harness, with marks for when the world arrives from the
     worker and when the scene is ready -- so a stall can be put down to the
     build, the scene setup or a frame. */
  const perf = opts?.perf;
  useEffect(() => {
    if (!perf || typeof PerformanceObserver === "undefined") return;
    const w = window as unknown as { __vxLong?: Array<{ start: number; ms: number }> };
    w.__vxLong = [];
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__vxLong?.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) });
        }
      });
      obs.observe({ type: "longtask", buffered: true });
    } catch {
      // Long tasks are not observable in this browser: nothing to record.
    }
    return () => obs?.disconnect();
  }, [perf]);

  /* Written straight to the DOM, once per frame. Going through state here
     would put a React render between the camera and the number that describes
     it, and the readout would lag the picture it is reporting on. */
  const onFrame = useCallback(({ p }: { p: number; y: number }) => {
    const info = mineRef.current;
    if (!info) return;
    // Rounded once, so the number and the band it names always agree.
    const metres = Math.round(depthAlong(p, info, ledgeRef.current));
    if (metresRef.current) metresRef.current.textContent = String(metres);
    if (stratumRef.current) stratumRef.current.textContent = stratumFor(metres);
    /* The XP bar fills across the act you are in and empties at the next:
       the level over it is the act's number, as experience in the game is
       a level and the way to the next one. */
    const a = ACTS[actAt(p)];
    const k = Math.min(1, Math.max(0, (p - a.from) / (a.to - a.from || 1)));
    hudRef.current?.style.setProperty("--vx-xp", k.toFixed(4));
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
    /* Positioned by left/top, NOT by a transform.

       A transform promotes the button to its own compositor layer, and an
       empty transparent layer sitting over a WebGL canvas was captured as a
       solid black square -- over the very block it exists to point at. Seen
       in every browser screenshot of the working face and in none of the
       framebuffer captures, which is how it hid for so long. One absolutely
       positioned element moving per frame costs a trivial layout. */
    el.style.left = `${t.x - size / 2}px`;
    el.style.top = `${t.y - size / 2}px`;
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

  /* --- the cards ----------------------------------------------------------
     While the journey plays, each act's card is held in one place for as
     long as the act is live -- at the left over the hotbar, or docked along
     the bottom of a narrow or tall screen -- and gives way to the next with
     a short fade where the acts meet. Scrolling past the picture with the
     sections, they were cut by the top or bottom of the frame for most of
     every act and slid under the hotbar on the way out.

     Pinned only once the options are read and only with motion: before
     that, and under reduced motion, the cards stay in the sections as an
     ordinary article. */
  const pinned = opts !== null && !reduced;

  /* What each card covers of the picture, measured where the stylesheet has
     put it, for the renderer to frame each act's subject clear of its card.
     Measured rather than restated, so the cards can be restyled without the
     camera being told -- and again whenever a card or the canvas changes
     size: a font landing, the payoff opening under the working face, a
     phone turned on its side. */
  const coverRef = useRef<Cover[]>(ACTS.map(() => ({ x: 0, y: 0 })));
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const stickyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const covers = coverRef.current;
    for (const c of covers) {
      c.x = 0;
      c.y = 0;
    }
    const box = stickyRef.current;
    if (!pinned || !box) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return;
      // Which of the two places the stylesheet has the cards in.
      const docked = getComputedStyle(box).getPropertyValue("--vx-dock").trim() === "1";
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const s = getComputedStyle(el);
        covers[i].x = docked ? 0 : Math.min(1, (parseFloat(s.left) + el.offsetWidth) / b.width);
        covers[i].y = docked ? Math.min(1, (parseFloat(s.bottom) + el.offsetHeight) / b.height) : 0;
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const el of cardRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [pinned]);

  const scene = opts ? describe(opts.layers) : describe(ALL_LAYERS);
  const debug = Boolean(opts?.bench);

  /* Jumping to an act. Under reduced motion there is no scroll to move
     through, so the same control shows that act's frame instead -- which is
     why this is one handler and not two separate pieces of UI. */
  const goTo = useCallback(
    (i: number) => {
      if (reduced) {
        actRef.current = i;
        setAct(i);
        progress.current = ACTS[i].still;
        controlsRef.current?.showAt(ACTS[i].still);
        return;
      }
      /* To the moment the act is framed, not to the top of its section: the
         camera is keyed to the middle, and a jump that lands at the top
         lands on the way in. The scroll moves the camera, so the trip there
         is the journey played quickly, and the act updates as it goes. */
      const stage = stageRef.current;
      if (!stage) return;
      const top = stage.getBoundingClientRect().top + window.scrollY;
      const track = stage.offsetHeight - window.innerHeight;
      window.scrollTo({ top: top + ACTS[i].at * track, behavior: "smooth" });
    },
    [reduced],
  );

  /* Keys 1 to 8, as in the game's hotbar. Not while typing anywhere, and
     not with a modifier held -- those belong to the browser. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= ACTS.length) {
        e.preventDefault();
        goTo(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  /* One slot of the hotbar: the act's picture, its key, and -- on the ore
     slot -- the count of what has been picked up. A link to the act while
     the journey scrolls; a button showing its still when it does not. */
  const slot = (a: (typeof ACTS)[number], i: number) => {
    const live = i === act;
    const inner = (
      <>
        {icons ? (
          <img className="vx__slot-icon" src={icons.acts[i]} alt="" width={32} height={32} />
        ) : null}
        <PixelNumber className="vx__slot-key" value={i + 1} />
        {i === MINING_ACT && mine.collected > 0 ? (
          <PixelNumber className="vx__slot-count" value={mine.collected} />
        ) : null}
        <span className="vx__slot-name">{a.nav}</span>
      </>
    );
    const bag = i === MINING_ACT ? (el: HTMLElement | null) => void (bagRef.current = el) : undefined;
    return reduced ? (
      <button
        ref={bag}
        type="button"
        className={`vx__slot${live ? " is-live" : ""}`}
        aria-pressed={live}
        onClick={() => goTo(i)}
      >
        {inner}
      </button>
    ) : (
      <a
        ref={bag}
        href={`#vx-act-${a.id}`}
        className={`vx__slot${live ? " is-live" : ""}`}
        aria-current={live ? "step" : undefined}
        onClick={(e) => {
          e.preventDefault();
          goTo(i);
        }}
      >
        {inner}
      </a>
    );
  };

  /* The payoff.

     The one place in the prototype where the metaphor has to pay for itself.
     It names a real stage and a real artifact from the content layer rather
     than a slogan about digging, and it only exists once the block is
     actually open. Part of the working face's card while the journey plays,
     so it opens under the words it follows; over the picture under reduced
     motion, where the card is further down the page. */
  const payoff = (
    <aside className="vx__payoff">
      <p className="vx__payoff-kicker">{ACTS[1].kicker}</p>
      <p className="vx__payoff-body">
        Finding what is actually in the rock is the work. It is why
        Discovery ends with {ACTS[1].artifact?.toLowerCase()}, rather
        than an estimate.
      </p>
    </aside>
  );

  return (
    /* id="main" because the root layout renders a skip link pointing at it on
       every route, and this one sits outside the group that provides it. */
    <div
      className={`vx${reduced ? " is-static" : ""}${pinned ? " is-pinned" : ""}${opts?.hold != null ? " is-held" : ""}`}
      id="main"
    >
      {/* The loading screen: the world being generated, with the bar fed by
          the build itself -- each stage reports as it begins -- over the earth
          the island is made of. Outside the stage so it covers the cards and
          the hotbar too: the sticky canvas is a layer of its own, and nothing
          inside it can rise above the sections scrolling over it. */}
      {state.kind === "loading" ? (
        <div
          className="vx__loading"
          style={dirt ? { backgroundImage: `url(${dirt})` } : undefined}
        >
          <div className="vx__loading-box" role="status">
            <p className="vx__loading-title">Generating world</p>
            <div className="vx__loading-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(load.done * 100)}%` }} />
            </div>
            <p className="vx__loading-stage">{load.stage}&hellip;</p>
          </div>
        </div>
      ) : null}

      <div className="vx__stage" ref={stageRef}>
        <div className="vx__sticky" ref={stickyRef}>
          {/* Mounted before the world arrives: the field makes its context
              while the worker builds, and its scene once the world is here. */}
          {opts ? (
            <VoxelField
              key={`${opts.mode}:${opts.bench}:${scene}:${opts.aa}:${opts.dpr}`}
              className="vx__canvas"
              geometry={opts.mode}
              antialias={opts.aa}
              maxDpr={opts.dpr}
              adaptive={!opts.dprFixed}
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
              cameraAt={opts.cam}
              world={world}
              bag={bagRef}
              cover={coverRef}
            />
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

          {/* Gated on the act as well, so choosing another still does not
              leave it hanging over a sky. */}
          {mine.broken && reduced && act === MINING_ACT ? payoff : null}

          {/* Said once per stage, not per frame. The depth readout
              deliberately has no live region for the same reason: a number
              that changes sixty times a second would never stop being
              announced. */}
          <p className="u-sr-only" aria-live="polite">
            {mine.broken
              ? mine.collected > 0
                ? `The stone gives way. Gold ore collected: ${mine.collected}.`
                : "The stone gives way. Gold ore is exposed."
              : mine.stage > 0
                ? `Strike ${mine.stage} of ${mine.stages}. The rock is cracking.`
                : mine.collected > 0
                  ? `Gold ore collected: ${mine.collected}.`
                  : ""}
          </p>
        </div>

        {/* The HUD: the chapters as a hotbar along the bottom, the XP bar over
            it, and the depth of what is being shown.

            The slots are the table of contents. Real anchors while the page
            scrolls, so they work with scripting off and a keyboard user gets
            in-page navigation; buttons showing a still under reduced motion,
            where there is no journey to move along. Keys 1 to 8 do the same.
            Fixed to the bottom while the journey scrolls; under reduced
            motion, a row under the picture it controls. */}
        <nav className="vx__hud" aria-label="Chapters" ref={hudRef}>
          {/* The act's name, shown over the bar for a moment as the act
              changes, the way the game names what is in your hand. */}
          <p className="vx__toast" key={act} aria-hidden="true">
            {ACTS[act].nav}
          </p>
          <div className="vx__xp" aria-hidden="true">
            <span className="vx__xp-level">
              <PixelNumber value={act + 1} color="#ff8a5c" />
            </span>
            <span className="vx__xp-bar">
              <span className="vx__xp-fill" />
            </span>
            <span className="vx__depth">
              <span className="vx__depth-m" ref={metresRef}>
                0
              </span>
              <span className="vx__depth-unit">m</span>
              <span className="vx__depth-band" ref={stratumRef}>
                Surface
              </span>
            </span>
          </div>
          <ol className="vx__hotbar">
            {ACTS.map((a, i) => (
              <li key={a.id} className="vx__hotbar-item">
                {slot(a, i)}
              </li>
            ))}
          </ol>
        </nav>

        {/* Real sections in the normal flow, pulled back over the sticky
            canvas. They scroll by themselves -- no JavaScript positions them,
            and with styles or scripting unavailable they are simply an
            article about the scene. */}
        <div className="vx__rail">
          {ACTS.map((a, i) => (
            <section
              key={a.id}
              id={`vx-act-${a.id}`}
              className={`vx__beat${i === act ? " is-live" : ""}${i === 0 ? " vx__beat--hero" : ""}`}
              /* The one number that lays this act out AND decides where its
                 camera key lands. Set from the same field journey.ts reads. */
              style={{ "--vx-span": a.span } as React.CSSProperties}
              aria-labelledby={`vx-act-${a.id}-h`}
              /* Tabbing into an act's card that is not on screen -- the
                 contact card's link, from the opening -- travels there, as
                 its key would. The stylesheet shows the card the moment it
                 has focus, so the focus is never on something unseen. A
                 frame later: the browser scrolls whatever takes focus into
                 view after this runs, and that stopped the journey dead. */
              onFocus={() => {
                if (pinned && i !== actRef.current) requestAnimationFrame(() => goTo(i));
              }}
            >
              {i === 0 ? (
                /* The opening: the title screen. The page's one h1 -- what
                   the company does, in its own words -- the qualifier under
                   it, and two ways on: into the journey, or straight to an
                   engineer. */
                <div className="vx__hero">
                  <p className="vx__hero-kicker">{a.kicker}</p>
                  <h1 className="vx__hero-title" id={`vx-act-${a.id}-h`}>
                    {site.positioning.map((line) => (
                      <span key={line} className="vx__hero-line">
                        {line}{" "}
                      </span>
                    ))}
                  </h1>
                  <p className="vx__hero-body">{a.body}</p>
                  <div className="vx__actions">
                    <a
                      className="vx__btn vx__btn--go"
                      href={`#vx-act-${ACTS[1].id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        goTo(1);
                      }}
                    >
                      Start the journey
                    </a>
                    <a className="vx__btn" href={`mailto:${site.email}`}>
                      Talk to an engineer
                    </a>
                  </div>
                  <p className="vx__hint">
                    Scroll to begin
                    <span className="vx__hint-keys">
                      , or press <kbd>1</kbd>&ndash;<kbd>8</kbd>
                    </span>
                  </p>
                </div>
              ) : (
                /* An act, as the game draws a tooltip: a dark panel in a
                   frame, the name, the lines under it -- and the stage's
                   deliverable as the item itself. */
                <div
                  className="vx__card"
                  ref={(el) => void (cardRefs.current[i] = el)}
                >
                  {/* The kicker alone. It already carries the delivery
                      stage's own number where there is one, and printing the
                      act's position beside it gave cards reading "04 03 -
                      Build" -- two numbering systems side by side, which
                      reads as a bug. Position is the hotbar's job. */}
                  <p className="vx__kicker">{a.kicker}</p>
                  <h2 className="vx__title" id={`vx-act-${a.id}-h`}>
                    {a.title}
                  </h2>
                  <p className="vx__body">{a.body}</p>

                  {/* A list of names alone -- the capabilities -- is laid
                      out as a grid of tags rather than a column of lines. */}
                  {a.list ? (
                    <ul
                      className={`vx__list${a.list.every((item) => !item.note) ? " vx__list--tags" : ""}`}
                    >
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

                  {/* What the client is actually handed, shown as the item
                      the act gives you. Artifacts are what make a process
                      section credible; stage names alone are not, and this
                      prototype has no case studies to lean on because none
                      have been verified. */}
                  {a.artifact ? (
                    <div className="vx__item">
                      <span className="vx__item-slot" aria-hidden="true">
                        {icons ? (
                          <img src={icons.acts[i]} alt="" width={32} height={32} />
                        ) : null}
                      </span>
                      <p className="vx__item-text">
                        <span className="vx__item-label">You receive</span>
                        <span className="vx__item-name">{a.artifact}</span>
                      </p>
                    </div>
                  ) : null}

                  {i === MINING_ACT && mine.broken && !reduced ? payoff : null}

                  {a.id === "outcome" ? (
                    <div className="vx__actions">
                      <a className="vx__btn vx__btn--go" href={`mailto:${site.email}`}>
                        Talk to an engineer
                      </a>
                      <p className="vx__cta-note">{site.email}</p>
                    </div>
                  ) : null}
                </div>
              )}
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

      {/* Developer readouts: the scene's size and, with ?bench, its timing.
          Not part of the page a visitor sees. */}
      {debug ? (
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
                {bench.stations.map((st) => (
                  <span key={st.act}>
                    <i>/</i>
                    {st.act} <b>{st.msMin.toFixed(1)}</b>
                    {/* The GPU's own figure, where the browser offers timers. */}
                    {st.gpuMs != null ? <> gpu {st.gpuMs.toFixed(1)}</> : null}
                  </span>
                ))}
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
              <i>/</i>
              <b>{bench ? bench.drawCalls : "--"}</b> draws
              <i>/</i>
              <b>{stats ? stats.fps : "--"}</b> fps
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
