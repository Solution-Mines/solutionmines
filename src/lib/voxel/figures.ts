import type { MineInfo, Lamp, SiteInfo } from "./terrain";
import { titleParts } from "./title";
import { ACTS, alongRail, cartStops, type RailPoint } from "./journey";
import { T as TILES, PALETTE, type RGB } from "./atlas";
import {
  character,
  BONE,
  TEX,
  PX,
  type Part,
  type Pose,
  type ClipName,
  type Tool,
  type V3,
} from "./crew";

export type { RailPoint };
export { alongRail };

/* ----------------------------------------------------------------------------
   THE CAST, AND EVERYTHING ELSE MADE OF BOXES

   One instanced draw for the whole population of the mine: the crew, the
   cart and its load, the rail road, the lanterns and the gear at the rim.

   WHY ONE DRAW
   OGL keeps uniforms on the Program, so figures sharing a program would share
   a pose. Everything that differs between figures -- where they stand, which
   way they face, the angle of every joint, the light that reaches them -- is
   on the instance instead, so the crowd costs what one figure would.

   WHAT IS AND IS NOT A FIGURE
   Anything that moves, or is too small for the terrain grid. Rails are
   figures because a rail is a tenth of a block thick. The crystal formation
   is NOT: it is landscape, and belongs on the grid where the culling, the
   texturing and the light flood already handle it.
-------------------------------------------------------------------------------*/

export type FigureDef = {
  id: string;
  parts: Part[];
  /** Local units to world units: PX for people, 1 for props. */
  scale: number;
};

/* --- props, in world units ---------------------------------------------------*/

const ZERO: V3 = [0, 0, 0];

function box(at: V3, size: V3, color: RGB, ao: number, tile?: number, emit?: number): Part {
  return {
    at,
    size,
    pivot: ZERO,
    bone: BONE.root,
    color,
    ao,
    emit,
    ...(tile === undefined ? {} : { tex: TEX.tile, u: tile }),
  };
}

const IRON_DARK: RGB = [0.17, 0.18, 0.21];
const FLAME: RGB = [1.0, 0.78, 0.42];

/* The cart. One unit is one terrain block: a block and a half long, waist
   high on a figure beside it. Long axis along +Z, which is the figures'
   forward too, so one facing angle places either. Riveted iron sides. */
function cartBody(id = "cart"): FigureDef {
  const iron = PALETTE.iron;
  return {
    id,
    scale: 1,
    parts: [
      box([0, 0.4, 0], [0.95, 0.14, 1.5], iron, 0.8, TILES.iron),
      box([-0.45, 0.66, 0], [0.1, 0.52, 1.5], iron, 0.86, TILES.iron),
      box([0.45, 0.66, 0], [0.1, 0.52, 1.5], iron, 0.86, TILES.iron),
      box([0, 0.66, -0.7], [1.0, 0.52, 0.1], iron, 0.82, TILES.iron),
      box([0, 0.66, 0.7], [1.0, 0.52, 0.1], iron, 0.9, TILES.iron),
      // A band round the top: an edge for the silhouette.
      box([0, 0.93, 0], [1.04, 0.08, 1.56], IRON_DARK, 0.95),
      box([-0.44, 0.18, -0.45], [0.16, 0.3, 0.3], IRON_DARK, 0.6),
      box([0.44, 0.18, -0.45], [0.16, 0.3, 0.3], IRON_DARK, 0.6),
      box([-0.44, 0.18, 0.45], [0.16, 0.3, 0.3], IRON_DARK, 0.6),
      box([0.44, 0.18, 0.45], [0.16, 0.3, 0.3], IRON_DARK, 0.6),
    ],
  };
}

/* What the forge sends up to the depot: cut crystal and bright metal, lit
   from inside. Its own figure placed on the cart rather than a pose of the
   cart -- the rig has no poses to blend -- and raised into view as it is
   loaded, so a heap rises in the cart instead of appearing in it. */
function cartLoad(): FigureDef {
  return {
    id: "cartLoad",
    scale: 1,
    parts: [
      box([0, 0.86, 0.1], [0.76, 0.3, 1.0], PALETTE.crystal, 1, TILES.crystal, 0.7),
      box([0, 1.02, -0.1], [0.46, 0.22, 0.7], PALETTE.crystal, 1, TILES.crystal, 0.7),
      box([0.12, 0.98, -0.5], [0.36, 0.14, 0.24], PALETTE.gold, 1, TILES.oreGold, 0.3),
    ],
  };
}

/** Half the gauge. The cart's wheels sit at the same offset. */
export const GAUGE = 0.44;

/* The rail road: one pair of short rails and a sleeper per block of run. The
   way climbs a block at a time, and a single box spanning a step floats at
   one end or is buried at the other; a rail per block sits on its own floor
   and the steps read as the incline they are.

   The direction is read per point from its neighbours, so a road that turns
   turns with it; at a bend both pieces are laid, the way a hand-laid turn
   in a mine is two runs meeting. */
function road(points: RailPoint[]): Part[] {
  const out: Part[] = [];
  // A block's centre is its integer y, so its top face is half a unit up.
  const lift = 0.5;
  const piece = (p: RailPoint, alongX: boolean, sleeper: boolean) => {
    const long: V3 = alongX ? [1.04, 0.1, 0.14] : [0.14, 0.1, 1.04];
    for (const side of [-1, 1]) {
      const ox = alongX ? 0 : side * GAUGE;
      const oz = alongX ? side * GAUGE : 0;
      out.push(box([p.x + ox, p.y + lift + 0.11, p.z + oz], long, PALETTE.iron, 0.84, TILES.iron));
    }
    if (sleeper) {
      out.push(
        box(
          [p.x, p.y + lift + 0.045, p.z],
          alongX ? [0.3, 0.09, 1.22] : [1.22, 0.09, 0.3],
          PALETTE.planks,
          0.7,
          TILES.planks,
        ),
      );
    }
  };
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const inX = Math.abs(p.x - a.x) >= Math.abs(p.z - a.z);
    const outX = Math.abs(b.x - p.x) >= Math.abs(b.z - p.z);
    const first = i === 0;
    const last = i === points.length - 1;
    piece(p, first ? outX : inX, i % 2 === 0);
    if (!first && !last && inX !== outX) piece(p, outX, false);
  });
  return out;
}

/* A lantern from the terrain's list -- the same list the light was flooded
   from, so every pool of light has its lantern. On a post, or on a chain
   from the roof. */
function lantern(l: Lamp): Part[] {
  if (l.hang > 0) {
    return [
      box([l.x, l.y + 0.35 + l.hang / 2, l.z], [0.06, l.hang, 0.06], IRON_DARK, 0.8),
      box([l.x, l.y + 0.27, l.z], [0.3, 0.08, 0.3], IRON_DARK, 0.9),
      box([l.x, l.y, l.z], [0.22, 0.42, 0.22], FLAME, 1, undefined, 1),
      box([l.x, l.y - 0.24, l.z], [0.3, 0.06, 0.3], IRON_DARK, 0.85),
    ];
  }
  return [
    box([l.x, l.y + 0.45, l.z], [0.12, 0.9, 0.12], PALETTE.wood, 0.6, TILES.logSide),
    box([l.x, l.y + 1.12, l.z], [0.3, 0.07, 0.3], IRON_DARK, 0.9),
    box([l.x, l.y + 0.95, l.z], [0.2, 0.28, 0.2], FLAME, 1, undefined, 1),
    box([l.x, l.y + 0.79, l.z], [0.3, 0.05, 0.3], IRON_DARK, 0.85),
  ];
}

function crate(x: number, y: number, z: number, s = 0.62): Part[] {
  return [box([x, y + s / 2, z], [s, s, s], PALETTE.planks, 0.74, TILES.crate)];
}

/* The hoist at the plateau's edge above the ledge: a post, an arm out over
   the drop, a drum to wind it, and a crate hanging on the rope. How goods
   get from the ledge to the top without anyone carrying them up a ladder. */
function winch(x: number, y: number, z: number, reach: number, down: number): Part[] {
  const log = PALETTE.wood;
  return [
    box([x, y + 1.5, z], [0.42, 3.0, 0.42], log, 0.8, TILES.logSide),
    box([x + reach / 2, y + 2.86, z], [reach + 0.4, 0.3, 0.3], log, 0.86, TILES.logSide),
    // A brace from the post to the arm.
    box([x + 0.6, y + 2.4, z], [0.9, 0.18, 0.18], log, 0.8, TILES.logSide),
    box([x - 0.5, y + 1.1, z], [0.6, 0.6, 0.9], PALETTE.planks, 0.8, TILES.planks),
    box([x - 0.5, y + 1.1, z + 0.62], [0.1, 0.5, 0.1], IRON_DARK, 0.8),
    box([x + reach, y + 2.7 - down / 2, z], [0.05, down, 0.05], [0.3, 0.24, 0.17], 0.8),
    ...crate(x + reach, y + 2.7 - down - 0.6, z, 0.6),
  ];
}

/* The board over the portal: four tiles of painted planks with the name on
   them, a hair proud of the rock so it is not coplanar with it. Read from
   outside, so its first tile is the one furthest along +z. */
function sign(face: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < 4; k++) {
    out.push(box([face + 0.07, y, z + 1.5 - k], [0.12, 1.1, 1.0], PALETTE.planks, 0.9, TILES.sign + k));
  }
  return out;
}

/* A ladder up a rock face that faces along x: out of it toward +x, or
   toward -x with `dir` at -1. */
function ladder(face: number, y0: number, y1: number, z: number, dir = 1): Part[] {
  const out: Part[] = [];
  const h = y1 - y0;
  for (const side of [-0.34, 0.34]) {
    out.push(box([face + dir * 0.07, y0 + h / 2, z + side], [0.1, h, 0.1], PALETTE.wood, 0.8, TILES.logSide));
  }
  for (let y = y0 + 0.4; y < y1; y += 0.5) {
    out.push(box([face + dir * 0.09, y, z], [0.08, 0.08, 0.66], PALETTE.planks, 0.8));
  }
  return out;
}

/* A floating islet: a few blocks of turf over dirt over a stone point, in
   one block units. Built in its own frame and moved as a whole. */
function islet(id: string, seed: number, w: number, d: number): FigureDef {
  const parts: Part[] = [];
  let s = seed;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    return s / 4294967296;
  };
  const layer = (y: number, hw: number, hd: number, tile: number, top?: number, keep = 1) => {
    for (let z = -hd; z <= hd; z++) {
      for (let x = -hw; x <= hw; x++) {
        const corner = Math.abs(x) === hw && Math.abs(z) === hd;
        if (corner && rnd() < 0.7) continue;
        if (rnd() > keep) continue;
        parts.push({
          ...box([x, y, z], [1, 1, 1], tile === TILES.grassSide ? PALETTE.grass : PALETTE.stone, 0.9, tile),
          ...(top === undefined ? {} : { top }),
        });
      }
    }
  };
  layer(0, w, d, TILES.grassSide, TILES.grassTop);
  layer(-1, w, d, TILES.dirt, undefined, 0.92);
  layer(-2, Math.max(0, w - 1), Math.max(0, d - 1), TILES.stone, undefined, 0.9);
  layer(-3, Math.max(0, w - 2), Math.max(0, d - 2), TILES.stone, undefined, 0.85);
  parts.push(box([0, -4, 0], [1, 1, 1], PALETTE.stone, 0.8, TILES.stone));
  if (w >= 2) {
    // A bush on the bigger ones: scale.
    parts.push(box([-1, 1, 0], [1, 1, 1], PALETTE.leaf, 0.9, TILES.leaves));
  }
  // Twice the size of the blocks they are made of: at the distance they hang,
  // one-block islets read as specks.
  return { id, parts, scale: 1.8 };
}

/* --- the stations' furniture ---------------------------------------------------- */

/* What a loaded cart carries out of the gallery: ore, heaped. */
function oreLoad(): Part[] {
  return [
    box([0, 0.86, -0.25], [0.7, 0.3, 0.5], PALETTE.gold, 1, TILES.oreGold, 0.2),
    box([0, 0.88, 0.3], [0.7, 0.32, 0.5], PALETTE.copper, 1, TILES.oreCopper, 0.15),
    box([0.05, 1.05, 0.02], [0.4, 0.2, 0.5], PALETTE.stone, 0.95, TILES.oreIron),
  ];
}

/* Posts and a rail along an edge, over a drop: along x, or along z. */
function railing(x0: number, x1: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  for (let x = x0; x <= x1 + 0.01; x += 1.5) out.push(box([x, y + 0.5, z], [0.12, 1.0, 0.12], PALETTE.wood, 0.8));
  out.push(box([(x0 + x1) / 2, y + 0.95, z], [x1 - x0 + 0.1, 0.1, 0.1], PALETTE.wood, 0.85));
  return out;
}
function railingZ(x: number, z0: number, z1: number, y: number): Part[] {
  const out: Part[] = [];
  for (let z = z0; z <= z1 + 0.01; z += 1.5) out.push(box([x, y + 0.5, z], [0.12, 1.0, 0.12], PALETTE.wood, 0.8));
  out.push(box([x, y + 0.95, (z0 + z1) / 2], [0.1, 0.1, z1 - z0 + 0.1], PALETTE.wood, 0.85));
  return out;
}

/* Scaffolding against a rock face: four poles, two decks and a ladder. */
function scaffold(x: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  const pole = PALETTE.wood;
  for (const [ox, oz] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) {
    out.push(box([x + ox, y + 2.25, z + oz], [0.14, 4.5, 0.14], pole, 0.8, TILES.logSide));
  }
  for (const h of [1.6, 3.3]) {
    out.push(box([x, y + h, z], [1.9, 0.12, 1.16], PALETTE.planks, 0.85, TILES.planks));
  }
  for (const side of [-0.28, 0.28]) {
    out.push(box([x + 1.0, y + 1.7, z + side], [0.08, 3.4, 0.08], pole, 0.8));
  }
  for (let h = 0.4; h < 3.4; h += 0.45) out.push(box([x + 1.0, y + h, z], [0.08, 0.07, 0.6], PALETTE.planks, 0.8));
  return out;
}

/* A furnace: a stone block with fire in its mouth, toward the room. */
function furnace(x: number, y: number, z: number): Part[] {
  return [
    box([x, y + 0.85, z], [1.1, 1.7, 1.2], PALETTE.stone, 0.8, TILES.stone),
    box([x, y + 0.55, z + 0.58], [0.62, 0.5, 0.08], FLAME, 1, undefined, 1),
    box([x, y + 2.4, z - 0.2], [0.5, 1.4, 0.5], PALETTE.stone, 0.78, TILES.stone),
  ];
}

/* An anvil, and a bench with what the forge turns out on it: a gear, a
   linked chain, a lever and a fresh block -- one for each of the four
   things the crew builds. Labels are the page's job; these are the shapes. */
function anvil(x: number, y: number, z: number): Part[] {
  return [
    box([x, y + 0.25, z], [0.5, 0.5, 0.4], IRON_DARK, 0.8),
    box([x, y + 0.62, z], [0.9, 0.24, 0.42], IRON_DARK, 0.85),
  ];
}
function bench(x: number, y: number, z: number, item: number): Part[] {
  const out: Part[] = [
    box([x, y + 0.82, z], [1.1, 0.1, 0.8], PALETTE.planks, 0.85, TILES.planks),
    ...[[-0.46, -0.32], [0.46, -0.32], [-0.46, 0.32], [0.46, 0.32]].map(([ox, oz]) =>
      box([x + ox, y + 0.4, z + oz], [0.1, 0.8, 0.1], PALETTE.wood, 0.75),
    ),
  ];
  const top = y + 0.9;
  if (item === 0) {
    // A gear: a hub and four teeth.
    out.push(box([x, top + 0.12, z], [0.36, 0.24, 0.36], PALETTE.gold, 0.9, TILES.oreGold));
    for (const [ox, oz] of [[0.24, 0], [-0.24, 0], [0, 0.24], [0, -0.24]]) {
      out.push(box([x + ox, top + 0.12, z + oz], [0.12, 0.2, 0.12], PALETTE.gold, 0.9));
    }
  } else if (item === 1) {
    // A chain of three links.
    for (let k = -1; k <= 1; k++) out.push(box([x + k * 0.26, top + 0.06, z], [0.24, 0.12, 0.14], PALETTE.iron, 0.9, TILES.iron));
  } else if (item === 2) {
    // A lever on a block.
    out.push(box([x, top + 0.12, z], [0.34, 0.24, 0.34], PALETTE.iron, 0.88, TILES.iron));
    out.push(box([x + 0.08, top + 0.42, z], [0.06, 0.4, 0.06], PALETTE.wood, 0.85));
  } else {
    // A new block, cut clean, and a gem beside it.
    out.push(box([x - 0.12, top + 0.16, z], [0.32, 0.32, 0.32], PALETTE.crystal, 1, TILES.crystal, 0.5));
    out.push(box([x + 0.26, top + 0.06, z + 0.1], [0.14, 0.12, 0.14], PALETTE.gold, 1, TILES.oreGold, 0.3));
  }
  return out;
}

/* The beacon at the depot: an iron base and a crystal heart, lit. The beam
   it throws is drawn by the light shaft's program, upward. */
function beaconBase(x: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) out.push(box([x + dx, y + 0.5, z + dz], [1, 1, 1], PALETTE.iron, 0.85, TILES.iron));
  }
  out.push(box([x, y + 1.45, z], [0.9, 0.9, 0.9], PALETTE.crystal, 1, TILES.crystal, 1));
  return out;
}

/** The floating islets: where each one hangs, in the island's frame. Behind
    and beside the island from the opening camera, never between it and the
    island or out over the ledge, where the approach is filmed. */
export const ISLETS: Array<{ id: string; x: number; y: number; z: number; spin: number }> = [
  { id: "islet0", x: -54, y: 36, z: 16, spin: 0.4 },
  { id: "islet1", x: -40, y: 60, z: -48, spin: 1.7 },
  { id: "islet2", x: 10, y: 42, z: -60, spin: 3.1 },
  { id: "islet3", x: 50, y: 64, z: -34, spin: 4.6 },
];

/* --- the cast ----------------------------------------------------------------*/

export type CastMember = {
  id: string;
  /** Which painted skin. */
  look: number;
  tool: Tool;
  /** Where they stand, in world units. Y is resolved onto the ground. */
  x: number;
  z: number;
  /** Start the ground search here and walk down. */
  groundFrom: number;
  /** A point they face, in the ground plane. */
  lookX: number;
  lookZ: number;
  /** Shown across this window of scroll progress. */
  from: number;
  to: number;
  clip: ClipName;
  period?: number;
  phase?: number;
  /** For story beats: blend the clip in across this window of progress. */
  beat?: [number, number];
  /** Swung by the visitor rather than by the clock. */
  user?: boolean;
  /** Walks with the cart instead of standing anywhere: this many route
      points ahead of it, or behind it if negative. */
  rail?: number;
  /** A second clip taken up at a point in the journey -- a wave that turns
      into standing about once the visitor has arrived. */
  then?: { at: number; clip: ClipName };
};

/** A figure put down once, where it stays: the parked carts and their load. */
export type Fixed = { id: string; x: number; y: number; z: number; yaw: number };

export type Scene = {
  defs: FigureDef[];
  cast: CastMember[];
  fixed: Fixed[];
  /** The rail road's centre line, in world units. */
  rail: RailPoint[];
};

/** Every figure, prop and placement the mine needs, derived from the dig.

    Nothing here is a literal coordinate. The rooms, the route and the face
    all move when the island is reseeded, and a cast placed by hand would be
    standing in mid-air the first time that happened. */
export function buildScene(mine: MineInfo, site: SiteInfo): Scene {
  const L = site.ledge;
  const rail = mine.route;
  const G = mine.gallery;
  const F = mine.forge;
  const C = mine.chasm;
  const geo = mine.geode;
  const depot = rail[mine.stops.depot];
  const LW = mine.lower;
  /* The lower working's own short track, along its back half, and where
     its cart stands on it. */
  const lowerRail: RailPoint[] = [];
  for (let x = LW.x0 + 2; x <= LW.x1 - 2; x++) lowerRail.push({ x, y: LW.floorY, z: mine.sectionZ - 2 });
  const lowerCartX = LW.x0 + 5.5;

  /* The road out: across the ledge from near its outer edge, then the
     route the whole way to the depot, and the spur to the geode. Laid on
     the same points the camera walks, so the rails and the lens agree. */
  const ledgeRail: RailPoint[] = [];
  for (let k = L.len - 2; k >= 1; k--) {
    ledgeRail.push({ x: L.face + 0.5 + k, y: L.y - 0.5, z: L.z });
  }
  /* The gallery's siding: four blocks of track beside the main line at the
     end of the room away from the face, where the full carts wait out of
     the way of the pickers. */
  const t = mine.target;
  const faceX = t ? t.x : (G.x0 + G.x1) / 2;
  const sidingX = faceX > (G.x0 + G.x1) / 2 ? G.x0 : G.x1 - 3;
  const sidingZ = mine.sectionZ - 2;
  const siding: RailPoint[] = [];
  for (let k = 0; k <= 3; k++) siding.push({ x: sidingX + k, y: G.floorY, z: sidingZ });
  const stops = cartStops(mine);
  const cartAtFace = rail[stops.face];
  const beacon = mine.beacon;

  /* The forge's floor that is free: east of where the track turns into
     the back wall, and behind the line it comes in on. */
  const forgeEast = F.x1 + 0.5;
  const forgeBench = (k: number) => forgeEast - 0.65 - k * 1.35;
  const midFire = mine.fires[1] ?? { x: (F.x0 + F.x1) / 2, y: F.floorY, z: F.back + 1 };

  const props: Part[] = [
    ...road([...ledgeRail, ...rail]),
    ...road(mine.spur),
    ...road(siding),
    ...mine.lamps.flatMap(lantern),
    // Base camp: crates by the portal, the hoist above, the board and a
    // ladder up the cliff.
    ...crate(L.x - 1.6, L.y, L.z + 3.1),
    ...crate(L.x - 0.8, L.y, L.z + 3.4, 0.5),
    ...crate(L.x - 1.25, L.y + 0.62, L.z + 3.2, 0.46),
    ...winch(site.winch.x, site.winch.y, site.winch.z, L.x + 0.3 - site.winch.x, site.winch.y + 2.7 - (L.y + 2.6)),
    ...sign(L.face, L.y + 6.0, L.z),
    ...ladder(L.face, L.y, site.top + 0.5, L.z - L.half + 0.4),
    // The gallery: scaffolding against the face either side of the block
    // being worked, crates by the siding.
    ...scaffold(faceX - 3.6, G.floorY + 0.5, G.back + 0.15),
    ...scaffold(Math.min(G.x1 - 1.2, faceX + 3.8), G.floorY + 0.5, G.back + 0.15),
    ...crate(sidingX + 0.2, G.floorY + 0.5, G.back + 0.6),
    ...crate(sidingX + 1.0, G.floorY + 0.5, G.back + 0.7, 0.5),
    /* The lower working: its track, the rail at its balcony over the pool,
       and the ladder from there up the chasm wall to the bridge, on the
       front row so the section shows it. */
    ...road(lowerRail),
    ...railingZ(LW.x0 - 0.35, LW.back - 0.4, mine.sectionZ + 1.4, LW.floorY + 0.5),
    ...ladder(LW.x0 - 0.5, LW.floorY + 0.5, C.bridgeY + 0.5, mine.sectionZ + 1, -1),
    ...crate(LW.x1 - 0.4, LW.floorY + 0.5, LW.back + 0.1),
    ...crate(LW.x1 - 1.1, LW.floorY + 0.5, LW.back - 0.1, 0.5),
    // A railing along the bridge's back edge, over the drop.
    ...railing(C.x0 - 0.5, C.x1 + 0.5, C.bridgeY + 0.5, mine.sectionZ - 2.45),
    /* The forge: furnaces along the back wall, an anvil before the middle
       one, and the four benches along the front -- one for each thing the
       crew makes -- all clear of the track's turn into the back. */
    ...mine.fires.flatMap((f) => furnace(f.x, f.y + 0.5, f.z)),
    ...anvil(midFire.x, F.floorY + 0.5, F.back + 2.9),
    ...[0, 1, 2, 3].flatMap((k) => bench(forgeBench(3 - k), F.floorY + 0.5, F.back + 4.5, k)),
    /* The depot: a buffer at the end of the road, the beacon, and what has
       been unloaded stacked on the beacon's side of the line -- the other
       side is where the camera stands to watch the cart come out. */
    box([depot.x + 0.9, depot.y + 0.85, depot.z], [0.5, 0.7, 1.3], PALETTE.wood, 0.8, TILES.logSide),
    ...crate(depot.x - 3.6, depot.y + 0.5, depot.z - 2.3),
    ...crate(depot.x - 2.9, depot.y + 0.5, depot.z - 2.6, 0.5),
    ...crate(depot.x - 3.3, depot.y + 1.12, depot.z - 2.4, 0.46),
    ...beaconBase(beacon.x, beacon.y, beacon.z),
  ];

  /* The working face. The one block a visitor can break is picked by the
     generator, so everybody meant to be working ON it is placed from it. Out
     of the wall along the face it presents, and across it along the
     perpendicular -- the only two axes that mean anything at a rock face. */
  const faceZ = t ? t.z : G.back;
  const fx = t ? t.face[0] : 0;
  const fz = t ? t.face[2] : 1;
  const sx = -fz;
  const sz = fx;

  const cast: CastMember[] = [
    /* Base camp, on the ledge: someone at the outer corner waving at the
       visitor as they arrive, and one of the crew taking a break in the
       parked cart. */
    {
      id: "greeter",
      look: 4,
      tool: "none",
      x: L.x + 2.6,
      z: L.z + 2.4,
      groundFrom: L.y + 3,
      // Toward the opening camera, a long way off over the sea.
      lookX: 78,
      lookZ: 109,
      from: 0,
      to: ACTS[2].from + 0.02,
      clip: "wave",
      phase: 0.4,
      then: { at: ACTS[1].from + (ACTS[1].to - ACTS[1].from) * 0.35, clip: "idle" },
    },
    {
      id: "rester",
      look: 7,
      tool: "none",
      x: L.x + 1.65,
      z: L.z,
      groundFrom: L.y + 3,
      lookX: L.x + 6,
      lookZ: L.z,
      from: 0,
      to: ACTS[2].from + 0.02,
      clip: "sit",
      phase: 2.2,
    },
    /* The surveyor pointing into the portal, the rigger at the gear. */
    {
      id: "surveyor",
      look: 0,
      tool: "none",
      x: L.x + 1.6,
      z: L.z - 2.2,
      groundFrom: L.y + 3,
      lookX: L.face,
      lookZ: L.z,
      from: 0,
      to: ACTS[2].from + 0.02,
      clip: "point",
    },
    {
      id: "rigger",
      look: 1,
      tool: "none",
      x: L.x - 0.2,
      z: L.z + 2.0,
      groundFrom: L.y + 3,
      lookX: L.x - 1.4,
      lookZ: L.z + 3.2,
      from: 0,
      to: ACTS[2].from + 0.02,
      clip: "work",
      phase: 1.1,
    },
    // And the lamp bearer at the portal, ready to lead the way in.
    {
      id: "bearer",
      look: 2,
      tool: "lantern",
      x: L.face - 0.9,
      z: L.z - 1.3,
      groundFrom: L.y + 3,
      lookX: L.face - 6,
      lookZ: L.z,
      from: ACTS[1].at,
      to: ACTS[3].from + 0.04,
      clip: "lantern",
    },
    /* The working face: two picks at the seam, the visitor driving one of
       them, and a loader at the carts on the siding. */
    /* The visitor's man stands to the side of the block, not in front of
       it: square in front, he hid from the camera the one thing in the room
       a visitor is meant to find. */
    {
      id: "faceA",
      look: 3,
      tool: "pick",
      x: faceX + fx * 1.4 + sx * 1.25,
      z: faceZ + fz * 1.4 + sz * 1.25,
      groundFrom: (t ? t.y : G.floorY) + 3,
      lookX: faceX + fx * 0.5,
      lookZ: faceZ + fz * 0.5,
      from: ACTS[2].at,
      to: ACTS[4].from + 0.06,
      clip: "swing",
      user: true,
    },
    {
      id: "faceB",
      look: 4,
      tool: "pick",
      x: faceX + fx * 2.1 - sx * 3.2,
      z: faceZ + fz * 2.1 - sz * 3.2,
      groundFrom: (t ? t.y : G.floorY) + 3,
      lookX: faceX - sx * 3.2,
      lookZ: faceZ - sz * 3.2,
      from: ACTS[2].at,
      to: ACTS[4].from + 0.06,
      clip: "swing",
      period: 2.4,
      phase: 1.05,
    },
    {
      id: "loader",
      look: 5,
      tool: "shovel",
      x: cartAtFace.x - 0.5,
      z: cartAtFace.z - 1.6,
      groundFrom: G.floorY + 3,
      lookX: cartAtFace.x - 0.3,
      lookZ: cartAtFace.z,
      from: ACTS[2].at,
      to: ACTS[4].from + 0.06,
      clip: "shovel",
      period: 2.6,
      phase: 0.4,
    },
    /* The find, in the geode: two of the crew already there, reacting as
       the visitor arrives. */
    {
      id: "finderA",
      look: 6,
      tool: "none",
      x: geo.x + 1.4,
      z: geo.z - 2.2,
      groundFrom: geo.y,
      lookX: geo.x,
      lookZ: geo.z + 2,
      from: ACTS[4].from,
      to: ACTS[5].from + 0.04,
      clip: "cheer",
      beat: [ACTS[4].at, ACTS[4].to],
    },
    {
      id: "finderB",
      look: 1,
      tool: "none",
      x: geo.x - 1.3,
      z: geo.z - 2.6,
      groundFrom: geo.y,
      lookX: geo.x - 1.8,
      lookZ: geo.z - 4.5,
      from: ACTS[4].from,
      to: ACTS[5].from + 0.04,
      clip: "point",
      phase: 2.0,
    },
    /* The lower working: a pick at its far face, and a shovel at its cart.
       On from the moment the island opens to the moment it closes. */
    {
      id: "lowerA",
      look: 7,
      tool: "pick",
      x: LW.x1 - 1.1,
      z: mine.sectionZ - 0.5,
      groundFrom: LW.floorY + 3,
      lookX: LW.x1 + 1,
      lookZ: mine.sectionZ - 0.5,
      from: ACTS[2].from,
      to: ACTS[6].to,
      clip: "swing",
      period: 2.2,
      phase: 0.6,
    },
    {
      id: "lowerB",
      look: 4,
      tool: "shovel",
      x: lowerCartX + 1.4,
      z: mine.sectionZ - 0.6,
      groundFrom: LW.floorY + 3,
      lookX: lowerCartX + 0.4,
      lookZ: mine.sectionZ - 2,
      from: ACTS[2].from,
      to: ACTS[6].to,
      clip: "shovel",
      period: 2.8,
      phase: 1.7,
    },
    // The forge: the smith at an anvil, a sorter at the benches.
    {
      id: "smith",
      look: 7,
      tool: "hammer",
      x: midFire.x,
      z: F.back + 2.05,
      groundFrom: F.floorY + 3,
      lookX: midFire.x,
      lookZ: F.back + 3.3,
      from: ACTS[5].from - 0.03,
      to: ACTS[6].from + 0.03,
      clip: "hammer",
      period: 0.95,
      phase: 0.3,
    },
    {
      id: "sorter",
      look: 0,
      tool: "none",
      x: (forgeBench(2) + forgeBench(3)) / 2,
      z: F.back + 3.65,
      groundFrom: F.floorY + 3,
      lookX: (forgeBench(2) + forgeBench(3)) / 2,
      lookZ: F.back + 4.8,
      from: ACTS[5].from - 0.03,
      to: ACTS[6].from + 0.03,
      clip: "point",
      phase: 1.4,
    },
    {
      id: "pusher",
      look: 2,
      tool: "none",
      // Placed on the rails each frame, behind the cart.
      x: cartAtFace.x,
      z: cartAtFace.z,
      groundFrom: cartAtFace.y + 3,
      lookX: cartAtFace.x - 1,
      lookZ: cartAtFace.z,
      from: ACTS[4].from - 0.01,
      to: 1,
      clip: "push",
      rail: -1.4,
    },
    /* And the lamp bearer leading it to the forge and up the incline and out
       into the day. Joins it while the camera is in the find, so nobody
       appears in front of the lens. */
    {
      id: "guide",
      look: 6,
      tool: "lantern",
      x: cartAtFace.x,
      z: cartAtFace.z,
      groundFrom: cartAtFace.y + 3,
      lookX: cartAtFace.x - 1,
      lookZ: cartAtFace.z,
      from: ACTS[5].from,
      to: 1,
      clip: "walk",
      rail: 2.2,
    },
    /* The delivery: two of the crew waiting at the depot as the beacon
       fires. There from before the camera comes round to the upper portal,
       so they are found there rather than appearing. */
    {
      id: "cheerA",
      look: 3,
      tool: "none",
      x: depot.x - 1.3,
      z: depot.z - 2.3,
      groundFrom: depot.y + 4,
      lookX: beacon.x,
      lookZ: beacon.z,
      from: ACTS[6].at,
      to: 1,
      clip: "cheer",
      beat: [ACTS[7].from + (ACTS[7].to - ACTS[7].from) * 0.3, ACTS[7].at],
    },
    {
      id: "cheerB",
      look: 5,
      tool: "none",
      x: depot.x - 1.9,
      z: depot.z - 3.9,
      groundFrom: depot.y + 4,
      lookX: beacon.x,
      lookZ: beacon.z,
      from: ACTS[6].at,
      to: 1,
      clip: "cheer",
      phase: 0.7,
      beat: [ACTS[7].from + (ACTS[7].to - ACTS[7].from) * 0.34, ACTS[7].at],
    },
  ];

  /* The carts that are not going anywhere: one on the ledge, two on the
     siding with the second one full. */
  const fixed: Fixed[] = [
    { id: "parkedCart", x: L.x + 2.0, y: L.y, z: L.z, yaw: Math.PI / 2 },
    { id: "spurCartA", x: sidingX + 0.8, y: G.floorY + 0.5, z: sidingZ, yaw: Math.PI / 2 },
    { id: "spurCartB", x: sidingX + 2.5, y: G.floorY + 0.5, z: sidingZ, yaw: Math.PI / 2 },
    { id: "spurLoad", x: sidingX + 2.5, y: G.floorY + 0.5, z: sidingZ, yaw: Math.PI / 2 },
    { id: "lowerCart", x: lowerCartX, y: LW.floorY + 0.5, z: mine.sectionZ - 2, yaw: Math.PI / 2 },
    { id: "lowerLoad", x: lowerCartX, y: LW.floorY + 0.5, z: mine.sectionZ - 2, yaw: Math.PI / 2 },
  ];

  const defs: FigureDef[] = [
    { id: "props", parts: props, scale: 1 },
    cartBody(),
    cartLoad(),
    { id: "cartOre", parts: oreLoad(), scale: 1 },
    cartBody("parkedCart"),
    cartBody("spurCartA"),
    cartBody("spurCartB"),
    { id: "spurLoad", parts: oreLoad(), scale: 1 },
    cartBody("lowerCart"),
    { id: "lowerLoad", parts: oreLoad(), scale: 1 },
    { id: "title", parts: titleParts(), scale: 1 },
    /* The piece of ore that drops out of the block when it breaks: a small
       block of it, spinning, the way a broken block's item does in the game
       this is built on. Placed by the mining interaction. */
    { id: "oreItem", parts: [box([0, 0, 0], [0.36, 0.36, 0.36], PALETTE.gold, 1, TILES.oreGold, 0.55)], scale: 1 },
    islet("islet0", 0x1a2b, 2, 2),
    islet("islet1", 0x3c4d, 3, 2),
    islet("islet2", 0x5e6f, 1, 1),
    islet("islet3", 0x7081, 2, 1),
    ...cast.map((c) => ({ id: c.id, parts: character(c.look, c.tool), scale: PX })),
  ];

  return { defs, cast, fixed, rail };
}

/* --- the batch ---------------------------------------------------------------
   Flat arrays, one entry per box. The first group never changes after the
   build; the second is rewritten every frame from each figure's position,
   facing, joint angles and light, which is five small uploads for the whole
   population. */
export type FigureBatch = {
  part: Float32Array;
  size: Float32Array;
  pivot: Float32Array;
  color: Float32Array;
  tex: Float32Array;
  /** CPU-side only: baked darkening, self-light, and bone, per box. */
  ao: Float32Array;
  emit: Float32Array;
  bone: Uint8Array;
  /** Per box, per frame: origin xyz + scale. */
  xform: Float32Array;
  /** Per box, per frame: facing sin, facing cos, unused, hidden. */
  motion: Float32Array;
  /** Per box, per frame: its bone's angles, and the body's under it. */
  rot: Float32Array;
  rotP: Float32Array;
  /** Per box, per frame: darkening x sky access, self-light, warm, crystal. */
  shade: Float32Array;
  count: number;
  span: Record<string, { from: number; to: number; scale: number }>;
};

export function buildBatch(defs: FigureDef[]): FigureBatch {
  let n = 0;
  for (const d of defs) n += d.parts.length;

  const b: FigureBatch = {
    part: new Float32Array(n * 3),
    size: new Float32Array(n * 3),
    pivot: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
    tex: new Float32Array(n * 4),
    ao: new Float32Array(n),
    emit: new Float32Array(n),
    bone: new Uint8Array(n),
    xform: new Float32Array(n * 4),
    motion: new Float32Array(n * 4),
    rot: new Float32Array(n * 3),
    rotP: new Float32Array(n * 3),
    shade: new Float32Array(n * 4),
    count: n,
    span: {},
  };

  let i = 0;
  for (const d of defs) {
    b.span[d.id] = { from: i, to: i + d.parts.length, scale: d.scale };
    for (const p of d.parts) {
      b.part.set(p.at, i * 3);
      b.size.set(p.size, i * 3);
      b.pivot.set(p.pivot, i * 3);
      b.color.set(p.color, i * 3);
      /* The fourth slot is the skin's texel density for a skinned box, and
         the top face's tile plus one for a tiled box (0: same as the sides). */
      const w = p.tex === TEX.tile ? (p.top === undefined ? 0 : p.top + 1) : (p.density ?? 1);
      b.tex.set([p.tex ?? TEX.flat, p.u ?? 0, p.v ?? 0, w], i * 4);
      b.ao[i] = p.ao;
      b.emit[i] = p.emit ?? 0;
      b.bone[i] = p.bone;
      // Hidden until something places it, so an undriven figure is absent
      // rather than standing at the origin inside the island.
      b.motion[i * 4 + 3] = 1;
      b.xform[i * 4 + 3] = d.scale;
      i++;
    }
  }
  return b;
}

export type Placement = {
  x: number;
  y: number;
  z: number;
  /** Radians, the same way the shader turns a figure. */
  yaw: number;
  hidden: boolean;
  scale?: number;
  /** Daylight reaching the figure, 0 underground to 1 in the open. */
  sky?: number;
  /** Lantern and crystal light reaching it, as intensities. */
  warm?: number;
  crystal?: number;
};

/** Write a figure's position, facing and light across its span. */
export function place(b: FigureBatch, id: string, p: Placement) {
  const s = b.span[id];
  if (!s) return;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const scale = p.scale ?? s.scale;
  const hide = p.hidden ? 1 : 0;
  const sky = p.sky ?? 1;
  for (let i = s.from; i < s.to; i++) {
    const x = i * 4;
    b.xform[x] = p.x;
    b.xform[x + 1] = p.y;
    b.xform[x + 2] = p.z;
    b.xform[x + 3] = scale;
    b.motion[x] = sin;
    b.motion[x + 1] = cos;
    b.motion[x + 3] = hide;
    b.shade[x] = b.ao[i] * sky;
    b.shade[x + 1] = b.emit[i];
    b.shade[x + 2] = p.warm ?? 0;
    b.shade[x + 3] = p.crystal ?? 0;
  }
}

/** Write a pose's joint angles across a figure's span. Head and arms carry
    the body's lean as their parent; body and legs do not. */
export function poseFigure(b: FigureBatch, id: string, pose: Pose) {
  const s = b.span[id];
  if (!s) return;
  for (let i = s.from; i < s.to; i++) {
    const bone = b.bone[i];
    const own =
      bone === BONE.body
        ? pose.body
        : bone === BONE.head
          ? pose.head
          : bone === BONE.armR
            ? pose.armR
            : bone === BONE.armL
              ? pose.armL
              : bone === BONE.legR
                ? pose.legR
                : bone === BONE.legL
                  ? pose.legL
                  : ZERO;
    const parent = bone === BONE.head || bone === BONE.armR || bone === BONE.armL ? pose.body : ZERO;
    b.rot.set(own, i * 3);
    b.rotP.set(parent, i * 3);
  }
}
