# SolutionMines — the voxel journey

The site is one page: a floating island built from blocks, the mine inside
it, and the five stages of the work told along a minecart track through it.
The addresses of the earlier marketing pages redirect to it.

**Content is still partly placeholder** — see *Before launch* at the foot of
this file.

---

## Run it

```bash
pnpm install
pnpm dev
```

Then open **http://localhost:3000**

To run it the way **production** does — a self-contained tree that needs no
`node_modules`:

```bash
pnpm build && pnpm package && pnpm start:standalone
```

(`next start` warns under `output: "standalone"`; it works for local review,
but `start:standalone` is the real path. `pnpm package` copies static assets
into the bundle, which `next build` deliberately does not do.)

Other scripts: `pnpm typecheck` (`tsc --noEmit`).

> Requires Node 22.12+. If you use npm or yarn instead of pnpm, delete
> `pnpm-lock.yaml` first — the lockfile is pnpm's.

---

## Routes

| Route | Notes |
|---|---|
| `/` | The journey |
| `/voxel`, `/services/*`, `/work/*`, `/how-we-work`, `/about`, `/contact/*`, `/privacy`, `/terms` | Redirect to `/` (307, so a page brought back later is not stuck behind a cached redirect) |
| `/api/health` | Status and the commit being served, for the deploy |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | Generated |
| 404 | A card over the island's sky, with the way back |

## What to look at

| | Where |
|---|---|
| The island opening into a cross-section | Scroll past the base camp |
| Keys **1**–**8** | Jump to each act; the hotbar along the bottom does the same |
| The block you can mine | The working face, act 4 |
| Reduced motion | Set it at OS level: one still per act and the words as an article |
| Stills for review | `?p=0.42` holds a progress; `?cam=x,y,z,lx,ly,lz[,fov]` a camera |
| Frame timing | `?bench=1` |

---

## Structure

```
src/
  app/
    page.tsx           The one page: metadata, JSON-LD, the journey
    not-found.tsx      The 404
    globals.css        Reset, tokens and base styles only
    voxel/             The journey's page-side code and its stylesheet
  components/voxel/    The renderer: shaders, post, shadows
  lib/voxel/           The world: terrain, atlas, figures, animals, camera path
  content/site.ts      The words, and nothing invented
  config/site.ts       Name, URL, email — one source of truth
  lib/seo/             Metadata + JSON-LD builders
```

The world is built in a worker (`src/lib/voxel/world.worker.ts`) and drawn
with OGL on WebGL2, with a flat-colour WebGL1 fallback.

---

## Known limitations

- No linter. `typescript-eslint` does not support TypeScript 7, so TypeScript
  is pinned to `~6.0.3`; adding ESLint means resolving that first.
- No automated tests.
- Frame rates on phones have not been measured on a real device; `?bench=1`
  shows them.
- The share image (`/opengraph-image`) is still drawn in the earlier printed
  style.
- `SITE_ENV` is read at **build** time, so staging and production need
  separate builds. See `.env.example`.

## Before launch

1. Confirm the domain, set `NEXT_PUBLIC_SITE_URL` and build with
   `SITE_ENV=production`.
2. Replace every `PLACEHOLDER` (see below).
3. Confirm the response-time commitment is honourable on a bad week.

---

## Placeholders to replace

Everything in `src/content/site.ts` marked `PLACEHOLDER`, plus the legal
entity name, company number and registered address in `src/config/site.ts`.

No testimonials, client logos, metrics, awards, team sizes or years of
experience appear anywhere on the site. That is deliberate and should stay
that way until each one can be evidenced.
