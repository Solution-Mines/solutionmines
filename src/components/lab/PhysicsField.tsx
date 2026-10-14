"use client";

import { useEffect, useRef, useState } from "react";

export type Chip = { label: string; weight: "heavy" | "light" };

/* ----------------------------------------------------------------------------
   A rigid-body solver driving REAL DOM NODES.

   The usual way to do this is to let Matter render to a canvas, which gives you
   physics and loses everything else: no selectable text, no real font, nothing
   for a screen reader, nothing without JS. So the solver runs headless and each
   frame writes a transform onto an ordinary <li>.

   The cost of that choice is one transform write per body per frame, which at
   ~20 bodies is nothing. The benefit is that with JS disabled, or motion
   reduced, this section is a plain wrapped list of words — which is what it
   actually is.
-------------------------------------------------------------------------------*/

export function PhysicsField({ chips }: { chips: Chip[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [live, setLive] = useState(false);
  const resetRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    const list = listRef.current;
    if (!host || !list) return;

    const reduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduced";
    if (reduced) return;

    let disposed = false;
    // Holds the teardown for whatever the async setup managed to create.
    let cleanup = () => {};

    (async () => {
      const Matter = (await import("matter-js")).default;
      if (disposed) return;

      const items = Array.from(
        list.querySelectorAll<HTMLLIElement>(".phys-chip"),
      );
      // Measure while the chips are still in normal flow, with real fonts
      // applied — measuring after they go absolute gives zero-width boxes.
      const sizes = items.map((el) => ({
        w: el.offsetWidth,
        h: el.offsetHeight,
      }));

      const engine = Matter.Engine.create({
        gravity: { x: 0, y: 1, scale: 0.0014 },
      });
      const world = engine.world;

      let W = host.clientWidth;
      let H = host.clientHeight;

      const WALL = 400; // thick walls: thin ones let fast bodies tunnel through
      const walls = [
        Matter.Bodies.rectangle(W / 2, H + WALL / 2, W * 3, WALL, {
          isStatic: true,
        }),
        Matter.Bodies.rectangle(-WALL / 2, H / 2, WALL, H * 4, {
          isStatic: true,
        }),
        Matter.Bodies.rectangle(W + WALL / 2, H / 2, WALL, H * 4, {
          isStatic: true,
        }),
      ];
      Matter.Composite.add(world, walls);

      const bodies = items.map((el, i) => {
        const { w, h } = sizes[i];
        const heavy = el.dataset.weight === "heavy";
        const body = Matter.Bodies.rectangle(
          40 + Math.random() * Math.max(W - 80, 1),
          // Drop in from above the frame, spread out so they do not interlock.
          -80 - i * 72 - Math.random() * 40,
          w,
          h,
          {
            chamfer: { radius: Math.min(h / 2, 14) },
            restitution: heavy ? 0.12 : 0.42,
            friction: 0.32,
            frictionAir: 0.012,
            density: heavy ? 0.0024 : 0.0009,
          },
        );
        Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.08);
        el.style.position = "absolute";
        el.style.top = "0";
        el.style.left = "0";
        el.style.willChange = "transform";
        return body;
      });
      Matter.Composite.add(world, bodies);

      /* Dragging is pointer-only. Matter's mouse handler calls preventDefault
         on touchmove, which would stop the page scrolling on a phone — a far
         worse outcome than losing the toy. */
      const fine = window.matchMedia("(pointer: fine)").matches;
      let mouseConstraint: Matter.MouseConstraint | null = null;
      if (fine) {
        const mouse = Matter.Mouse.create(host);
        mouseConstraint = Matter.MouseConstraint.create(engine, {
          mouse,
          constraint: { stiffness: 0.18, render: { visible: false } },
        });
        Matter.Composite.add(world, mouseConstraint);
      }

      const runner = Matter.Runner.create();
      Matter.Runner.run(runner, engine);

      let raf = 0;
      const sync = () => {
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          const { w, h } = sizes[i];
          items[i].style.transform =
            `translate(${b.position.x - w / 2}px, ${b.position.y - h / 2}px) rotate(${b.angle}rad)`;
        }
        raf = requestAnimationFrame(sync);
      };
      raf = requestAnimationFrame(sync);

      const reset = () => {
        bodies.forEach((b, i) => {
          Matter.Body.setPosition(b, {
            x: 40 + Math.random() * Math.max(host.clientWidth - 80, 1),
            y: -80 - i * 72,
          });
          Matter.Body.setVelocity(b, { x: 0, y: 0 });
          Matter.Body.setAngle(b, 0);
          Matter.Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.08);
        });
      };
      resetRef.current = reset;

      /* Pause the solver when it is off-screen. A physics engine ticking
         behind the fold is the same waste as an off-screen shader. */
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) Matter.Runner.run(runner, engine);
          else Matter.Runner.stop(runner);
        },
        { threshold: 0 },
      );
      io.observe(host);

      let resizeTimer = 0;
      const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(() => {
          const nw = host.clientWidth;
          const nh = host.clientHeight;
          if (nw === W && nh === H) return;
          W = nw;
          H = nh;
          Matter.Body.setPosition(walls[0], { x: W / 2, y: H + WALL / 2 });
          Matter.Body.setPosition(walls[1], { x: -WALL / 2, y: H / 2 });
          Matter.Body.setPosition(walls[2], { x: W + WALL / 2, y: H / 2 });
          // Anything the resize left outside the frame gets dropped back in.
          bodies.forEach((b) => {
            if (b.position.x > W || b.position.y > H) {
              Matter.Body.setPosition(b, { x: W / 2, y: -60 });
              Matter.Body.setVelocity(b, { x: 0, y: 0 });
            }
          });
        }, 160);
      });
      ro.observe(host);

      setLive(true);

      cleanup = () => {
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        io.disconnect();
        ro.disconnect();
        Matter.Runner.stop(runner);
        if (mouseConstraint) Matter.Composite.remove(world, mouseConstraint);
        Matter.Composite.clear(world, false);
        Matter.Engine.clear(engine);
        items.forEach((el) => {
          el.removeAttribute("style");
        });
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`phys-field${live ? " is-live" : ""}`}
      // The solver is decorative motion over a list that is already complete.
      aria-describedby={live ? "phys-note" : undefined}
    >
      <ul ref={listRef} className="phys-chips">
        {chips.map((chip) => (
          <li
            key={chip.label}
            className="phys-chip"
            data-weight={chip.weight}
          >
            {chip.label}
          </li>
        ))}
      </ul>

      {live && (
        <>
          <p id="phys-note" className="u-sr-only">
            The items above are shown as draggable physical objects. The list is
            complete and readable without interacting with them.
          </p>
          <button
            type="button"
            className="phys-reset"
            onClick={() => resetRef.current()}
          >
            Drop again
          </button>
        </>
      )}
    </div>
  );
}
