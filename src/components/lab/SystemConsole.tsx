"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SysNode = { sources: string[]; core: string; outputs: string[] };

export type SysService = {
  slug: string;
  title: string;
  summary: string;
  outcomes: string[];
  tech: string[];
  duration: string;
  model: string;
};

export type SysWork = {
  slug: string;
  title: string;
  summary: string;
  client: string;
  tech: string[];
  metrics: { label: string; value: string }[];
  diagram?: SysNode;
};

type Line = { kind: "cmd" | "out" | "dim" | "key" | "err"; text: string };

const HELP: Line[] = [
  { kind: "dim", text: "COMMANDS" },
  { kind: "out", text: "  services            list what we do" },
  { kind: "out", text: "  work                list shipped engagements" },
  { kind: "out", text: "  open <slug>         inspect one of either" },
  { kind: "out", text: "  stack               every technology in use, by count" },
  { kind: "out", text: "  contact             how to start" },
  { kind: "out", text: "  clear               reset this log" },
];

export function SystemConsole({
  services,
  work,
}: {
  services: SysService[];
  work: SysWork[];
}) {
  const defaultTopology = useMemo<SysNode>(
    () =>
      work.find((w) => w.diagram)?.diagram ?? {
        sources: ["Client systems"],
        core: "Integration layer",
        outputs: ["Reporting"],
      },
    [work],
  );

  /* Booted with real output rather than an empty pane. A console that greets
     you with a blank rectangle reads as broken; one that has already answered
     a question tells you what kind of answers it gives. */
  const [lines, setLines] = useState<Line[]>(() => [
    { kind: "dim", text: "solutionmines // system v0.4" },
    { kind: "cmd", text: "> status" },
    { kind: "out", text: `  services      ${services.length}` },
    { kind: "out", text: `  engagements   ${work.length}` },
    { kind: "out", text: "  reply         < 1 business day, from an engineer" },
    { kind: "out", text: "  owner         you — code, repos and accounts, day one" },
    { kind: "dim", text: "" },
    ...HELP,
    { kind: "dim", text: "" },
  ]);
  const [topology, setTopology] = useState<SysNode>(defaultTopology);
  const [topoLabel, setTopoLabel] = useState("default topology");
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((next: Line[]) => {
    setLines((prev) => [...prev, ...next].slice(-120));
  }, []);

  const run = useCallback(
    (raw: string) => {
      const input = raw.trim();
      if (!input) return;
      push([{ kind: "cmd", text: `> ${input}` }]);

      const [cmd, ...rest] = input.toLowerCase().split(/\s+/);
      const arg = rest.join(" ");

      if (cmd === "help") return push(HELP);

      if (cmd === "clear") {
        setLines([{ kind: "dim", text: "log cleared" }]);
        return;
      }

      if (cmd === "services" || (cmd === "ls" && arg === "services")) {
        return push([
          { kind: "dim", text: `${services.length} services` },
          ...services.map<Line>((s) => ({
            kind: "key",
            text: `  ${s.slug.padEnd(22)} ${s.title}`,
          })),
          { kind: "dim", text: "  → open <slug> for detail" },
        ]);
      }

      if (cmd === "work" || (cmd === "ls" && arg === "work")) {
        return push([
          { kind: "dim", text: `${work.length} engagements` },
          ...work.map<Line>((w) => ({
            kind: "key",
            text: `  ${w.slug.padEnd(22)} ${w.title}`,
          })),
        ]);
      }

      if (cmd === "stack") {
        const counts = new Map<string, number>();
        for (const s of services)
          for (const t of s.tech) counts.set(t, (counts.get(t) ?? 0) + 1);
        for (const w of work)
          for (const t of w.tech) counts.set(t, (counts.get(t) ?? 0) + 1);
        const sorted = [...counts.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        );
        return push([
          { kind: "dim", text: `${sorted.length} technologies, by appearances` },
          ...sorted.map<Line>(([name, n]) => ({
            kind: "out",
            /* ASCII only. Geist Mono has no U+2588 FULL BLOCK, so a block
               bar renders as tofu — which is how it looked the first time. */
            text: `  ${"#".repeat(Math.min(n, 12)).padEnd(12)} ${String(n).padStart(2)}  ${name}`,
          })),
        ]);
      }

      if (cmd === "contact") {
        return push([
          { kind: "out", text: "  Send a brief — five minutes is enough." },
          { kind: "out", text: "  A technical reply within one business day." },
          { kind: "out", text: "  A 30-minute call. Free, no deck." },
          { kind: "key", text: "  → /contact" },
        ]);
      }

      if (cmd === "open") {
        const svc = services.find((s) => s.slug === arg);
        if (svc) {
          return push([
            { kind: "key", text: `  ${svc.title}` },
            { kind: "out", text: `  ${svc.summary}` },
            { kind: "dim", text: "  OUTCOMES" },
            ...svc.outcomes.map<Line>((o) => ({ kind: "out", text: `  · ${o}` })),
            {
              kind: "dim",
              text: `  ENGAGEMENT  ${svc.duration} · ${svc.model}`,
            },
            { kind: "dim", text: `  STACK       ${svc.tech.join(", ")}` },
            { kind: "key", text: `  → /services/${svc.slug}` },
          ]);
        }

        const item = work.find((w) => w.slug === arg);
        if (item) {
          if (item.diagram) {
            setTopology(item.diagram);
            setTopoLabel(item.title);
          }
          return push([
            { kind: "key", text: `  ${item.title}` },
            { kind: "dim", text: `  CLIENT      ${item.client}` },
            { kind: "out", text: `  ${item.summary}` },
            ...item.metrics.map<Line>((m) => ({
              kind: "out",
              text: `  ${m.value.padEnd(14)} ${m.label}`,
            })),
            { kind: "dim", text: `  STACK       ${item.tech.join(", ")}` },
            ...(item.diagram
              ? [{ kind: "dim" as const, text: "  topology redrawn →" }]
              : []),
            { kind: "key", text: `  → /work/${item.slug}` },
          ]);
        }

        return push([
          { kind: "err", text: `  no such entry: ${arg || "(nothing given)"}` },
          { kind: "dim", text: "  try `services` or `work`" },
        ]);
      }

      push([
        { kind: "err", text: `  unknown command: ${cmd}` },
        { kind: "dim", text: "  try `help`" },
      ]);
    },
    [push, services, work],
  );

  /* ⌘K / Ctrl-K focuses the console from anywhere on the page. The input is
     always visible as well — a palette that can ONLY be opened by a shortcut
     is a feature most visitors never discover. */
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

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines]);

  return (
    <div className="sys-console">
      <div className="sys-console__chrome">
        <span className="sys-dot" aria-hidden="true" />
        <span>solutionmines — system</span>
        <kbd className="sys-kbd">⌘K</kbd>
      </div>

      <div
        className="sys-console__log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Command output"
      >
        {lines.map((line, i) => (
          <pre key={`${i}-${line.text}`} className={`sys-line sys-line--${line.kind}`}>
            {line.text}
          </pre>
        ))}
      </div>

      <form
        className="sys-console__prompt"
        onSubmit={(e) => {
          e.preventDefault();
          run(value);
          setValue("");
        }}
      >
        <label htmlFor="sys-input" className="sys-console__caret">
          <span className="u-sr-only">Run a command</span>
          <span aria-hidden="true">&gt;</span>
        </label>
        <input
          id="sys-input"
          ref={inputRef}
          className="sys-console__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="help"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
        />
      </form>

      <div className="sys-console__quick">
        {["help", "services", "work", "stack", "contact"].map((c) => (
          <button
            key={c}
            type="button"
            className="sys-quick"
            onClick={() => {
              run(c);
              inputRef.current?.focus();
            }}
          >
            {c}
          </button>
        ))}
      </div>

      <Topology node={topology} label={topoLabel} />
    </div>
  );
}

/* --- the live diagram ------------------------------------------------------
   Redrawn from whatever `open <slug>` last selected. Plain SVG with a text
   description underneath, so the information is never locked in the picture. */

function Topology({ node, label }: { node: SysNode; label: string }) {
  const H = 170;
  const srcY = (i: number, n: number) => (H / (n + 1)) * (i + 1);
  const outY = (i: number, n: number) => (H / (n + 1)) * (i + 1);

  return (
    <figure className="sys-topo">
      <figcaption className="sys-topo__cap">
        topology — <strong>{label}</strong>
      </figcaption>
      <div className="sys-topo__scroll">
      <svg viewBox={`0 0 520 ${H}`} role="img" aria-label={`Data flows from ${node.sources.join(", ")} into ${node.core}, and out to ${node.outputs.join(", ")}.`}>
        {node.sources.map((s, i) => {
          const y = srcY(i, node.sources.length);
          return (
            <g key={s}>
              <path
                className="sys-topo__wire"
                d={`M 148 ${y} C 190 ${y}, 200 ${H / 2}, 218 ${H / 2}`}
              />
              <rect className="sys-topo__box" x="8" y={y - 15} width="140" height="30" rx="3" />
              <text className="sys-topo__label" x="78" y={y + 4} textAnchor="middle">
                {s}
              </text>
            </g>
          );
        })}

        <rect
          className="sys-topo__box sys-topo__box--core"
          x="218"
          y={H / 2 - 24}
          width="92"
          height="48"
          rx="3"
        />
        <text className="sys-topo__label sys-topo__label--core" x="264" y={H / 2 + 4} textAnchor="middle">
          {node.core}
        </text>

        {node.outputs.map((o, i) => {
          const y = outY(i, node.outputs.length);
          return (
            <g key={o}>
              <path
                className="sys-topo__wire"
                d={`M 310 ${H / 2} C 330 ${H / 2}, 340 ${y}, 372 ${y}`}
              />
              <rect className="sys-topo__box" x="372" y={y - 15} width="140" height="30" rx="3" />
              <text className="sys-topo__label" x="442" y={y + 4} textAnchor="middle">
                {o}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </figure>
  );
}
