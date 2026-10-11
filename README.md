# SolutionMines — Visual Design Prototype

**This is a design-validation prototype, not the production website.**
It exists to make one creative direction concrete enough to approve or reject.
All content is placeholder. Nothing here should be deployed.

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

Other scripts: `pnpm typecheck` (`tsc --noEmit`).

> Requires Node 22.12+. If you use npm or yarn instead of pnpm, delete
> `pnpm-lock.yaml` first — the lockfile is pnpm's.

---

## What to look at

| | Where |
|---|---|
| Hero reveal choreography | Top of the page, on load |
| **The Trace** (signature element) | Left margin, desktop ≥1024px. It draws as you scroll. |
| Problem-recognition list | Section 01 |
| Dark interlude + trust commitments | Section 02 |
| Services index with hover wash | Section 03 |
| **The Delivery Spine** (signature interactive section) | Section 04 — the page pins and travels sideways |
| Work showcase | Section 05 |
| Closing CTA + footer | Section 06 |
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
src/
  app/
    globals.css      All design tokens + component layer. Start here.
    layout.tsx       Font loading, metadata, anti-flash boot script
    page.tsx         Homepage narrative order, with the reasoning
  components/        One file per section, plus Trace / MagneticButton
  content/site.ts    ALL placeholder copy, in one auditable place
  lib/motion/        MotionProvider: Lenis, GSAP bridge, reveal observer
```

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
| Page weight | 277 KB over the wire, 12 requests |

---

## Known limitations

- **JavaScript is ~193 KB compressed, against the plan's 120 KB target.** Most
  of that is the React/Next baseline rather than the motion code (GSAP +
  ScrollTrigger + Lenis is roughly 30 KB of it). Reducing it means cutting
  client components further, or revisiting the framework choice.
- No linter is configured. `typescript-eslint` does not yet support
  TypeScript 7, and TypeScript is pinned to `~6.0.3` for that reason.
- Only the homepage exists. Nav links are in-page anchors; service and case
  study links point at the contact section.
- There is no contact form — only a `mailto:`. Form handling is Phase 1 proper.
- Lighthouse CI, tests, and the CMS-ready content layer are not set up here.
- `metadataBase` is `https://example.invalid` and the page is `noindex`, both
  deliberately, until a real domain is confirmed.

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
