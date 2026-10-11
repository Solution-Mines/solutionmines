# SolutionMines — Phase 1 Marketing Site

The public marketing site: full routes, a validated content layer, and a
working enquiry form.

Email delivery is wired and tested. **Content is still placeholder** — see
*Before launch* at the foot of this file.

---

## Run it

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:3000**

To check it the way a visitor would get it (minified, static-prerendered):

```bash
pnpm build && pnpm start
```

To run it the way **production** does — a self-contained tree that needs no
`node_modules`:

```bash
pnpm build && pnpm package && pnpm start:standalone
```

(`next start` warns under `output: "standalone"`; it works for local review,
but `start:standalone` is the real path. `pnpm package` copies static assets
into the bundle, which `next build` deliberately does not do.)

Other scripts: `pnpm typecheck` (`tsc --noEmit`).

### Email

With no mail variables set, enquiries are logged to stdout and the server
warns at boot — fine for local work. To exercise real delivery, copy
`.env.example` and fill in the SMTP block. See
[docs/02-email-deliverability.md](docs/02-email-deliverability.md) for the DNS
records the domain needs.

> Requires Node 22.12+. If you use npm or yarn instead of pnpm, delete
> `pnpm-lock.yaml` first — the lockfile is pnpm's.

---

## Routes

| Route | Notes |
|---|---|
| `/` | The narrative homepage |
| `/services` | Capability index + an explicit "what we do not do" |
| `/services/[slug]` | 4 pages, generated from MDX |
| `/work` | Mixed-type proof index |
| `/work/[slug]` | 3 pages, generated from MDX |
| `/how-we-work` | Process, engagement models, ownership and exit terms |
| `/about` | Positions rather than values |
| `/contact` | Working form with a Server Action |
| `/contact/received` | Conversion endpoint, `noindex` |
| `/privacy`, `/terms` | Structured placeholders for counsel |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | Generated |
| 404 | Designed, with routes out |

## What to look at

| | Where |
|---|---|
| Hero reveal choreography | Homepage, on load |
| **The Trace** (signature element) | Left margin, desktop ≥1024px. It draws as you scroll. |
| **The Delivery Spine** (signature interactive section) | Homepage section 04 — the page pins and travels sideways |
| Services hover wash | `/services`, or homepage section 03 |
| Case study structure | `/work/payment-reconciliation` — note "The decisions" |
| Form validation and spam defences | `/contact` |
| **Reduced motion** | "MOTION ON/OFF" control, bottom right (or set it at OS level) |
| Mobile navigation | Below 768px — "Menu" |

---

## The design direction

**"Specification"** — editorial and typography-led, set on warm paper, with
deliberate near-black interludes.

The reasoning, in short: dark-plus-glow is the default aesthetic of every
software agency, so competing there means out-polishing hundreds of rivals on
their own ground. An editorial, typographically rigorous site stands out
immediately — and "we are more precise than the others" is the brand claim
anyway. It is also fast and accessible by construction rather than by effort,
and editorial layouts make a small body of work read as a considered
portfolio, which matters for a new firm.

The dark sections are art direction, not a theme toggle: they set
`data-surface="dark"`, which reassigns only the semantic colour tokens. No
component knows which surface it is sitting on.

| | |
|---|---|
| Display | Instrument Serif (OFL-1.1) |
| Text / UI | Geist Variable (OFL-1.1) |
| Technical accents | Geist Mono Variable (OFL-1.1) |
| Paper | `#faf9f6` · ink `#141511` (17.42:1) |
| Dark interlude | `#12110f` · text `#f7f5f0` (17.32:1) |
| Accent | Signal rust `#b8371f` on light (5.53:1), `#e8573c` on dark (5.27:1) |

All three typefaces are self-hosted from `src/fonts/` — 73 KB in total, no
third-party font CDN, no licence fee, licences included alongside the files.

---

## Structure

```
content/             Editable content. Top-level, outside src/, deliberately.
  services/*.mdx     Frontmatter = structured fields, body = long-form prose
  work/*.mdx
src/
  app/
    globals.css      All design tokens + component layer. Start here.
    layout.tsx       Font loading, metadata, anti-flash boot script
    (marketing)/     Route group: shared nav, trace, footer
  components/        One file per section, plus shared page chrome
  content/site.ts    Homepage-only copy not yet in the content layer
  config/site.ts     Name, URL, email, nav — one source of truth
  lib/
    content/         THE SEAM — see below
    motion/          MotionProvider: Lenis, GSAP bridge, reveal observer
    seo/             Metadata + JSON-LD builders
    validation/      Contact schema, shared by client and server
```

### The content layer

Content lives in MDX: frontmatter carries the structured fields, the body
carries long-form prose. Frontmatter is parsed through Zod **at module load**,
so malformed content fails `next build` rather than rendering a broken page.

**No page ever imports an MDX file.** Everything goes through
`src/lib/content/` — `getServices()`, `getCaseStudyBySlug()` and so on. That
one indirection is the most important decision in this layer: migrating to a
headless CMS later means rewriting that directory and nothing else, because
every page, sitemap entry and metadata function keeps the same interface.

Two guarantees are enforced at build time, both verified:

- A case study referencing a service that does not exist fails the build,
  naming the file, the bad slug and the valid options.
- Frontmatter that violates the schema fails the build, naming the field.

Adding content means adding the `.mdx` file and one line in
`src/lib/content/registry.ts`. The registry is explicit rather than a glob so
that a renamed file breaks loudly instead of silently vanishing from the
sitemap — and so content is bundled, keeping a static export possible.

Three conventions worth knowing before editing:

1. **Components only ever use semantic tokens** (`--color-surface`,
   `--color-text-muted`), never raw ramp values. That is what makes the dark
   interludes work for free.
2. **Reveal hidden-states live in CSS, gated on `html.js`.** If JavaScript
   never runs, nothing is hidden. Never set an initial hidden state from JS.
3. **If it does not scrub, it is an IntersectionObserver, not a ScrollTrigger.**
   One observer drives every reveal on the page.

---

## Verified

| Check | Result |
|---|---|
| Production build | Passes, all routes static-prerendered |
| `tsc --noEmit` | Clean |
| Cumulative Layout Shift | **0** |
| JavaScript disabled | All 27 headings and all 5 process stages still render; 5.7k characters of content readable |
| Heading structure | One `h1`, no skipped levels |
| Landmarks | `header` / `nav[aria-label]` / `main#main` / `footer`, skip link is the first tab stop |
| Focus indicators | 2px ring, ≥3:1 on every surface |
| Horizontal overflow | None at 390px, 768px or 1440px |
| Mobile menu | `aria-expanded` toggles, Escape closes, focus returns to trigger, scroll lock released |
| Contrast | Every text/background pair computed; all pass WCAG AA |
| Routes | 24 generated; all content pages prerendered as static HTML |
| Email delivery | Tested against a real SMTP server: notification and acknowledgement both delivered, correct From/Reply-To, plain text |
| Header injection | A newline + `Bcc:` in the name field was neutralised — the envelope carried only the intended recipient |
| Partial mail config | Boot fails, naming the missing variable; the server serves 500 rather than accepting undeliverable enquiries |
| Acknowledgement failure | Lead still delivered, visitor still succeeds, failure logged |
| Standalone bundle | Boots, serves styled pages, health probe reports the commit SHA |
| Client-side navigation | Every nav hop, including out of the pinned section, with zero page errors |
| Contact form | Validation errors, value preservation on rejection, successful submission, honeypot, time trap, and submission with JavaScript disabled |
| Content validation | Deliberately broken content fails the build with an actionable message |
| SEO output | Canonicals, `noindex` on the thank-you page, 15-entry sitemap, JSON-LD graph |
| Page weight | 365 KB over the wire on a service page (includes route prefetching) |

---

## Known limitations

- **JavaScript is ~234 KB compressed on a content page, against the plan's
  120 KB target.** Most is the React/Next baseline, not the motion code (GSAP
  + ScrollTrigger + Lenis is roughly 30 KB of it); route prefetching accounts
  for some of the rest. Reducing it means cutting client components further
  or revisiting the framework choice.
- **DNS is not configured.** The transport works, but SPF, DKIM and DMARC must
  be set on the real domain or mail will land in spam. See
  [docs/02-email-deliverability.md](docs/02-email-deliverability.md).
- No linter. `typescript-eslint` does not support TypeScript 7, so TypeScript
  is pinned to `~6.0.3`; adding ESLint means resolving that first.
- No automated tests. The highest-value target is the contact handler's
  validation and header sanitisation.
- No Lighthouse CI gate yet. The budgets are defined in the plan.
- Privacy and terms are structured placeholders, not legal text.
- `SITE_ENV` is read at **build** time, so staging and production need
  separate builds. See `.env.example`.

## Before launch

Blocking, in rough order:

1. Confirm the domain, set `NEXT_PUBLIC_SITE_URL` and build with
   `SITE_ENV=production`.
2. Set the SMTP variables, then configure SPF, DKIM and DMARC and verify by
   sending a test enquiry and reading the full headers. **A form that silently
   fails is worse than no form** — add a synthetic check on the endpoint.
3. Replace every `PLACEHOLDER` (see below).
4. Have the privacy policy reviewed by counsel.
5. Record written client consent for each named case study.
6. Confirm the response-time commitment is honourable on a bad week.

---

## Placeholders to replace

Everything in `src/content/site.ts` marked `PLACEHOLDER`, plus:

- Founder name, role, photograph, and verifiable background
- Real case studies — **and recorded written client consent for each**
- Legal entity name, company number, registered address
- A real monitored inbox (currently `hello@solutionmines.example`)
- The response-time commitment, confirmed as honourable on a bad week
- The genuine "what we don't do" exclusion list
- Price bands and engagement models
- Privacy policy and terms

No testimonials, client logos, metrics, awards, team sizes or years of
experience appear anywhere in this prototype. That is deliberate and should
stay that way until each one can be evidenced.
