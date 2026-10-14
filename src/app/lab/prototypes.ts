/* One source of truth for the four prototypes, so the index, the tab bar and
   each page's own metadata cannot drift apart. */

export type Prototype = {
  slug: string;
  no: string;
  name: string;
  tagline: string;
  body: string;
  tech: string[];
  cost: string;
  swatch: string[];
};

export const prototypes: Prototype[] = [
  {
    slug: "dither",
    no: "01",
    name: "Dither",
    tagline: "1-bit, printed, deliberately low-fi",
    body: "Everything resolves through an ordered 8×8 Bayer threshold, so the whole page is literally two colours plus one accent. It looks like a plotter output or an early Mac — which is the point: nothing a template generator produces looks like this.",
    tech: ["WebGL2 fragment shader", "Bayer ordered dither", "no libraries"],
    cost: "~2 KB of shader. No dependency.",
    swatch: ["#e8e4da", "#0b0b0b", "#ff4d00"],
  },
  {
    slug: "liquid",
    no: "02",
    name: "Liquid field",
    tagline: "A real-time field that answers the cursor",
    body: "A signed-distance metaball field solved per pixel, with your pointer as one of its six sources. It is not a video and not a gradient — move the mouse and the geometry genuinely re-solves. The closest thing on this list to an award-site hero.",
    tech: ["WebGL2 fragment shader", "SDF metaballs", "pointer-driven"],
    cost: "~3 KB of shader, ~0.6 ms/frame at 1.5× DPR.",
    swatch: ["#05060a", "#2effc4", "#7a5cff"],
  },
  {
    slug: "physics",
    no: "03",
    name: "Tactile",
    tagline: "Objects with mass that you can actually throw",
    body: "The capability set is a pile of rigid bodies in a real solver. Grab one, throw it, stack them, watch them settle. Interaction that has weight reads as craft in a way no hover transition does, because nobody can fake a physics engine with CSS.",
    tech: ["Matter.js", "rigid-body solver", "pointer constraints"],
    cost: "~24 KB gzip for matter-js. The only prototype with a dependency.",
    swatch: ["#111113", "#f4f1ea", "#ff6b35"],
  },
  {
    slug: "system",
    no: "04",
    name: "Live system",
    tagline: "The site behaves like the thing it sells",
    body: "Driven by a command palette rather than scrolling. Type a query, get structured output and a diagram that redraws itself. An engineering firm whose website is an interface rather than a brochure is an argument, not a decoration.",
    tech: ["⌘K palette", "typed output", "live SVG topology"],
    cost: "No dependency. ~6 KB of component code.",
    swatch: ["#07090c", "#d7dde5", "#4ea1ff"],
  },
];
