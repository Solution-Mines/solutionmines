import { BONE, PX, type Part, type Pose, type V3 } from "./crew";
import type { RGB } from "./atlas";
import { EMPTY_CELL, MATERIAL, VOXEL_SIZE, type VoxelTerrain } from "./terrain";

/* ----------------------------------------------------------------------------
   THE ANIMALS

   A few pigs, hens and goats about the island's top, so the place reads as
   lived on rather than as a model of one. Boxes on the crew's rig, drawn for
   this -- not any game's animals -- in the crew's measure: sixteen pixels to
   the block, forward along +z.

   The rig has four limbs and they are named for a person, so on an animal
   the arms are the front legs and the legs the back ones. A walk moves the
   legs in diagonal pairs -- front right with back left -- which is the
   person's own walk, arm against leg, set on all fours.

   Each animal keeps to a pen: a patch of open, flat, clear grass found in
   the grid near a place the camera passes close by, never a written-down
   coordinate. Inside it they wander between a handful of points, walk,
   stop to graze or peck, turn, and go on -- a loop over the clock, so the
   same moment always looks the same.
-------------------------------------------------------------------------------*/

export type Kind = "pig" | "hen" | "goat";

const box = (bone: number, at: V3, size: V3, pivot: V3, color: RGB, ao = 0.9): Part => ({
  bone,
  at,
  size,
  pivot,
  color,
  ao,
});

const PINK: RGB = [0.93, 0.63, 0.63];
const PINK_DARK: RGB = [0.82, 0.48, 0.52];
const HOOF: RGB = [0.36, 0.27, 0.25];
const EYE: RGB = [0.08, 0.07, 0.08];
const WHITE: RGB = [0.95, 0.94, 0.9];
const COMB: RGB = [0.86, 0.16, 0.13];
const BEAK: RGB = [0.96, 0.72, 0.22];
const CREAM: RGB = [0.91, 0.88, 0.8];
const HORN: RGB = [0.5, 0.46, 0.41];
const GOAT_HOOF: RGB = [0.3, 0.28, 0.27];

/** Four legs, the front two on the arm bones. */
function legs(w: number, h: number, half: number, front: number, back: number, color: RGB, hoof: RGB): Part[] {
  const out: Part[] = [];
  for (const [bone, x, z] of [
    [BONE.armR, half, front],
    [BONE.armL, -half, front],
    [BONE.legR, half, back],
    [BONE.legL, -half, back],
  ] as const) {
    const pivot: V3 = [x, h, z];
    out.push(box(bone, [x, h / 2 + 0.5, z], [w, h - 1, w], pivot, color, 0.8));
    out.push(box(bone, [x, 0.5, z], [w, 1, w], pivot, hoof, 0.7));
  }
  return out;
}

export function animalParts(kind: Kind): Part[] {
  if (kind === "pig") {
    const neck: V3 = [0, 11, 7];
    return [
      ...legs(4, 6, 3, 4.5, -4.5, PINK, HOOF),
      box(BONE.body, [0, 10, 0], [10, 8, 14], [0, 10, 0], PINK),
      box(BONE.body, [0, 12, -7.5], [1, 1, 1], [0, 10, 0], PINK_DARK),
      box(BONE.head, [0, 11, 10.5], [8, 8, 8], neck, PINK, 0.95),
      box(BONE.head, [0, 9.5, 15], [4, 3, 1], neck, PINK_DARK, 0.95),
      box(BONE.head, [2.5, 12.5, 14.55], [1, 1, 0.2], neck, EYE, 1),
      box(BONE.head, [-2.5, 12.5, 14.55], [1, 1, 0.2], neck, EYE, 1),
      box(BONE.head, [3, 15.5, 9], [2, 1, 2], neck, PINK_DARK, 0.9),
      box(BONE.head, [-3, 15.5, 9], [2, 1, 2], neck, PINK_DARK, 0.9),
    ];
  }
  if (kind === "hen") {
    const neck: V3 = [0, 9, 3.5];
    return [
      box(BONE.legR, [1.5, 2.5, 0], [1, 4, 1], [1.5, 4, 0], BEAK, 0.85),
      box(BONE.legR, [1.5, 0.5, 0.5], [2, 1, 3], [1.5, 4, 0], BEAK, 0.8),
      box(BONE.legL, [-1.5, 2.5, 0], [1, 4, 1], [-1.5, 4, 0], BEAK, 0.85),
      box(BONE.legL, [-1.5, 0.5, 0.5], [2, 1, 3], [-1.5, 4, 0], BEAK, 0.8),
      box(BONE.body, [0, 7, 0], [6, 6, 8], [0, 7, 0], WHITE),
      box(BONE.body, [0, 9.5, -4.5], [4, 3, 1], [0, 7, 0], WHITE, 0.85),
      // The wings, on the arm bones: a roll lifts them away from the body.
      box(BONE.armR, [3.5, 7.5, -0.5], [1, 4, 6], [3, 9.5, 0], WHITE, 0.85),
      box(BONE.armL, [-3.5, 7.5, -0.5], [1, 4, 6], [-3, 9.5, 0], WHITE, 0.85),
      box(BONE.head, [0, 12, 4.5], [4, 6, 3], neck, WHITE, 0.95),
      box(BONE.head, [0, 12.5, 7], [2, 2, 2], neck, BEAK, 0.95),
      box(BONE.head, [0, 10.5, 6.5], [2, 2, 1], neck, COMB, 0.95),
      box(BONE.head, [0, 15.5, 4.5], [1, 1, 3], neck, COMB, 0.95),
      box(BONE.head, [2.05, 13, 5], [0.2, 1, 1], neck, EYE, 1),
      box(BONE.head, [-2.05, 13, 5], [0.2, 1, 1], neck, EYE, 1),
    ];
  }
  const neck: V3 = [0, 18, 6.5];
  return [
    ...legs(3, 10, 2.5, 5.5, -5.5, CREAM, GOAT_HOOF),
    box(BONE.body, [0, 14.5, 0], [8, 9, 15], [0, 14.5, 0], CREAM),
    box(BONE.body, [0, 18, -8], [2, 3, 1], [0, 14.5, 0], CREAM, 0.85),
    box(BONE.head, [0, 20, 10], [6, 7, 8], neck, CREAM, 0.95),
    box(BONE.head, [0, 18, 14.5], [4, 3, 3], neck, CREAM, 0.95),
    box(BONE.head, [0, 15.5, 12.5], [2, 3, 1], neck, WHITE, 0.95),
    box(BONE.head, [2, 25.5, 8.5], [1, 5, 1], neck, HORN, 0.9),
    box(BONE.head, [-2, 25.5, 8.5], [1, 5, 1], neck, HORN, 0.9),
    box(BONE.head, [3.05, 21, 11], [0.2, 1, 1], neck, EYE, 1),
    box(BONE.head, [-3.05, 21, 11], [0.2, 1, 1], neck, EYE, 1),
  ];
}

/* --- who lives where -------------------------------------------------------- */

/** The herd, and roughly where each lives: by the hoist over the mine's
    ledge, which the way down to the ledge looks across; on the lawn in
    front, under the opening shot; on the tier over the upper portal, which
    the climb out comes up beneath. */
type Home = "hoist" | "lawn" | "cliff";
export const HERD: Array<{ id: string; kind: Kind; home: Home }> = [
  { id: "pig0", kind: "pig", home: "hoist" },
  { id: "pig1", kind: "pig", home: "hoist" },
  { id: "hen0", kind: "hen", home: "lawn" },
  { id: "hen1", kind: "hen", home: "lawn" },
  { id: "hen2", kind: "hen", home: "lawn" },
  { id: "goat0", kind: "goat", home: "cliff" },
  { id: "goat1", kind: "goat", home: "cliff" },
];

const GAIT: Record<Kind, { speed: number; stride: number; rest: [number, number] }> = {
  // Blocks a second, blocks a full stride, and how long a stop lasts.
  pig: { speed: 0.55, stride: 0.9, rest: [2.5, 5.5] },
  hen: { speed: 0.8, stride: 0.45, rest: [1.0, 3.0] },
  goat: { speed: 0.6, stride: 1.2, rest: [2.0, 6.0] },
};

type Leg = { x: number; z: number; yaw: number; len: number; rest: number };
export type Animal = {
  id: string;
  kind: Kind;
  /** The ground the pen is on: its blocks' tops. */
  y: number;
  legs: Leg[];
  cycle: number;
  offset: number;
  /** Whether it lives on the half of the island that slides away. */
  front: boolean;
};

/** Find each home's pen and lay out a wander in it. `busy` is true over a
    grid column something stands on -- the props, the carts, the hoist. */
export function buildHerd(
  terrain: VoxelTerrain,
  busy: (gx: number, gz: number) => boolean,
  cutZ: number,
): Animal[] {
  const N = VOXEL_SIZE;
  const HALF = (N - 1) / 2;
  const cells = terrain.cells;
  const at = (x: number, y: number, z: number) => (y * N + z) * N + x;
  const top = terrain.colTop;
  /* Open: turf, nothing standing on it or within a block of it, three
     blocks of air over it, and every side at the same height -- no step to
     walk off. */
  const open = (x: number, z: number, y: number) => {
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) return false;
    if (top[z * N + x] !== y || cells[at(x, y, z)] !== MATERIAL.grass || busy(x, z)) return false;
    for (let k = 1; k <= 3; k++) if (cells[at(x, y + k, z)] !== EMPTY_CELL) return false;
    return (
      top[z * N + x + 1] === y &&
      top[z * N + x - 1] === y &&
      top[(z + 1) * N + x] === y &&
      top[(z - 1) * N + x] === y
    );
  };
  /** The biggest open rectangle near a point, preferring the nearer. The
      open turf at the level is summed first, so that whether a rectangle is
      all open is four reads rather than a walk over it: this runs in the
      scene's setup, on the main thread, and walking every candidate cost a
      sixth of a second. */
  const W = N + 1;
  const sat = new Int32Array(W * W);
  const penNear = (wx: number, wz: number, y: number) => {
    for (let z = 0; z < N; z++) {
      let row = 0;
      for (let x = 0; x < N; x++) {
        if (open(x, z, y)) row++;
        sat[(z + 1) * W + x + 1] = sat[z * W + x + 1] + row;
      }
    }
    const cx = Math.round(wx + HALF);
    const cz = Math.round(wz + HALF);
    const R = 12;
    let best: { x0: number; z0: number; w: number; d: number; score: number } | null = null;
    for (let w = 9; w >= 3; w--) {
      for (let d = 9; d >= 3; d--) {
        for (let z0 = Math.max(0, cz - R); z0 <= Math.min(N - d, cz + R); z0++) {
          for (let x0 = Math.max(0, cx - R); x0 <= Math.min(N - w, cx + R); x0++) {
            const score = w * d - 0.8 * Math.hypot(x0 + w / 2 - cx, z0 + d / 2 - cz);
            if (best && score <= best.score) continue;
            const n =
              sat[(z0 + d) * W + x0 + w] - sat[z0 * W + x0 + w] - sat[(z0 + d) * W + x0] + sat[z0 * W + x0];
            if (n === w * d) best = { x0, z0, w, d, score };
          }
        }
      }
    }
    return best && { x0: best.x0 - HALF, z0: best.z0 - HALF, w: best.w, d: best.d };
  };

  const s = terrain.site;
  const homes: Record<Home, { x: number; z: number; y: number }> = {
    hoist: { x: s.winch.x - 5, z: s.winch.z + 8, y: s.top },
    lawn: { x: s.half * 0.25, z: s.half * 0.72, y: s.top },
    cliff: { x: s.exit.x - 6, z: s.exit.z - 6, y: Math.round(s.exit.y) + 5 },
  };

  const herd: Animal[] = [];
  for (const home of ["hoist", "lawn", "cliff"] as const) {
    const h = homes[home];
    const pen = penNear(h.x, h.z, h.y);
    if (!pen) continue;
    const members = HERD.filter((a) => a.home === home);
    members.forEach((m, i) => {
      /* A share of the pen each, along its longer side, so two of them
         never walk through each other; kept half a block in from its edge. */
      const alongX = pen.w >= pen.d;
      const share = (alongX ? pen.w : pen.d) / members.length;
      const x0 = pen.x0 + (alongX ? i * share : 0) + 0.25;
      const x1 = pen.x0 + (alongX ? (i + 1) * share : pen.w) - 1.25;
      const z0 = pen.z0 + (alongX ? 0 : i * share) + 0.25;
      const z1 = pen.z0 + (alongX ? pen.d : (i + 1) * share) - 1.25;
      let seed = (herd.length + 1) * 0x9e3779b1;
      const rnd = () => {
        seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
        return seed / 4294967296;
      };
      const g = GAIT[m.kind];
      const pts: Array<[number, number]> = [];
      for (let k = 0; pts.length < 6 && k < 60; k++) {
        const p: [number, number] = [x0 + rnd() * Math.max(0, x1 - x0), z0 + rnd() * Math.max(0, z1 - z0)];
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) continue;
        pts.push(p);
      }
      if (pts.length < 2) pts.push([x1, z1]);
      const legsOut: Leg[] = pts.map((p, k) => {
        const q = pts[(k + 1) % pts.length];
        return {
          x: p[0],
          z: p[1],
          yaw: Math.atan2(q[0] - p[0], q[1] - p[1]),
          len: Math.hypot(q[0] - p[0], q[1] - p[1]),
          rest: g.rest[0] + rnd() * (g.rest[1] - g.rest[0]),
        };
      });
      const cycle = legsOut.reduce((n, l) => n + l.rest + l.len / g.speed, 0);
      herd.push({
        id: m.id,
        kind: m.kind,
        y: h.y + 0.5,
        legs: legsOut,
        cycle,
        offset: rnd() * cycle,
        front: pen.z0 + pen.d > cutZ - 1,
      });
    });
  }
  return herd;
}

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

/** The shortest way round from one heading to another. */
function turn(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const STILL: Pose = {
  body: [0, 0, 0],
  head: [0, 0, 0],
  armR: [0, 0, 0],
  armL: [0, 0, 0],
  legR: [0, 0, 0],
  legL: [0, 0, 0],
  lift: 0,
};

/** Where an animal is at a moment, which way it faces, and how it holds
    itself: walking between points, or stopped -- turning toward the next
    one first, then grazing (pigs, goats) or pecking (hens). */
export function animalAt(a: Animal, t: number) {
  const g = GAIT[a.kind];
  const ph = a.offset;
  let u = (t + a.offset) % a.cycle;
  const n = a.legs.length;
  for (let k = 0; k < n; k++) {
    const l = a.legs[k];
    const prevYaw = a.legs[(k + n - 1) % n].yaw;
    if (u < l.rest) {
      // Stopped: turn to face the next point, then put the head down.
      const yaw = turn(prevYaw, l.yaw, ease(u / Math.min(0.8, l.rest)));
      return { x: l.x, z: l.z, yaw, pose: rest(a.kind, u, l.rest, t, ph) };
    }
    u -= l.rest;
    const dur = l.len / g.speed;
    if (u < dur) {
      // Walking, easing off and on: the feet follow the ground covered.
      const f = ease(u / dur);
      const x = l.x + Math.sin(l.yaw) * l.len * f;
      const z = l.z + Math.cos(l.yaw) * l.len * f;
      const gait = ((l.len * f) / g.stride) * Math.PI * 2;
      return { x, z, yaw: l.yaw, pose: stride(a.kind, gait, t, ph) };
    }
    u -= dur;
  }
  const l = a.legs[0];
  return { x: l.x, z: l.z, yaw: l.yaw, pose: STILL };
}

function stride(kind: Kind, g: number, t: number, ph: number): Pose {
  const s = Math.sin(g);
  if (kind === "hen") {
    return {
      ...STILL,
      // A hen's head bobs forward with every step.
      head: [0.18 * Math.max(0, Math.sin(g * 2)), 0, 0],
      legR: [0.6 * s, 0, 0],
      legL: [-0.6 * s, 0, 0],
      lift: 0.3 * Math.abs(Math.cos(g)),
    };
  }
  const k = kind === "goat" ? 0.45 : 0.5;
  return {
    ...STILL,
    head: [0.05 * Math.sin(g * 2), 0.08 * Math.sin(t * 0.4 + ph), 0],
    armR: [k * s, 0, 0],
    legL: [k * s, 0, 0],
    armL: [-k * s, 0, 0],
    legR: [-k * s, 0, 0],
    lift: 0.35 * Math.abs(Math.cos(g)),
  };
}

function rest(kind: Kind, u: number, len: number, t: number, ph: number): Pose {
  // Head down once turned, and up again just before setting off.
  const down = ease((u - 0.6) / 0.5) * (1 - ease((u - (len - 0.6)) / 0.5));
  if (kind === "hen") {
    // Quick pecks at the ground, a flick of the wings now and then.
    const peck = Math.max(0, Math.sin(t * 9 + ph * 3)) ** 3;
    const flap = Math.max(0, Math.sin(t * 0.9 + ph)) ** 24;
    // A positive roll lifts the right wing out from the body, a negative the left.
    return {
      ...STILL,
      head: [down * (0.5 + 0.9 * peck), 0, 0],
      armR: [0, 0, 0.9 * flap],
      armL: [0, 0, -0.9 * flap],
    };
  }
  /* Nose down to the turf -- a goat stands tall and reaches further -- and,
     while it is up, a slow look about. */
  const graze = kind === "goat" ? 1.05 : 0.8;
  return {
    ...STILL,
    head: [down * (graze + 0.08 * Math.sin(t * 5 + ph)), 0.25 * (1 - down) * Math.sin(t * 0.5 + ph), 0],
  };
}

/** Sixteen pixels to the block, like the crew. */
export const ANIMAL_SCALE = PX;
