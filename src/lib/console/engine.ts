/* ----------------------------------------------------------------------------
   THE CONSOLE — query engine

   Pure functions over plain data, deliberately separated from the component
   that renders them. Three reasons it lives here rather than inside the
   component:

   1. The same engine drives the production console and the /lab prototype, so
      the two cannot drift.
   2. It is trivially testable without a DOM.
   3. Keeping it serialisable-in / serialisable-out is what lets the server
      pre-render the opening output, so the console is not an empty box for
      visitors with JS disabled.

   It reads ONLY from data handed to it. It never touches the content registry
   directly — the seam in src/lib/content stays the single way content is read.
-------------------------------------------------------------------------------*/

export type Topology = { sources: string[]; core: string; outputs: string[] };

export type ConsoleService = {
  slug: string;
  title: string;
  summary: string;
  outcomes: string[];
  tech: string[];
  duration: string;
  model: string;
};

export type ConsoleWork = {
  slug: string;
  title: string;
  summary: string;
  client: string;
  tech: string[];
  metrics: { label: string; value: string }[];
  topology?: Topology;
};

export type ConsoleData = {
  services: ConsoleService[];
  work: ConsoleWork[];
};

/** `key` lines carry a destination; the renderer turns them into real links. */
export type Line = {
  kind: "cmd" | "out" | "dim" | "key" | "err";
  text: string;
  href?: string;
};

export type Result = {
  lines: Line[];
  /** Set when a command changed what the diagram should show. */
  topology?: { node: Topology; label: string };
  clear?: boolean;
};

export const COMMANDS = [
  ["help", "list these commands"],
  ["services", "what we do"],
  ["work", "engagements we can show"],
  ["open <slug>", "inspect either, in full"],
  ["stack", "every technology in use, by count"],
  ["process", "the five stages and their artefacts"],
  ["contact", "how to start"],
  ["clear", "reset this log"],
] as const;

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

function help(): Line[] {
  return [
    { kind: "dim", text: "COMMANDS" },
    ...COMMANDS.map<Line>(([name, desc]) => ({
      kind: "out",
      text: `  ${pad(name, 14)}${desc}`,
    })),
  ];
}

/** The output the server renders before any JS runs. */
export function bootLines(data: ConsoleData): Line[] {
  return [
    { kind: "dim", text: "solutionmines // index" },
    { kind: "cmd", text: "> status" },
    { kind: "out", text: `  ${pad("services", 14)}${data.services.length}` },
    { kind: "out", text: `  ${pad("engagements", 14)}${data.work.length}` },
    { kind: "out", text: `  ${pad("reply", 14)}< 1 business day, from an engineer` },
    { kind: "out", text: `  ${pad("ownership", 14)}yours — code, repos, accounts, day one` },
    { kind: "dim", text: "" },
    ...help(),
  ];
}

export function runCommand(input: string, data: ConsoleData): Result {
  const trimmed = input.trim();
  if (!trimmed) return { lines: [] };

  const echo: Line = { kind: "cmd", text: `> ${trimmed}` };
  const [verb, ...rest] = trimmed.toLowerCase().split(/\s+/);
  const arg = rest.join(" ");
  const out = (lines: Line[], extra: Partial<Result> = {}): Result => ({
    lines: [echo, ...lines],
    ...extra,
  });

  if (verb === "help") return out(help());
  if (verb === "clear") return { lines: [{ kind: "dim", text: "log cleared" }], clear: true };

  if (verb === "services" || (verb === "ls" && arg === "services")) {
    return out([
      { kind: "dim", text: `${data.services.length} services` },
      ...data.services.map<Line>((s) => ({
        kind: "key",
        text: `  ${pad(s.slug, 22)}${s.title}`,
        href: `/services/${s.slug}`,
      })),
      { kind: "dim", text: "  open <slug> for outcomes, stack and engagement shape" },
    ]);
  }

  if (verb === "work" || (verb === "ls" && arg === "work")) {
    return out([
      { kind: "dim", text: `${data.work.length} engagements` },
      ...data.work.map<Line>((w) => ({
        kind: "key",
        text: `  ${pad(w.slug, 22)}${w.title}`,
        href: `/work/${w.slug}`,
      })),
    ]);
  }

  if (verb === "stack") {
    const counts = new Map<string, number>();
    for (const s of data.services) for (const t of s.tech) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const w of data.work) for (const t of w.tech) counts.set(t, (counts.get(t) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return out([
      { kind: "dim", text: `${sorted.length} technologies, by appearances` },
      ...sorted.map<Line>(([name, n]) => ({
        kind: "out",
        // ASCII only: Geist Mono has no U+2588 FULL BLOCK, so a block bar
        // renders as tofu.
        text: `  ${pad("#".repeat(Math.min(n, 12)), 13)}${String(n).padStart(2)}  ${name}`,
      })),
    ]);
  }

  if (verb === "process") {
    return out([
      { kind: "dim", text: "five stages — and what you hold at the end of each" },
      ...PROCESS.map<Line>((p) => ({
        kind: "out",
        text: `  ${p.index}  ${pad(p.name, 14)}${p.artifact}`,
      })),
      { kind: "key", text: "  → /how-we-work", href: "/how-we-work" },
    ]);
  }

  if (verb === "contact") {
    return out([
      { kind: "out", text: "  Send a brief. Five minutes is enough." },
      { kind: "out", text: "  A technical reply within one business day, from an engineer." },
      { kind: "out", text: "  Then a 30-minute call. Free, and there is no deck." },
      { kind: "key", text: "  → /contact", href: "/contact" },
    ]);
  }

  if (verb === "open") {
    const svc = data.services.find((s) => s.slug === arg);
    if (svc) {
      return out([
        { kind: "key", text: `  ${svc.title}`, href: `/services/${svc.slug}` },
        { kind: "out", text: `  ${svc.summary}` },
        { kind: "dim", text: "  OUTCOMES" },
        ...svc.outcomes.map<Line>((o) => ({ kind: "out", text: `  · ${o}` })),
        { kind: "dim", text: `  ENGAGEMENT    ${svc.duration} · ${svc.model}` },
        { kind: "dim", text: `  STACK         ${svc.tech.join(", ")}` },
        { kind: "key", text: `  → /services/${svc.slug}`, href: `/services/${svc.slug}` },
      ]);
    }

    const item = data.work.find((w) => w.slug === arg);
    if (item) {
      return out(
        [
          { kind: "key", text: `  ${item.title}`, href: `/work/${item.slug}` },
          { kind: "dim", text: `  CLIENT        ${item.client}` },
          { kind: "out", text: `  ${item.summary}` },
          ...item.metrics.map<Line>((m) => ({
            kind: "out",
            text: `  ${pad(m.value, 16)}${m.label}`,
          })),
          { kind: "dim", text: `  STACK         ${item.tech.join(", ")}` },
          ...(item.topology ? [{ kind: "dim" as const, text: "  topology redrawn →" }] : []),
          { kind: "key", text: `  → /work/${item.slug}`, href: `/work/${item.slug}` },
        ],
        item.topology ? { topology: { node: item.topology, label: item.title } } : {},
      );
    }

    return out([
      { kind: "err", text: `  no such entry: ${arg || "(nothing given)"}` },
      { kind: "dim", text: "  try `services` or `work` for the slugs" },
    ]);
  }

  return out([
    { kind: "err", text: `  unknown command: ${verb}` },
    { kind: "dim", text: "  try `help`" },
  ]);
}

/* Mirrored from src/content/site.ts rather than imported, because that module
   is prose-shaped and this needs the two fields the console prints. If the
   stages change, they change in both — a deliberate four-line duplication in
   exchange for keeping the engine free of content imports. */
const PROCESS = [
  { index: "01", name: "Discovery", artifact: "A written technical brief and a fixed quote" },
  { index: "02", name: "Architecture", artifact: "Decision records, estimated by component" },
  { index: "03", name: "Build", artifact: "A staging URL you can open from week one" },
  { index: "04", name: "Hardening", artifact: "A runbook and meaningful test coverage" },
  { index: "05", name: "Care", artifact: "A monthly written report" },
] as const;
