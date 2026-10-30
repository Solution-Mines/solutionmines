import {
  MINER_PARTS,
  MINER_RAISED,
  pose,
  P_POINT,
  P_CROUCH,
  P_PUSH,
  P_LIFT,
  P_STRIDE_A,
  P_STRIDE_B,
  P_NO_TOOL,
  P_LANTERN,
  LANTERN_BOX,
  type MinerPart,
} from "./miner";
import type { MineInfo } from "./terrain";
import { ACTS, alongRail, type RailPoint } from "./journey";

/** How tall a figure stands, in world units -- almost exactly two terrain
    blocks.

    This number is the whole experiment. Nothing in this scene has ever had a
    known size -- a 48-block island could be a model on a desk or a county --
    and a figure of a known height is the cheapest way to settle it.

    2.3 is measured, not guessed, and the first guess was wrong. Dividing the
    height by the distance gave 55px, and that silently assumes the figure
    stands square to the view ray -- true at eye level, false for a camera
    looking 42 degrees down into a pit, where a standing figure is
    foreshortened by a third. Projecting the feet and the top of the helmet
    SEPARATELY gives 40px at two units. 2.3 puts it at 46, mid-band, and
    40-63 across the whole approach. */
export const MINER_HEIGHT = 2.3;

/* ----------------------------------------------------------------------------
   THE CAST, AND EVERYTHING ELSE MADE OF BOXES

   One instanced draw for the whole population of the mine: nine figures, a
   cart, the rail road, the lanterns and the loose gear at the rim.

   WHY ONE DRAW AND NOT NINE
   The previous version gave each figure its own Geometry and Program, which
   is the obvious way and costs a draw call and a full uniform upload per
   person. That is affordable for two and silly for a dozen, and it also makes
   the thing impossible: OGL keeps uniforms on the Program, so two figures
   sharing a program share a pose. Pushing position, facing and pose down to
   per-instance attributes removes both problems at once -- everyone animates
   independently, and the crowd costs exactly as much as one figure did.

   WHY THE POSES ARE PER-INSTANCE TOO
   Each box carries BOTH of the poses its own figure is blended between, so
   different figures can be blended between different pairs. The man at the
   face swings between rest and wound-up; the man at the cart rocks between
   leaning and upright; the pair in the cavern go from standing to arms up.
   One `uPose`-shaped number per figure drives all of them, and the shader
   never needs to know which pose pair it is looking at.

   WHAT IS AND IS NOT A FIGURE
   Anything that has to move, or is small enough that the terrain grid would
   be too coarse for it. The rails are a figure because a rail is a tenth of
   a block thick. The crystal formation is NOT -- it is nine blocks tall, it
   is landscape, and it belongs on the terrain grid where the culling and the
   ore shading already handle it.
-------------------------------------------------------------------------------*/

export type Box = MinerPart;
export type V3 = [number, number, number];

/** A figure: a list of boxes in two poses, same length, same order. */
export type FigureDef = {
  id: string;
  a: Box[];
  b: Box[];
  /** Local units to world units. Props are authored in world units already. */
  scale: number;
};

/* --- the crew ---------------------------------------------------------------
   Not nine copies of one man. Three jacket colours and three trouser shades,
   assigned per figure, which at this distance is the entire difference
   between a crew and a duplicated asset. The hi-vis band and the helmet stay
   exactly as they are on every one of them: it is the site's accent colour
   and the one thing that should read as uniform. */
const JACKETS: V3[] = [
  [0.24, 0.27, 0.32],
  [0.2, 0.3, 0.3],
  [0.3, 0.26, 0.26],
];
const TROUSERS: V3[] = [
  [0.17, 0.19, 0.23],
  [0.15, 0.2, 0.21],
  [0.21, 0.19, 0.18],
];

/** The height of the figure as it stands, tool excluded -- the one number
    every member of the crew is sized against. */
const STANDING_HEIGHT = figureHeight(MINER_PARTS);

/** Which parts are jacket and which are trouser, by index into MINER_PARTS. */
const JACKET_AT = [4, 7, 8];
const TROUSER_AT = [2, 3];

function recolour(parts: Box[], variant: number): Box[] {
  const jacket = JACKETS[variant % JACKETS.length];
  const trouser = TROUSERS[variant % TROUSERS.length];
  return parts.map((p, i) =>
    JACKET_AT.includes(i)
      ? { ...p, color: jacket }
      : TROUSER_AT.includes(i)
        ? { ...p, color: trouser }
        : p,
  );
}

/** A figure from two pose overrides, recoloured, optionally carrying a lamp. */
function miner(
  id: string,
  a: Box[],
  b: Box[],
  variant: number,
  lantern = false,
): FigureDef {
  const ra = recolour(a, variant);
  const rb = recolour(b, variant);
  // Appended to both poses, so the two lists stay the same length.
  const poseA = lantern ? [...ra, LANTERN_BOX] : ra;
  const poseB = lantern ? [...rb, LANTERN_BOX] : rb;
  return {
    id,
    a: poseA,
    b: poseB,
    /* Normalised against the STANDING figure, always -- never against this
       figure's own first pose.

       Normalising per pose scales each figure until that pose is 2.3 units
       tall, so the two crouching members of the crew came out at 2.97 and
       were, as people, a head taller than everybody else. Crouching makes a
       person shorter; it does not make them bigger. */
    scale: MINER_HEIGHT / STANDING_HEIGHT,
  };
}

/* --- the cart ---------------------------------------------------------------
   Authored in world units: one unit is one terrain block, so the body is
   about a block and a half long and comes up to the waist of a figure
   standing beside it. Long axis along +Z, which is the direction the shader
   calls forward -- the same convention the figures use, so one facing angle
   places either of them.

   Pose A is empty and pose B is loaded. The load is the same box in both,
   sized to nothing in A: the two poses have to agree on their box count, and
   a degenerate box draws no pixels. */
const CART_BODY: V3 = [0.3, 0.32, 0.36];
const CART_IRON: V3 = [0.17, 0.18, 0.21];
const CART_ORE: V3 = [0.28, 0.66, 0.78];

function cart(): FigureDef {
  const frame: Box[] = [
    { at: [0, 0.4, 0], size: [0.95, 0.14, 1.5], color: CART_BODY, ao: 0.8 },
    { at: [-0.45, 0.66, 0], size: [0.1, 0.52, 1.5], color: CART_BODY, ao: 0.86 },
    { at: [0.45, 0.66, 0], size: [0.1, 0.52, 1.5], color: CART_BODY, ao: 0.86 },
    { at: [0, 0.66, -0.7], size: [1.0, 0.52, 0.1], color: CART_BODY, ao: 0.82 },
    { at: [0, 0.66, 0.7], size: [1.0, 0.52, 0.1], color: CART_BODY, ao: 0.9 },
    // A band of iron round the top, so the silhouette has an edge on it.
    { at: [0, 0.93, 0], size: [1.04, 0.08, 1.56], color: CART_IRON, ao: 0.95 },
    { at: [-0.44, 0.18, -0.45], size: [0.16, 0.3, 0.3], color: CART_IRON, ao: 0.6 },
    { at: [0.44, 0.18, -0.45], size: [0.16, 0.3, 0.3], color: CART_IRON, ao: 0.6 },
    { at: [-0.44, 0.18, 0.45], size: [0.16, 0.3, 0.3], color: CART_IRON, ao: 0.6 },
    { at: [0.44, 0.18, 0.45], size: [0.16, 0.3, 0.3], color: CART_IRON, ao: 0.6 },
  ];
  const empty: Box = {
    at: [0, 0.86, 0],
    size: [0, 0, 0],
    color: CART_ORE,
    ao: 1,
    emit: 1,
  };
  const load: Box = { ...empty, size: [0.76, 0.3, 1.2] };
  // A second, smaller heap on top, so the load is not a flat lid.
  const empty2: Box = { ...empty, at: [0, 1.0, -0.1], size: [0, 0, 0] };
  const load2: Box = { ...empty2, size: [0.46, 0.2, 0.7] };
  return {
    id: "cart",
    a: [...frame, empty, empty2],
    b: [...frame, load, load2],
    scale: 1,
  };
}

/* --- the fixed gear ---------------------------------------------------------
   Rails, sleepers, lanterns and the loose equipment at the rim. All of it in
   WORLD coordinates with the figure's origin at zero, because none of it
   moves and giving each lantern its own origin would mean a figure per
   lantern. One span, written once, never touched again. */
const SLEEPER: V3 = [0.3, 0.21, 0.13];
const RAIL: V3 = [0.42, 0.44, 0.47];
const POST: V3 = [0.4, 0.27, 0.15];
const FLAME: V3 = [1.0, 0.78, 0.42];
const CRATE: V3 = [0.42, 0.29, 0.16];

/** Half the gauge. The cart's wheels sit at the same offset. */
export const GAUGE = 0.44;

export type { RailPoint };

/** The rail road, from the chamber up the incline and out to the cavern.

    One pair of short rails and a sleeper per point rather than long boxes per
    straight run. The way climbs a block at a time, and a single box spanning
    a step either floats at one end or is buried at the other; a rail per
    block sits on its own floor and the steps read as the incline they are. */
function road(points: RailPoint[], dx: number, dz: number): Box[] {
  const out: Box[] = [];
  // Perpendicular to the run, in the ground plane.
  const px = -dz;
  const pz = dx;
  // The block's centre is its integer y, so its top face is half a unit up.
  const lift = 0.5;
  points.forEach((p, i) => {
    const long: V3 = [
      Math.abs(dx) > 0 ? 1.04 : 0.14,
      0.1,
      Math.abs(dz) > 0 ? 1.04 : 0.14,
    ];
    for (const side of [-1, 1]) {
      out.push({
        at: [p.x + px * side * GAUGE, p.y + lift + 0.11, p.z + pz * side * GAUGE],
        size: long,
        color: RAIL,
        ao: 0.84,
      });
    }
    if (i % 2 === 0) {
      out.push({
        at: [p.x, p.y + lift + 0.045, p.z],
        size: [
          Math.abs(dx) > 0 ? 0.3 : 1.22,
          0.09,
          Math.abs(dz) > 0 ? 0.3 : 1.22,
        ],
        color: SLEEPER,
        ao: 0.7,
      });
    }
  });
  return out;
}

/** A lantern on a short post against the wall. The flame box is self-lit;
    the shared lighting function already has an emissive channel for the
    ores, and reusing it is what keeps one exposure for the whole scene. */
function lantern(x: number, y: number, z: number): Box[] {
  return [
    { at: [x, y + 0.45, z], size: [0.12, 0.9, 0.12], color: POST, ao: 0.6 },
    { at: [x, y + 0.95, z], size: [0.26, 0.3, 0.26], color: POST, ao: 0.8 },
    { at: [x, y + 0.95, z], size: [0.18, 0.22, 0.3], color: FLAME, ao: 1, emit: 1 },
  ];
}

function crate(x: number, y: number, z: number, s = 0.62): Box[] {
  return [
    { at: [x, y + s / 2, z], size: [s, s, s], color: CRATE, ao: 0.72 },
    // A lid band, for the same reason the cart has one: an edge to read.
    { at: [x, y + s * 0.92, z], size: [s * 1.06, s * 0.1, s * 1.06], color: POST, ao: 0.8 },
  ];
}

/* --- how a figure is driven -------------------------------------------------
   Four kinds, and no more. Each is a pure function of either the clock or the
   scroll, which is what keeps the scene reproducible: scrubbing back to a
   progress gives the same arrangement of people it gave on the way down. */
export type Role =
  | { kind: "still"; at?: number }
  /** Wind up, strike, hold. The blow lands partway through the arc. */
  | { kind: "swing"; period: number; phase: number }
  /** A smooth there-and-back: walking, rocking, shovelling. */
  | { kind: "cycle"; period: number; phase: number }
  /** Pose follows the scroll between two progresses. The reaction in the
      cavern, which has to happen when the visitor arrives and not before. */
  | { kind: "scroll"; from: number; to: number };

export type CastMember = {
  id: string;
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
  role: Role;
  /** Sits on the rails instead of on the ground. */
  onRail?: boolean;
};

export type Scene = {
  defs: FigureDef[];
  cast: CastMember[];
  /** The rail road's centre line, in world units. */
  rail: RailPoint[];
};

/** Every figure, prop and placement the mine needs, derived from the dig.

    Nothing here is a literal coordinate. The pit, the drift and the cavern
    all move when the island is reseeded, and a cast placed by hand would be
    standing in mid-air the first time that happened. */
export function buildScene(mine: MineInfo): Scene {
  const [dx, dz] = mine.driftDir;
  const px = -dz;
  const pz = dx;
  const rail = mine.drift;
  const mouth = rail[0];
  const end = rail[rail.length - 1];
  const cav = mine.cavern;

  const props: Box[] = [
    ...road(rail, dx, dz),
    // A lantern every fourth set down the drift, on alternating walls.
    ...rail.flatMap((p, i) =>
      i % 4 === 2
        ? lantern(
            p.x + px * (i % 8 === 2 ? 2.1 : -2.1),
            p.y + 0.5,
            p.z + pz * (i % 8 === 2 ? 2.1 : -2.1),
          )
        : [],
    ),
    // Two at the working face, so the chamber is lit by something visible.
    ...lantern(mouth.x + px * 2.0, mouth.y + 0.5, mouth.z + pz * 2.0),
    ...lantern(mouth.x - px * 2.0, mouth.y + 0.5, mouth.z - pz * 2.0),
    // Gear at the head of the incline, where a crew would actually leave it.
    ...crate(mouth.x + dx * 1.4 + px * 1.5, mouth.y + 0.5, mouth.z + dz * 1.4 + pz * 1.5),
    ...crate(mouth.x + dx * 2.2 + px * 1.6, mouth.y + 0.5, mouth.z + dz * 2.2 + pz * 1.6, 0.46),
    // And two at the rim of the pit, by the surveyors.
    ...crate(mine.x + 9.5, mine.rimY + 0.5, mine.z + 7.2),
    ...crate(mine.x + 10.4, mine.rimY + 0.5, mine.z + 7.6, 0.44),
  ];

  const defs: FigureDef[] = [
    { id: "props", a: props, b: props, scale: 1 },
    cart(),
    // At the rim: one calling the line of the pit, one down at the gear.
    miner("surveyor", pose(), pose(P_POINT), 0),
    miner("rigger", pose(P_CROUCH), pose(P_CROUCH, P_LIFT), 1),
    // Going down: lamp held up, walking.
    miner(
      "bearer",
      pose(P_STRIDE_A, P_LANTERN, P_NO_TOOL),
      pose(P_STRIDE_B, P_LANTERN, P_NO_TOOL),
      2,
      true,
    ),
    // At the face: two picks, out of phase, and one loading.
    miner("faceA", pose(), MINER_RAISED, 0),
    miner("faceB", pose(), MINER_RAISED, 2),
    miner("loader", pose(P_CROUCH, P_NO_TOOL), pose(P_LIFT, P_NO_TOOL), 1),
    // On the road: leaning into the cart.
    miner("pusher", pose(P_PUSH, P_NO_TOOL), pose(P_STRIDE_A, P_NO_TOOL), 0),
    // In the cavern, in front of the find.
    miner("finderA", pose(P_NO_TOOL), pose(P_LIFT, P_NO_TOOL), 2),
    miner("finderB", pose(P_POINT), pose(P_POINT), 1),
  ];

  /* The working face. The one block a visitor can break is picked by the
     generator, so everybody who is meant to be working ON it is placed from
     it rather than from a coordinate -- and the two of them stand to either
     side of the camera's line to it rather than in front of it. */
  const t = mine.target;
  const faceX = t ? t.x : mine.x;
  const faceZ = t ? t.z : mine.z;
  /* Out of the wall, and across it.

     The first version offset these two along the DRIFT's perpendicular,
     which is a different axis entirely -- it put one of them 0.4 of a block
     from the rock face, i.e. inside it. The block presents one face to the
     room and the only axes that mean anything here are that face and the
     perpendicular to it. */
  const fx = t ? t.face[0] : -1;
  const fz = t ? t.face[2] : 0;
  const sx = -fz;
  const sz = fx;

  const cast: CastMember[] = [
    {
      id: "surveyor",
      x: mine.x + 10.5,
      z: mine.z + 5.5,
      groundFrom: mine.rimY + 4,
      lookX: mine.x,
      lookZ: mine.z,
      from: 0,
      to: ACTS[2].from + 0.02,
      role: { kind: "cycle", period: 5.5, phase: 0 },
    },
    {
      id: "rigger",
      x: mine.x + 9.0,
      z: mine.z + 7.6,
      groundFrom: mine.rimY + 4,
      lookX: mine.x + 9.5,
      lookZ: mine.z + 7.2,
      from: 0,
      to: ACTS[2].from + 0.02,
      role: { kind: "cycle", period: 3.4, phase: 1.1 },
    },
    {
      id: "bearer",
      x: mine.x + 2.4,
      z: mine.z + 2.4,
      groundFrom: mine.floorY + 2,
      lookX: mine.x,
      lookZ: mine.z,
      from: ACTS[1].at,
      to: ACTS[3].from + 0.04,
      role: { kind: "cycle", period: 1.25, phase: 0 },
    },
    {
      id: "faceA",
      /* Within reach of the block, and no further.

         Two numbers pulling against each other. The chamber is domed, so it
         narrows as it rises and a figure tucked right against the face has
         no floor under him at the seam's own height. But at 3.4 out and 1.4
         across he stood nearly four units from a block he is supposed to be
         breaking, and the swing stopped reading as the cause of the crack --
         which is the one thing this whole interaction is for. Two out and
         under one across is the closest the occupancy grid allows with floor
         under him and headroom over him. */
      x: faceX + fx * 2.0 + sx * 0.8,
      z: faceZ + fz * 2.0 + sz * 0.8,
      groundFrom: (t ? t.y : mine.chamberFloorY) + 3,
      lookX: faceX,
      lookZ: faceZ,
      from: ACTS[3].from - 0.04,
      to: ACTS[4].from + 0.06,
      /* Still, until the visitor swings him.

         He is the one at the block that can actually be broken, and a figure
         already swinging on his own makes the visitor's strike read as
         something that happened to coincide with a click. The man beside him
         keeps working throughout, which is what stops the face looking
         abandoned while nobody is interacting. */
      role: { kind: "still", at: 0 },
    },
    {
      id: "faceB",
      /* Clear of the man at the head of the incline, who is working the
         same corner of the room. Two figures at the same spot read as one
         figure with a rendering fault. */
      x: faceX + fx * 2.6 - sx * 2.4,
      z: faceZ + fz * 2.6 - sz * 2.4,
      groundFrom: (t ? t.y : mine.chamberFloorY) + 3,
      lookX: faceX,
      lookZ: faceZ,
      from: ACTS[3].from - 0.04,
      to: ACTS[4].from + 0.06,
      role: { kind: "swing", period: 2.4, phase: 1.05 },
    },
    {
      id: "loader",
      x: mouth.x + dx * 0.4 + px * 1.3,
      z: mouth.z + dz * 0.4 + pz * 1.3,
      groundFrom: mouth.y + 3,
      lookX: mouth.x,
      lookZ: mouth.z,
      from: ACTS[3].from - 0.04,
      to: ACTS[5].at,
      role: { kind: "cycle", period: 2.6, phase: 0.4 },
    },
    {
      id: "pusher",
      // Placed on the rails each frame, behind the cart.
      x: end.x,
      z: end.z,
      groundFrom: end.y + 3,
      lookX: mouth.x,
      lookZ: mouth.z,
      from: ACTS[5].from,
      to: ACTS[6].from + 0.03,
      role: { kind: "cycle", period: 1.1, phase: 0 },
      onRail: true,
    },
    {
      id: "finderA",
      /* Between the way in and the formation, never inside it. The cluster
         is nine blocks across and the first placement put one of them in the
         middle of a spire, standing on top of it at roof height. */
      x: cav.x - dx * 1.0 + px * 1.3,
      z: cav.z - dz * 1.0 + pz * 1.3,
      groundFrom: cav.roofY,
      lookX: mine.crystal.x,
      lookZ: mine.crystal.z,
      from: ACTS[4].from,
      to: ACTS[6].from,
      role: { kind: "scroll", from: ACTS[4].at - 0.02, to: ACTS[4].to },
    },
    {
      id: "finderB",
      x: cav.x - dx * 0.2 - px * 2.4,
      z: cav.z - dz * 0.2 - pz * 2.4,
      groundFrom: cav.roofY,
      lookX: mine.crystal.x,
      lookZ: mine.crystal.z,
      from: ACTS[4].from,
      to: ACTS[6].from,
      role: { kind: "still", at: 1 },
    },
  ];

  return { defs, cast, rail };
}

/* --- the batch --------------------------------------------------------------
   Flat arrays, one entry per box. The first seven never change after the
   build; the last two are rewritten every frame from the figures' current
   positions and poses, which is two small buffer uploads for the entire
   population. */
export type FigureBatch = {
  part: Float32Array;
  size: Float32Array;
  partB: Float32Array;
  sizeB: Float32Array;
  color: Float32Array;
  ao: Float32Array;
  emit: Float32Array;
  /** Per box: origin xyz and scale. */
  xform: Float32Array;
  /** Per box: facing sin, facing cos, pose, hidden. */
  motion: Float32Array;
  count: number;
  /** Where each figure's boxes start and stop, by id. */
  span: Record<string, { from: number; to: number; scale: number }>;
};

export function buildBatch(defs: FigureDef[]): FigureBatch {
  let n = 0;
  for (const d of defs) n += d.a.length;

  const b: FigureBatch = {
    part: new Float32Array(n * 3),
    size: new Float32Array(n * 3),
    partB: new Float32Array(n * 3),
    sizeB: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
    ao: new Float32Array(n),
    emit: new Float32Array(n),
    xform: new Float32Array(n * 4),
    motion: new Float32Array(n * 4),
    count: n,
    span: {},
  };

  let i = 0;
  for (const d of defs) {
    if (d.a.length !== d.b.length) {
      /* Loud rather than quiet. Blending between lists of different lengths
         silently pairs a boot with an elbow, and the result looks like a
         shader bug for a long time before anyone counts the boxes. */
      throw new Error(
        `figure "${d.id}" has ${d.a.length} boxes in one pose and ${d.b.length} in the other`,
      );
    }
    b.span[d.id] = { from: i, to: i + d.a.length, scale: d.scale };
    for (let k = 0; k < d.a.length; k++, i++) {
      const p = d.a[k];
      const q = d.b[k];
      b.part.set(p.at, i * 3);
      b.size.set(p.size, i * 3);
      b.partB.set(q.at, i * 3);
      b.sizeB.set(q.size, i * 3);
      b.color.set(p.color, i * 3);
      b.ao[i] = p.ao;
      b.emit[i] = p.emit ?? 0;
      // Hidden until something places it, so a figure nobody drives is simply
      // absent rather than standing at the origin inside the island.
      b.motion[i * 4 + 3] = 1;
      b.xform[i * 4 + 3] = d.scale;
    }
  }
  return b;
}

/** Height of a part list, tool excluded, for normalising a figure's scale. */
export function figureHeight(parts: Box[]): number {
  let h = 0;
  for (const p of parts) {
    if (p.tool) continue;
    h = Math.max(h, p.at[1] + p.size[1] / 2);
  }
  return h;
}

export type Placement = {
  x: number;
  y: number;
  z: number;
  /** Radians, measured the same way the shader's yaw is. */
  yaw: number;
  /** 0 at pose A, 1 at pose B. */
  pose: number;
  hidden: boolean;
  scale?: number;
};

/** Write a figure's current state across its span. */
export function place(b: FigureBatch, id: string, p: Placement) {
  const s = b.span[id];
  if (!s) return;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  const scale = p.scale ?? s.scale;
  const hide = p.hidden ? 1 : 0;
  for (let i = s.from; i < s.to; i++) {
    const x = i * 4;
    b.xform[x] = p.x;
    b.xform[x + 1] = p.y;
    b.xform[x + 2] = p.z;
    b.xform[x + 3] = scale;
    b.motion[x] = sin;
    b.motion[x + 1] = cos;
    b.motion[x + 2] = p.pose;
    b.motion[x + 3] = hide;
  }
}

/* --- motion -----------------------------------------------------------------
   Every one of these is a pure function of its input. Nothing integrates and
   nothing remembers, so a figure scrubbed back to a progress is in exactly
   the pose it was in on the way down. */

/** Wind up, strike, recover. The blow lands at IMPACT of the way through,
    not at the start -- a pick that cracks the rock on the way UP reads as two
    unrelated events rather than as one causing the other. */
export const IMPACT = 0.26;

export function swingPose(u: number): number {
  const k = u - Math.floor(u);
  if (k < 0.42) return Math.sin((k / 0.42) * Math.PI * 0.5);
  if (k < 0.59) return Math.cos(((k - 0.42) / 0.17) * Math.PI * 0.5);
  return 0;
}

export function posePerFrame(role: Role, t: number, p: number): number {
  switch (role.kind) {
    case "still":
      return role.at ?? 0;
    case "swing":
      return swingPose((t + role.phase) / role.period);
    case "cycle": {
      const k = ((t + role.phase) / role.period) * Math.PI * 2;
      return 0.5 - 0.5 * Math.cos(k);
    }
    case "scroll": {
      const u = (p - role.from) / (role.to - role.from || 1);
      const c = Math.min(1, Math.max(0, u));
      return c * c * (3 - 2 * c);
    }
  }
}

export { alongRail };

export { MINER_PARTS, pose };
