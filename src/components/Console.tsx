"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bootLines,
  runCommand,
  type ConsoleData,
  type Line,
  type Topology,
} from "@/lib/console/engine";

/* ----------------------------------------------------------------------------
   THE CONSOLE

   The signature element, and the one part of the page that is genuinely
   computed rather than laid out. The argument it makes is the same one the
   company makes: we build systems, so the site behaves like one.

   Three rules it has to keep, or it is a gimmick:

   1. It is never the only way to reach anything. Every slug it prints is a
      real link, and the full index is rendered as plain tables beneath it.
   2. It is not empty on arrival. The opening output is computed on the SERVER
      from the same content the rest of the site reads, so it is present in the
      HTML — including for a visitor with JS disabled, who gets a readable
      status panel rather than a dead box.
   3. It is keyboard-first by construction. Cmd/Ctrl-K focuses it from
      anywhere, the input is always visible, and the common commands are also
      buttons for anyone who would never think to type.
-------------------------------------------------------------------------------*/

export function Console({ data }: { data: ConsoleData }) {
  const initial = useMemo(() => bootLines(data), [data]);
  const [lines, setLines] = useState<Line[]>(initial);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIndex, setHistIndex] = useState(-1);

  const firstTopology = useMemo(
    () => data.work.find((w) => w.topology),
    [data.work],
  );
  const [topology, setTopology] = useState<{ node: Topology; label: string } | null>(
    firstTopology?.topology
      ? { node: firstTopology.topology, label: firstTopology.title }
      : null,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const run = useCallback(
    (raw: string) => {
      const result = runCommand(raw, data);
      if (!result.lines.length) return;
      setLines((prev) => (result.clear ? result.lines : [...prev, ...result.lines].slice(-160)));
      if (result.topology) setTopology(result.topology);
      if (raw.trim()) {
        setHistory((h) => [...h, raw.trim()].slice(-40));
        setHistIndex(-1);
      }
    },
    [data],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Only scroll the log once there is something new to see. Doing it on mount
     would yank the page to the console on load. */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  const recall = (dir: 1 | -1) => {
    if (!history.length) return;
    const next =
      histIndex === -1
        ? history.length - 1
        : Math.min(history.length - 1, Math.max(0, histIndex + dir));
    setHistIndex(next);
    setValue(history[next]);
  };

  return (
    <div className="console">
      <div className="console__chrome">
        <span className="console__dot" aria-hidden="true" />
        <span>solutionmines — index</span>
        <kbd className="console__kbd">⌘K</kbd>
      </div>

      <div
        className="console__log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Command output"
      >
        {lines.map((line, i) => (
          <pre key={`${i}-${line.text}`} className={`console__line is-${line.kind}`}>
            {line.href ? <Link href={line.href}>{line.text}</Link> : line.text}
          </pre>
        ))}
      </div>

      <form
        className="console__prompt"
        onSubmit={(e) => {
          e.preventDefault();
          run(value);
          setValue("");
        }}
      >
        <label htmlFor="console-input" className="console__caret">
          <span className="u-sr-only">Run a command. Try: services</span>
          <span aria-hidden="true">&gt;</span>
        </label>
        <input
          id="console-input"
          ref={inputRef}
          className="console__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              recall(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              recall(1);
            }
          }}
          placeholder="try `services`"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </form>

      <div className="console__quick">
        {["services", "work", "stack", "process", "contact"].map((c) => (
          <button
            key={c}
            type="button"
            className="console__quick-btn"
            onClick={() => {
              run(c);
              inputRef.current?.focus();
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {topology && <TopologyFigure node={topology.node} label={topology.label} />}
    </div>
  );
}

/* The diagram redraws from whatever `open <slug>` last selected. Plain SVG,
   with the same relationship stated in the accessible name — the information
   is never locked inside the picture. */
function TopologyFigure({ node, label }: { node: Topology; label: string }) {
  const H = 170;
  const at = (i: number, n: number) => (H / (n + 1)) * (i + 1);

  return (
    <figure className="console__topo">
      <figcaption>
        topology — <strong>{label}</strong>
      </figcaption>
      <div className="console__topo-scroll">
        <svg
          viewBox={`0 0 520 ${H}`}
          role="img"
          aria-label={`Data flows from ${node.sources.join(", ")} into ${node.core}, and out to ${node.outputs.join(", ")}.`}
        >
          {node.sources.map((s, i) => {
            const y = at(i, node.sources.length);
            return (
              <g key={s}>
                <path className="console__wire" d={`M 148 ${y} C 190 ${y}, 200 ${H / 2}, 218 ${H / 2}`} />
                <rect className="console__box" x="8" y={y - 15} width="140" height="30" rx="2" />
                <text className="console__boxlabel" x="78" y={y + 4} textAnchor="middle">{s}</text>
              </g>
            );
          })}

          <rect className="console__box console__box--core" x="218" y={H / 2 - 24} width="92" height="48" rx="2" />
          <text className="console__boxlabel console__boxlabel--core" x="264" y={H / 2 + 4} textAnchor="middle">
            {node.core}
          </text>

          {node.outputs.map((o, i) => {
            const y = at(i, node.outputs.length);
            return (
              <g key={o}>
                <path className="console__wire" d={`M 310 ${H / 2} C 330 ${H / 2}, 340 ${y}, 372 ${y}`} />
                <rect className="console__box" x="372" y={y - 15} width="140" height="30" rx="2" />
                <text className="console__boxlabel" x="442" y={y + 4} textAnchor="middle">{o}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
