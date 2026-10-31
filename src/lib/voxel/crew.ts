import { NET, LOOKS, PALETTE, skinOrigin, type RGB } from "./atlas";

/* ----------------------------------------------------------------------------
   THE CREW

   The people in the mine, as boxes on a rig.

   PROPORTIONS
   Block characters: a cube head, a rectangular body and four limbs, in the
   measurements the genre has settled on -- head 8, body 8x12x4, limbs
   4x12x4 -- in "pixels" that are a sixteenth of a world unit. That makes a
   figure exactly two blocks tall and, more importantly, puts sixteen texels
   to the block on the people exactly as on the terrain. One pixel grid for
   the whole world is a large part of why this style hangs together.

   THE RIG
   Each box belongs to a bone and turns about that bone's joint -- neck,
   shoulder, hip -- by angles computed every frame. The previous figures
   blended every box between two authored positions, which makes limbs SLIDE
   rather than swing: a pick drawn halfway between "raised" and "lowered"
   travels the chord, not the arc, and the head of it passes through the
   man's own shoulder. Rotation about a pivot is the arc.

   Head and arms ride on the body, so a lean carries them with it; the legs
   do not, which is what keeps a figure leaning into a swing standing on its
   feet instead of tipping over at the ankles.
-------------------------------------------------------------------------------*/

export type V3 = [number, number, number];

export const BONE = {
  /** Props: never turned. */
  root: 0,
  body: 1,
  head: 2,
  armR: 3,
  armL: 4,
  legR: 5,
  legL: 6,
} as const;

/** The joint the body leans about, in figure pixels. The shader holds the
    same number. */
export const HIP: V3 = [0, 12, 0];

/** How a box is coloured. */
export const TEX = {
  /** One colour. */
  flat: 0,
  /** Folded from a skin in the atlas, box-net style. */
  skin: 1,
  /** One block tile on every face. */
  tile: 2,
} as const;

export type Part = {
  /** Centre and size, in the figure's local units. */
  at: V3;
  size: V3;
  /** The joint this box turns about. */
  pivot: V3;
  bone: number;
  /** Flat colour, and the colour a textured box fades to far away. */
  color: RGB;
  /** Baked darkening, lower nearer the ground. */
  ao: number;
  /** Self-lit: lamps and glowing ore. */
  emit?: number;
  /** Skin texels per figure pixel. One everywhere but the head, which is ten
      pixels across and sixteen texels. */
  density?: number;
  /** For a tiled box: a different tile on its top face -- turf on a block
      whose sides are grass-over-dirt. */
  top?: number;
  tex?: number;
  /** Skin net origin or tile slot, in atlas pixels / slot number. */
  u?: number;
  v?: number;
};

/** World units per figure pixel: sixteen to the block, like the terrain. */
export const PX = 1 / 16;

const LAMP: RGB = [1.0, 0.86, 0.58];
const WOOD: RGB = [0.48, 0.32, 0.18];
/* Brighter than the rock it works, so the head of a pick reads against a
   dark wall: at one pixel thick and the colour of stone it disappeared from
   every angle but side-on. */
const IRON: RGB = [0.74, 0.76, 0.8];
const IRON_DARK: RGB = [0.3, 0.31, 0.34];

export type Tool = "pick" | "shovel" | "lantern" | "hammer" | "none";

const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** One crew member: body, hard hat, and whatever they are carrying. */
export function character(look: number, tool: Tool): Part[] {
  const L = LOOKS[look % LOOKS.length];
  const [su, sv] = skinOrigin(look % LOOKS.length);
  const skin = (net: readonly number[]) => ({ tex: TEX.skin, u: su + net[0], v: sv + net[1] });
  const HEAD_PIVOT: V3 = [0, 24, 0];
  /* A head of ten pixels, not eight. The bigger head is what reads as a
     PERSON at the distances this scene films from -- at eight the face was
     four pixels on screen in the wide shots, and a face that small is a
     colour, not an expression. */
  const HEAD = 10;
  const top = 24 + HEAD;

  const parts: Part[] = [
    { bone: BONE.legR, at: [2, 6, 0], size: [4, 12, 4], pivot: [2, 12, 0], color: L.trousers, ao: 0.74, ...skin(NET.legR) },
    { bone: BONE.legL, at: [-2, 6, 0], size: [4, 12, 4], pivot: [-2, 12, 0], color: L.trousers, ao: 0.74, ...skin(NET.legL) },
    { bone: BONE.body, at: [0, 18, 0], size: [8, 12, 4], pivot: HIP, color: PALETTE.hivis, ao: 0.9, ...skin(NET.body) },
    { bone: BONE.armR, at: [6, 18, 0], size: [4, 12, 4], pivot: [6, 22, 0], color: L.shirt, ao: 0.86, ...skin(NET.armR) },
    { bone: BONE.armL, at: [-6, 18, 0], size: [4, 12, 4], pivot: [-6, 22, 0], color: L.shirt, ao: 0.86, ...skin(NET.armL) },
    { bone: BONE.head, at: [0, 24 + HEAD / 2, 0], size: [HEAD, HEAD, HEAD], pivot: HEAD_PIVOT, color: L.skin, ao: 0.96, density: 16 / HEAD, ...skin(NET.head) },
    /* The hard hat: a dome a pixel proud of the head, a brim that reaches
       further forward than back, and a lamp on the front. Sits over the top
       rows of the face, which is why the face starts below them. */
    { bone: BONE.head, at: [0, top + 0.7, 0], size: [HEAD + 1, 2.6, HEAD + 1], pivot: HEAD_PIVOT, color: L.helmet, ao: 1 },
    { bone: BONE.head, at: [0, top - 0.6, 0.7], size: [HEAD + 2, 0.7, HEAD + 2.4], pivot: HEAD_PIVOT, color: scale(L.helmet, 0.88), ao: 0.97 },
    { bone: BONE.head, at: [0, top + 0.5, HEAD / 2 + 0.95], size: [2.6, 1.8, 0.9], pivot: HEAD_PIVOT, color: LAMP, ao: 1, emit: 1 },
  ];

  /* Tools hang from the hand and turn with the arm, so a swing of the arm IS
     a swing of the pick. The handle runs down past the hand along the arm's
     own line and the head sits across the far end of it: hanging, the pick
     rests by the boot; raised overhead it points back over the shoulder; at
     the bottom of the arc the head is out in front, where the rock is. */
  const R_SHOULDER: V3 = [6, 22, 0];
  const L_SHOULDER: V3 = [-6, 22, 0];
  if (tool === "pick") {
    parts.push(
      { bone: BONE.armR, at: [6, 7.5, 0], size: [1.4, 13, 1.4], pivot: R_SHOULDER, color: WOOD, ao: 0.86 },
      { bone: BONE.armR, at: [6, 2.0, 0.5], size: [1.8, 1.9, 11], pivot: R_SHOULDER, color: IRON, ao: 0.94 },
      { bone: BONE.armR, at: [6, 1.1, -5.4], size: [1.2, 1.0, 1.0], pivot: R_SHOULDER, color: IRON_DARK, ao: 0.9 },
      { bone: BONE.armR, at: [6, 1.1, 6.4], size: [1.2, 1.0, 1.0], pivot: R_SHOULDER, color: IRON_DARK, ao: 0.9 },
      { bone: BONE.armR, at: [6, 2.0, 0], size: [1.6, 2.2, 1.6], pivot: R_SHOULDER, color: IRON_DARK, ao: 0.88 },
    );
  } else if (tool === "shovel") {
    parts.push(
      { bone: BONE.armR, at: [6, 8.5, 0], size: [1, 13, 1], pivot: R_SHOULDER, color: WOOD, ao: 0.86 },
      { bone: BONE.armR, at: [6, 1.6, 0.6], size: [1.0, 3.2, 3.2], pivot: R_SHOULDER, color: IRON, ao: 0.92 },
    );
  } else if (tool === "hammer") {
    /* A smith's hammer: a short haft and a heavy head across its end, held
       the way the pick is so the same arm swing drives it. */
    parts.push(
      { bone: BONE.armR, at: [6, 4.5, 0.4], size: [1.2, 8, 1.2], pivot: R_SHOULDER, color: WOOD, ao: 0.86 },
      { bone: BONE.armR, at: [6, 1.2, 1.4], size: [2.4, 2.4, 4.2], pivot: R_SHOULDER, color: IRON_DARK, ao: 0.92 },
    );
  } else if (tool === "lantern") {
    parts.push(
      { bone: BONE.armL, at: [-6, 11.0, 0], size: [0.6, 1.6, 0.6], pivot: L_SHOULDER, color: IRON_DARK, ao: 0.9 },
      { bone: BONE.armL, at: [-6, 10.0, 0], size: [3.2, 0.8, 3.2], pivot: L_SHOULDER, color: IRON_DARK, ao: 0.92 },
      { bone: BONE.armL, at: [-6, 8.1, 0], size: [2.6, 3.0, 2.6], pivot: L_SHOULDER, color: LAMP, ao: 1, emit: 1 },
      { bone: BONE.armL, at: [-6, 6.3, 0], size: [3.2, 0.7, 3.2], pivot: L_SHOULDER, color: IRON_DARK, ao: 0.88 },
    );
  }
  return parts;
}

/* --- animation ---------------------------------------------------------------
   Every clip is a pure function of the clock (and, for story beats, of the
   scroll). Nothing integrates and nothing remembers, so scrolling back to a
   frame gives the same arrangement of limbs it had the first time.

   Angles are (pitch, yaw, roll) in radians. Negative pitch raises a limb
   FORWARD: an arm at -pi/2 points straight ahead. */
export type Pose = {
  body: V3;
  head: V3;
  armR: V3;
  armL: V3;
  legR: V3;
  legL: V3;
  /** Feet off the ground, in figure pixels: a hop. */
  lift: number;
};

export type ClipName =
  | "idle"
  | "point"
  | "work"
  | "lantern"
  | "swing"
  | "shovel"
  | "push"
  | "cheer"
  | "walk"
  | "wave"
  | "sit"
  | "hammer";

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
};

function idle(t: number, ph: number): Pose {
  const breath = Math.sin(t * 1.6 + ph);
  return {
    body: [0.02 * breath, 0, 0],
    // Looking about, slowly. Most of what makes a still figure read as alive.
    head: [0.06 * Math.sin(t * 0.8 + ph), 0.35 * Math.sin(t * 0.33 + ph * 1.7), 0],
    armR: [-0.06 + 0.04 * breath, 0, -0.05],
    armL: [-0.06 - 0.04 * breath, 0, 0.05],
    legR: [0, 0, 0],
    legL: [0, 0, 0],
    lift: 0,
  };
}

/** A pick swing, `u` from 0 to 1 over the whole stroke. The blow lands at
    0.59 -- the same fraction of the stroke the mining interaction waits for
    before it cracks the stone -- so the head reaches the rock on the frame
    the rock reacts. */
export const SWING_IMPACT = 0.59;
export function swingArm(u: number): number {
  const REST = -0.3;
  const UP = -3.25;
  const HIT = -0.95;
  if (u < 0.45) return REST + (UP - REST) * ease(u / 0.45);
  if (u < SWING_IMPACT) {
    // Accelerating into the blow: the strike is the fast part.
    const k = (u - 0.45) / (SWING_IMPACT - 0.45);
    return UP + (HIT - UP) * k * k;
  }
  if (u < 0.75) return HIT - 0.12 * Math.sin(((u - SWING_IMPACT) / (0.75 - SWING_IMPACT)) * Math.PI);
  return HIT + (REST - HIT) * ease((u - 0.75) / 0.25);
}

function swing(u: number, t: number, ph: number): Pose {
  const arm = swingArm(u);
  const lean =
    u < 0.45
      ? -0.15 * ease(u / 0.45)
      : u < SWING_IMPACT
        ? -0.15 + 0.4 * ((u - 0.45) / (SWING_IMPACT - 0.45))
        : 0.25 * (1 - ease((u - SWING_IMPACT) / (1 - SWING_IMPACT)));
  return {
    body: [lean, 0, 0],
    head: [0.15 * Math.max(0, lean), 0.05 * Math.sin(t * 0.7 + ph), 0],
    // Two hands on the haft: the left follows the right and turns inward.
    armR: [arm, 0, -0.08],
    armL: [arm * 0.9, 0, 0.32],
    // A working stance, one foot forward.
    legR: [0.25, 0, 0],
    legL: [-0.25, 0, 0],
    lift: 0,
  };
}

/** A walk, `g` the gait's phase in radians: one turn is a full stride, a
    step on each foot. Driven by distance covered rather than by the clock
    for anyone walking with the cart, so the feet keep pace with the ground
    and stop when the cart does. */
function walk(g: number, t: number, ph: number): Pose {
  const s = Math.sin(g);
  return {
    // A little forward lean and a little sway from foot to foot.
    body: [0.08, 0, 0.035 * s],
    head: [0.04, 0.1 * Math.sin(t * 0.5 + ph), -0.02 * s],
    // Arms swing against the legs on the same side.
    armR: [-0.5 * s - 0.05, 0, -0.06],
    armL: [0.5 * s - 0.05, 0, 0.06],
    legR: [0.62 * s, 0, 0],
    legL: [-0.62 * s, 0, 0],
    // Highest as the legs pass each other, twice a stride.
    lift: 0.7 * Math.abs(Math.cos(g)),
  };
}

/* A hammer stroke, `u` 0 to 1 over the period: raised, brought down onto the
   anvil, a short bounce, and back up. Quicker than a pick and from the
   elbow rather than overhead -- a smith taps; a miner swings. */
function hammer(u: number): number {
  const UP = -2.05;
  const HIT = -0.78;
  if (u < 0.5) return HIT + (UP - HIT) * ease(u / 0.5);
  if (u < 0.62) {
    const k = (u - 0.5) / 0.12;
    return UP + (HIT - UP) * k * k;
  }
  return HIT - 0.1 * Math.sin(((u - 0.62) / 0.38) * Math.PI);
}

export function blend(a: Pose, b: Pose, k: number): Pose {
  const m = (x: V3, y: V3): V3 => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  return {
    body: m(a.body, b.body),
    head: m(a.head, b.head),
    armR: m(a.armR, b.armR),
    armL: m(a.armL, b.armL),
    legR: m(a.legR, b.legR),
    legL: m(a.legL, b.legL),
    lift: a.lift + (b.lift - a.lift) * k,
  };
}

/** A clip at a time. `phase` staggers figures sharing a clip; `period` sets
    the rhythm of cyclic ones; `u` drives a swing directly (or is negative
    when there is no swing in flight); `amount` blends story beats in; `gait`
    is a walk's phase when something other than the clock sets the pace, and
    `lamp` keeps a lantern held up while walking. */
export function clip(
  name: ClipName,
  t: number,
  opts: { phase?: number; period?: number; u?: number; amount?: number; gait?: number; lamp?: boolean } = {},
): Pose {
  const ph = opts.phase ?? 0;
  const base = idle(t, ph);
  switch (name) {
    case "idle":
      return base;
    case "point": {
      /* Pointing for a few seconds, lowering the arm, pointing again: a
         surveyor calling a line, not a statue holding one up. */
      const k = ease(0.5 + 0.9 * Math.sin(t * 0.45 + ph));
      const point: Pose = { ...base, armR: [-1.5 + 0.04 * Math.sin(t * 2.1 + ph), 0.1, 0], head: [-0.05, 0.12, 0] };
      return blend(base, point, k * (opts.amount ?? 1));
    }
    case "work": {
      // Bent over something at waist height, both hands busy.
      const w = Math.sin(t * 3.2 + ph);
      return {
        ...base,
        body: [0.55, 0, 0],
        head: [-0.35, 0.1 * Math.sin(t * 0.6 + ph), 0],
        armR: [-0.95 + 0.3 * w, 0, -0.1],
        armL: [-0.95 - 0.3 * w, 0, 0.1],
        legR: [-0.12, 0, 0],
        legL: [0.1, 0, 0],
      };
    }
    case "lantern":
      // Lamp held up and out, looking where it shines.
      return { ...base, armL: [-1.15 + 0.04 * Math.sin(t * 1.3 + ph), 0, 0.12], head: [0.18, base.head[1] * 0.5, 0] };
    case "swing": {
      const u = opts.u ?? -1;
      if (u >= 0 && u <= 1) return swing(u, t, ph);
      /* Between blows: an ambient swinger has a rest in his cycle, and the
         man the visitor directs stands ready, pick held low. */
      return { ...base, armR: [-0.3, 0, -0.08], armL: [-0.25, 0, 0.2], legR: [0.2, 0, 0], legL: [-0.2, 0, 0] };
    }
    case "shovel": {
      const s = 0.5 - 0.5 * Math.cos(((t + ph) / (opts.period ?? 2.6)) * Math.PI * 2);
      const scoop: Pose = { ...base, body: [0.5, 0, 0], head: [-0.3, 0, 0], armR: [-0.55, 0, -0.1], armL: [-0.7, 0, 0.25], legR: [0.2, 0, 0], legL: [-0.25, 0, 0] };
      const lift: Pose = { ...base, body: [-0.05, 0, 0], head: [0.05, 0, 0], armR: [-1.9, 0, -0.1], armL: [-1.7, 0, 0.25], legR: [0.2, 0, 0], legL: [-0.25, 0, 0] };
      return blend(scoop, lift, ease(s));
    }
    case "push": {
      const w = Math.sin(opts.gait ?? t * 7 + ph);
      const pushing: Pose = {
        ...base,
        body: [0.42, 0, 0],
        head: [-0.3, 0, 0],
        armR: [-1.25, 0, -0.08],
        armL: [-1.25, 0, 0.08],
        legR: [0.55 * w, 0, 0],
        legL: [-0.55 * w, 0, 0],
        lift: 0.5 * Math.abs(Math.cos(opts.gait ?? t * 7 + ph)),
      };
      // Stopped, leaning on the cart rather than walking on the spot.
      const resting: Pose = {
        ...base,
        body: [0.22, 0, 0],
        head: [-0.12, base.head[1] * 0.6, 0],
        armR: [-1.05, 0, -0.08],
        armL: [-1.05, 0, 0.08],
      };
      return blend(resting, pushing, opts.amount ?? 1);
    }
    case "walk": {
      /* Walking with something in the left hand if there is a lamp: the
         lantern clip's arm, the walk's legs. Blended toward standing as the
         cart that sets the pace slows to a stop. */
      const g = opts.gait ?? t * 6;
      const w = walk(g, t, ph);
      const held: Pose = opts.lamp ? { ...w, armL: [-1.15 + 0.04 * Math.sin(t * 1.3 + ph), 0, 0.12] } : w;
      return blend(base, held, opts.amount ?? 1);
    }
    case "wave": {
      /* One arm up and waving from the elbow, at someone a long way off --
         the visitor, arriving. */
      const a = opts.amount ?? 1;
      const up: Pose = {
        ...base,
        body: [-0.05, 0, 0],
        head: [-0.12, base.head[1] * 0.25, 0],
        armR: [-2.75, 0, -0.32 + 0.38 * Math.sin(t * 7.5 + ph)],
      };
      return blend(base, up, a);
    }
    case "sit": {
      // Sitting with the legs out in front, hands on the knees, looking about.
      return {
        ...base,
        body: [-0.06 + base.body[0], 0, 0],
        armR: [-0.62, 0, -0.12],
        armL: [-0.58, 0, 0.12],
        legR: [-1.45, 0, 0.04],
        legL: [-1.45, 0, -0.04],
        // Down onto the seat: the hips go to where the knees were.
        lift: -4,
      };
    }
    case "hammer": {
      const period = opts.period ?? 0.95;
      const u = (((t + ph) / period) % 1 + 1) % 1;
      return {
        ...base,
        body: [0.32, 0, 0],
        head: [-0.32, 0.05 * Math.sin(t * 0.7 + ph), 0],
        armR: [hammer(u), 0, -0.1],
        // The other hand holds the work on the anvil.
        armL: [-0.95, 0, 0.18],
        legR: [0.18, 0, 0],
        legL: [-0.18, 0, 0],
      };
    }
    case "cheer": {
      const a = opts.amount ?? 1;
      const up: Pose = {
        ...base,
        head: [-0.25, base.head[1] * 0.3, 0],
        armR: [-2.95 + 0.12 * Math.sin(t * 9 + ph), 0, -0.38],
        armL: [-2.95 + 0.12 * Math.sin(t * 9 + ph + 1.3), 0, 0.38],
        lift: Math.abs(Math.sin(t * 5 + ph)) * 1.4,
      };
      return blend(base, up, a);
    }
  }
}
