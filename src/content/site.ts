/* ----------------------------------------------------------------------------
   SINGLE SOURCE OF TRUTH FOR PROTOTYPE CONTENT

   Every unverified fact lives here, prefixed `PLACEHOLDER`, so it can be
   audited and swapped in one pass rather than hunted through templates.

   HARD RULE, carried from the plan: no invented clients, testimonials,
   metrics, awards, team sizes or years of experience. Where proof would
   normally sit, this prototype shows the SHAPE of the proof with the content
   visibly marked as placeholder.
-------------------------------------------------------------------------------*/

export const PLACEHOLDER = "PLACEHOLDER" as const;

export const site = {
  name: "SolutionMines",
  /** DRAFT — headline direction #1, "category-plain". The safest of the eight
   *  directions in the plan: it claims capability and nothing else, so it
   *  needs no verification. */
  positioning: [
    "We design, build and maintain",
    "the software other",
    "businesses run on.",
  ],
  qualifier:
    "For teams who need a product shipped properly, an integration that stops breaking, or a codebase someone else abandoned.",
  capabilities: [
    "Product engineering",
    "Integrations",
    "Automation",
    "Modernization",
  ],
  /** PLACEHOLDER — replace with the real monitored inbox. */
  email: "hello@solutionmines.example",
  responseCommitment: "a technical reply within one business day",
} as const;

/* --- Problem recognition ---------------------------------------------------
   These are the one content item that cannot be ghostwritten well. They must
   come from real sales conversations. Marked DRAFT until confirmed.          */

export const situations = [
  {
    quote: "Every new feature takes three times longer than it should.",
    reframe: "Accumulated architectural debt. We stabilise before we extend.",
    service: "Modernization & Ongoing Care",
  },
  {
    quote: "Our systems don't talk to each other, so someone re-keys data daily.",
    reframe: "An integration problem wearing an ops costume.",
    service: "API & Systems Integration",
  },
  {
    quote: "The developer who built it is gone and nobody understands the code.",
    reframe: "Handover without documentation. We do codebase takeovers.",
    service: "Modernization & Ongoing Care",
  },
  {
    quote: "It works, but we can't deploy without holding our breath.",
    reframe: "No safety net. We build the tests and the pipeline first.",
    service: "Product Engineering",
  },
] as const;

/* --- Services --------------------------------------------------------------
   Four headline services, consolidated from the ten candidate categories.
   Positioning is outcome-led, never a technology list.                       */

export const services = [
  {
    index: "01",
    title: "Product Engineering",
    outcome:
      "From a defined problem to a system in production — designed, built and handed over properly.",
    absorbs: ["Custom software", "Web applications", "UI/UX", "Mobile"],
    detail:
      "Discovery that produces a written technical brief and a fixed quote, architecture you can read, and a staging URL from week one.",
  },
  {
    index: "02",
    title: "API & Systems Integration",
    outcome:
      "Make your systems agree with each other, so data moves once, correctly, and nobody re-keys it at 6pm.",
    absorbs: ["API development", "Third-party integration", "Enterprise systems"],
    detail:
      "We build for partial failure: retries, idempotency keys, and an alert when a sync silently stops.",
  },
  {
    index: "03",
    title: "Automation & Data Workflows",
    outcome:
      "Software that removes work, instead of adding another system to manage.",
    absorbs: ["Workflow automation", "Data pipelines", "Reporting"],
    detail:
      "We start by measuring what the manual process actually costs, then automate the expensive part first.",
  },
  {
    index: "04",
    title: "Modernization & Ongoing Care",
    outcome:
      "Someone else built it. We'll make it safe to change — and stay to maintain it.",
    absorbs: ["Codebase takeover", "Maintenance", "Cloud & deployment"],
    detail:
      "Assessment, then a prioritised plan. We do not rewrite from scratch unless we can prove it is cheaper.",
  },
] as const;

/* --- Proof -----------------------------------------------------------------
   PLACEHOLDER SET. Structure is real; content is not. Every card below must
   be replaced with a genuine engagement before launch, and each named client
   requires recorded written consent (plan risk R8).                          */

export const work = [
  {
    kind: "Case study",
    title: "Reconciling three payment sources into one ledger",
    client: "PLACEHOLDER — client name pending written consent",
    outcome: "A six-hour weekly manual reconciliation became a scheduled job with exception alerts.",
    stack: ["Node", "PostgreSQL", "Stripe"],
    featured: true,
  },
  {
    kind: "Case study",
    title: "Rescuing an abandoned codebase for a B2B SaaS team",
    client: "PLACEHOLDER — client name pending written consent",
    outcome: "Undocumented service brought under test and safe to deploy.",
    stack: ["TypeScript", "AWS", "Terraform"],
    featured: false,
  },
  {
    kind: "Open source",
    title: "PLACEHOLDER — a utility extracted from client work",
    client: "Published openly",
    outcome: "Replace with a real repository that has genuine commits and a README.",
    stack: ["TypeScript"],
    featured: false,
  },
  {
    kind: "Teardown",
    title: "PLACEHOLDER — why we stopped using a pattern for a problem",
    client: "Engineering note",
    outcome: "Reasoning evidence. Costs nothing but time and is never blocked by an NDA.",
    stack: ["Writing"],
    featured: false,
  },
] as const;

/* --- The delivery spine — the signature interactive section ----------------
   Each stage names the ARTIFACT the client receives. Artifacts are what make
   a process section credible; stage names alone are not.                     */

export const stages = [
  {
    index: "01",
    name: "Discovery",
    body: "We do not start building until we can explain your system back to you.",
    artifact: "A written technical brief and a fixed quote",
  },
  {
    index: "02",
    name: "Architecture",
    body: "Decisions recorded with the options we rejected and what we traded away.",
    artifact: "Architecture decision records, estimated by component",
  },
  {
    index: "03",
    name: "Build",
    body: "Working software in a real environment from the first week, not the last.",
    artifact: "A staging URL you can open from week one",
  },
  {
    index: "04",
    name: "Hardening",
    body: "Tests, observability, and the alerting that tells you before your customers do.",
    artifact: "A runbook and meaningful test coverage",
  },
  {
    index: "05",
    name: "Care",
    body: "We stay. The people who built it are the people who maintain it.",
    artifact: "A monthly written report",
  },
] as const;

/* --- Trust commitments -----------------------------------------------------
   This section replaces the testimonial slot. Each commitment must be
   FALSIFIABLE — a promise that cannot be broken is not a commitment. Each
   must be confirmed as operationally honourable before it is published.      */

export const commitments = [
  {
    title: "You work with the engineers",
    body: "PLACEHOLDER — founder name and photograph. The person who scopes your project writes or reviews the code.",
  },
  {
    title: "Published rates and models",
    body: "Our engagement models and pricing method are on the site, before you ask.",
  },
  {
    title: `We reply within one business day`,
    body: "From an engineer, with a real technical observation — not a form letter.",
  },
  {
    title: "You own everything",
    body: "Code, repositories and infrastructure accounts are yours from day one. Handover terms are stated up front.",
  },
] as const;
