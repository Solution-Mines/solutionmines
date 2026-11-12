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

/* --- The services, in the words people search with ---------------------------
   Each named the way it is searched for, and described by what it covers --
   shown in the reading after the island, where the journey has told how the
   work runs in its own voice. The first two are the work as the founder
   describes it (2026-11-02): websites for brands, with an admin portal when
   one is needed. The rest stay general on purpose -- no named products,
   platforms or industries -- and promise nothing this file does not
   already: the same engineers build and maintain (stages, Care), the
   integration that stops breaking (the qualifier), the data someone re-keys
   (situations), takeovers made safe to change with tests and a pipeline
   first (situations), the alerting (stages, Hardening). DRAFT until
   approved.                                                                  */

export const services = [
  {
    name: "Website development",
    tag: "Websites",
    body: "Websites for brands and businesses, launched and then maintained by us — with an admin portal when you want to run the site yourself.",
  },
  {
    name: "Admin portals and dashboards",
    tag: "Admin portals",
    body: "The part of a website only your team sees: an admin panel where you sign in to update the content and manage the data behind the site, without waiting on a developer for every change.",
  },
  {
    name: "Custom software development",
    tag: "Custom software",
    body: "Software built around how your business works, not the other way round — designed, built and maintained by the same engineers.",
  },
  {
    name: "API and systems integration",
    tag: "Integrations",
    body: "We connect the tools your business already uses through their APIs, so data moves between them on its own instead of being re-keyed by hand — and build each integration so it stops breaking.",
  },
  {
    name: "Workflow automation",
    tag: "Automation",
    body: "We take the manual, repetitive steps out of your business processes and let software do them, with the alerting that tells you when something fails.",
  },
  {
    name: "Legacy software modernization",
    tag: "Modernization",
    body: "For systems where every new feature takes three times longer than it should, or the developer has gone and nobody understands the code. We take over the codebase, documentation or not, make it safe to change with tests and a deployment pipeline, then modernize it.",
  },
] as const;

/* --- Other software solutions, as tags -------------------------------------
   The wider kinds of work, named the way they are searched for and shown as
   tags under the services. Each rests on something already here: the admin
   portals are web applications and portals; maintenance is Care;
   architecture, tests, pipelines and alerting are the stages; takeovers are
   the situations. Nothing narrower -- no products, platforms or industries
   -- until there is work to point to. DRAFT until approved.                  */

export const solutions = [
  "Web application development",
  "Web portal development",
  "Website maintenance",
  "Software maintenance and support",
  "Software architecture",
  "Automated testing and CI/CD",
  "Monitoring and alerting",
  "Codebase takeovers",
] as const;

export const site = {
  name: "SolutionMines",
  /** The label over the opening headline: what the company is, in the words
   *  people search for it with. The name there only repeated the island's
   *  block-letter title above it. */
  category: "Website & software development",
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
  /** The services' short names, in order: the journey shows them as tags on
   *  a card that has to fit a small phone, and six full names did not. The
   *  full names are the headings in the reading after the island. */
  capabilities: services.map((s) => s.tag),
  email: "hello@solutionmines.com",
  responseCommitment: "a technical reply within one business day",
} as const;

/* --- Problem recognition ---------------------------------------------------
   These are the one content item that cannot be ghostwritten well. They must
   come from real sales conversations. Marked DRAFT until confirmed.          */

export const situations = [
  {
    quote: "Every new feature takes three times longer than it should.",
    reframe: "Accumulated architectural debt. We stabilise before we extend.",
    service: "Modernization",
    href: "/services/modernization",
  },
  {
    quote: "Our systems don't talk to each other, so someone re-keys data daily.",
    reframe: "An integration problem wearing an ops costume.",
    service: "Integrations",
    href: "/services/integrations",
  },
  {
    quote: "The developer who built it is gone and nobody understands the code.",
    reframe: "Handover without documentation. We do codebase takeovers.",
    service: "Modernization",
    href: "/services/modernization",
  },
  {
    quote: "It works, but we can't deploy without holding our breath.",
    reframe: "No safety net. We build the tests and the pipeline first.",
    service: "Product engineering",
    href: "/services/product-engineering",
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
    /* Held back since the site became the one page: the pages that set the
       rates and models out went with it, so "on the site" stopped being
       true. Take the PLACEHOLDER prefix off once they are published again. */
    body: "PLACEHOLDER — not on the site yet. Our engagement models and pricing method are on the site, before you ask.",
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

/* --- Questions -------------------------------------------------------------
   What a buyer asks before writing, in the words they search with. Every
   answer restates something already confirmed above -- where it comes from
   is noted beside it -- so none of them is a new promise. The last is
   general advice rather than a claim about us. DRAFT until approved.        */

export const questions = [
  {
    // services: the founder's own description of the work (2026-11-02).
    q: "Can you build a website with an admin panel?",
    a: "Yes. Alongside the website we build the admin panel behind it, so your team can sign in and update the site's content and data without waiting on a developer.",
  },
  {
    // situations: the takeover, stabilise-first and tests-first reframes.
    q: "Can you take over a codebase another developer built?",
    a: "Yes, including code with no documentation and no original developer to ask. We make it safe to change before we change it: the tests and the deployment pipeline come first, new work after.",
  },
  {
    // stages: Discovery's brief and fixed quote; the payoff's "rather than an estimate".
    q: "How much does a website or custom software project cost?",
    a: "It depends on what it has to do, so it is quoted, not guessed: discovery ends with a written technical brief and a fixed quote, before any building starts.",
  },
  {
    // stages: Build, and the staging URL.
    q: "When will we see working software?",
    a: "In the first week. We build in a real environment from the start, and you get a staging URL you can open from week one, not a demo at the end.",
  },
  {
    // commitments: "You own everything".
    q: "Who owns the code?",
    a: "You do. Code, repositories and infrastructure accounts are yours from day one, and the handover terms are stated up front.",
  },
  {
    // stages: Care, and the monthly report.
    q: "Do you maintain the software after launch?",
    a: "Yes. Maintenance and support come from the people who built it, with a written report every month.",
  },
  {
    // situations: "can't deploy without holding our breath"; stages: Hardening.
    q: "Every deployment feels risky. Can you fix that?",
    a: "Yes. That is a missing safety net, so we build it first: automated tests and a CI/CD pipeline, then the monitoring and alerting that tell you about a problem before your customers do.",
  },
  {
    q: "Should we build custom software or buy an off-the-shelf product?",
    a: "Buy when a product already fits the way you work. Build when you are bending your process around a tool, paying people to work around its gaps, or need systems to work together in a way no product offers.",
  },
] as const;
