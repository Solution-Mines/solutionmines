/* ----------------------------------------------------------------------------
   CODE-GENERATED VOXEL ISLAND

   A floating island produced entirely by arithmetic. There is no model file,
   no texture and no exported asset anywhere in this path: a voxel scene is
   only ever a list of positions plus a material per position, and the cube
   itself is twenty-odd numbers written once in the renderer.

   The five decisions that carry the look, in order of how much they matter:

   1. RESOLUTION. At 16 cubes across, every feature is one or two blocks wide
      and the island reads as a lump. Terrain needs enough cubes to describe a
      shape before any amount of shading will save it. Culling keeps the cost
      proportional to surface area rather than volume, so the grid can grow a
      long way before the draw does.

   2. TERRACING. Heights are quantised to whole steps, which is what produces
      flat plateaus joined by sheer cliffs. A continuous height field gives a
      smooth dome instead -- correct arithmetic, wrong object.

   3. THE KEEL. The underside tapers to a point rather than stopping flat, so
      the island reads as something floating rather than something cut out.
      It is also why the interior is hollow: only the shell is emitted.

   4. STRATA. Grass, dirt, two stones and a deep rock, so a cliff face shows
      its history instead of one flat colour. Depth is the subject here.

   5. PER-BLOCK VARIATION. Every cube carries a small brightness jitter. Large
      areas of one exact value are what make voxels look like plastic, and no
      lighting model fixes it.
-------------------------------------------------------------------------------*/

import { tileFor, T as TILE } from "./atlas";

/** Grid footprint, in cubes: the island plus a margin round it for the ledge
    the mine opens onto, the lips of the falls and the vines. */
export const VOXEL_SIZE = 80;
/** Vertical room: the underside's lowest step at the bottom, the canopies on
    the summit at the top. */
export const WORLD_HEIGHT = 84;

/* --- the island, in layers ---------------------------------------------------
   Designed rather than found. The first island was a noise field quantised
   into terraces, which gave a lump covered in one-block ledges: under a real
   sun every one of them threw its own small shadow and the whole thing read
   as gravel. This one is a few large decisions instead.

   1. A PLATEAU. A rounded square sixty-odd blocks across with sheer sides,
      eroded at the rim. The big flat cliffs are where the strata show.

   2. TIERS. Three smaller plateaus stacked on it, each set further toward the
      back, so from the opening camera the island climbs away from you to a
      summit. Clear steps, not texture.

   3. AN UNDERSIDE IN STEPS. Below the sheer sides the hull steps inward four
      blocks at a time, an upside-down ziggurat, rather than tapering to a
      cone: the stepped silhouette is what the reference islands share, and
      every step is a ledge for roots and stalactites to hang from.

   4. WATER WITH SOMEWHERE TO GO. A pond on the summit spills down each tier
      in turn and off the plateau's edge into the sea.

   5. A WAY IN. The mine opens in the side of the island onto a timber ledge,
      not into a hole in the top. */
const BASE_TOP = 50;
/** Where the sheer sides stop and the underside starts stepping in: six
    blocks under the turf all round, so the island tapers away beneath its
    rim like every floating island in the references -- twenty blocks of
    sheer wall all round read as a box. Except on the mine's side, where a
    tall rock face is what a portal is cut into. */
const BODY_BOTTOM = 44;
const FACE_BOTTOM = 30;
const UNDER_STEP = 4;
const BASE_HALF = 30.5;
/** The tiers above the plateau: offset from the island's centre, half-size,
    and the height of their tops. Each sits further toward -x -z, which is
    away from the opening camera. */
const TIERS = [
  { cx: -3, cz: -5, half: 21, top: 56 },
  { cx: -7, cz: -10, half: 13.5, top: 62 },
  { cx: -10, cz: -13, half: 7.5, top: 67 },
];

/* Where the sea sits. Below the underside's lowest step, which is the point
   of a floating island: drowning it would hide the stepped hull the whole
   silhouette rests on. */
export const SEA_Y = -18;

export const MATERIAL = {
  grass: 0,
  dirt: 1,
  stone: 2,
  rock: 3,
  wood: 4,
  leaf: 5,
  /* Still water lying in a plateau surface, feeding a fall. */
  water: 6,
  /* Falling water. A separate id only so the shader can scroll one and
     ripple the other without guessing from the face normal. */
  fall: 7,
  /* The bottom of the section. Colder and darker than rock. */
  deep: 8,
  oreCopper: 9,
  oreGold: 10,
  oreCrystal: 11,
  /* Built things: the ledge, the frames round the portals. */
  planks: 12,
  /* The path from the upper portal to the hoist. */
  gravel: 13,
  /* The second tree. Pale bark and lighter leaves, so the woods on the
     plateau are two greens rather than one. */
  birch: 14,
  birchLeaf: 15,
  /* The rest of the ore, for the veins through the whole body of the rock:
     coal high, iron anywhere, the red and the green deep and rare. */
  oreCoal: 16,
  oreIron: 17,
  oreRed: 18,
  oreGreen: 19,
  /* At the bottom of the chasm. Lights itself and everything near it. */
  lava: 20,
} as const;

/** Where the strata change, by height. Above STONE_Y anything that is not
    turf or dirt is stone; below DEEP_Y it is the cold deep band. Exported so
    the depth readout names the band the camera is actually in. */
export const STONE_Y = 44;
export const DEEP_Y = 24;

/* --- the mine -----------------------------------------------------------------
   Laid out round one track -- see "the route" in buildTerrain. Everything
   below is in world units, centred on the island, so the layout can be read
   against the shots in journey.ts. */

/* The cut. The island opens along the plane z = CUT_Z: everything past it
   (+z, toward the opening camera's left) is the half that slides away and
   shows the mine in section. */
export const CUT_Z = 3;
/** The row the section's tunnels run along: two blocks behind the cut, so the
    cut takes each one's front row and leaves four rows to see into. */
const SECTION_WZ = 1.5;
/** The portal's row, and the upper portal's: both behind the cut, so what
    stands outside them stays with the island when it opens. */
const PORTAL_WZ = -4.5;
const EXIT_WZ = -8.5;
/** The stations along the track, west to east in x. */
const GALLERY_WX: [number, number] = [12.5, 23.5];
const GALLERY_Y = 41;
const CHASM_WX: [number, number] = [-3.5, 2.5];
/** The chasm's floor, under its lava; and the bridge's boards. */
const CHASM_FLOOR = 21;
const BRIDGE_Y = 37;
/** The lower working: its floor, and how far it runs from the chasm. */
const LOWER_Y = 27;
const LOWER_WX = 14.5;
const JUNCTION_WX = -6.5;
const FORGE_WX: [number, number] = [-17.5, -10.5];
const FORGE_Y = 40;
/** The geode: centre, and the radius of its hollow. */
const GEODE_W: [number, number, number] = [-6.5, 32, -9.5];
const GEODE_R = 5.5;

/** The ledge's floor, eight blocks under the plateau. */
const LEDGE_Y = 42;
/** How far the ledge reaches out from the cliff, and its half-width. */
const LEDGE_LEN = 6;
const LEDGE_HW = 4;
/** Half-width of the portal and the tunnel behind it: a five-wide way, which
    a camera and a cart both fit down. */
const ADIT_HW = 2;
const ADIT_H = 4;

/** +X, -X, +Y, -Y, +Z, -Z, matching the face ids the vertex shader decodes.
    Module scope because both the light flood and the face emitter walk it. */
const NB: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** The one block a visitor can break open.

    Its faces are deliberately absent from the island's buffers: it is drawn
    by its own mesh so it can move, crack and change material, none of which
    a buffer uploaded once can do. */
export type MineTarget = {
  x: number;
  y: number;
  z: number;
  /** The sky access and the jitter this cell would have had in the island's
      draw, so the separate mesh can reproduce it exactly. */
  ao: number;
  /** The same with the island open: the gallery's wall then sees the sky
      through the cut, and a block that stayed dark would show as a hole. */
  aoOpen: number;
  tint: number;
  /** Which way it faces the room: the axis a pick would come in along. */
  face: [number, number, number];
  /** The material it reads as before it is broken, so the separate draw uses
      the wall's own colour rather than a guess at it. */
  material: number;
  /** The tile its room-facing face shows, and that face's four corners of
      ambient occlusion and block light -- the same values the island would
      have given it, so it is invisible in the wall until pointed at. */
  tile: number;
  cornerAO: number[];
  lightW: number[];
  lightC: number[];
};

/** A lantern. On a post standing on the floor (`hang` 0, `y` is the floor
    surface), or hanging on a chain of length `hang` (`y` is its centre). */
export type Lamp = { x: number; y: number; z: number; hang: number };

/** A point on a line through the mine, in world units: the floor block's
    centre, so the floor's top is half a unit up. */
export type MinePoint = { x: number; y: number; z: number };

/** The mine, in the same world units as everything else. */
export type MineInfo = {
  /** The track, from the portal on the ledge to the depot on the plateau:
      one point per block. The rails are laid on it, the cart rides it and
      the cameras that follow the cart walk it. */
  route: MinePoint[];
  /** Where along the route each station is, as a point index. */
  stops: {
    portal: number;
    gallery: number;
    bridge: number;
    junction: number;
    forge: number;
    climb: number;
    exit: number;
    depot: number;
  };
  /** The passage from the junction to the geode, junction first. */
  spur: MinePoint[];
  /** The rooms, for the cameras to frame and the props to furnish. */
  gallery: { x0: number; x1: number; back: number; floorY: number };
  chasm: { x0: number; x1: number; back: number; floorY: number; bridgeY: number };
  geode: { x: number; y: number; z: number; r: number };
  forge: { x0: number; x1: number; back: number; floorY: number };
  /** The second level, under the gallery, opening onto the chasm. */
  lower: { x0: number; x1: number; back: number; floorY: number };
  /** The shaft of daylight down into the chasm: centre, and its top. */
  skylight: { x: number; z: number; topY: number; bottomY: number };
  /** The row the section's tunnels run along, and the cut. */
  sectionZ: number;
  cutZ: number;
  /** Depth zero, for the readout: the ledge's floor. */
  rimY: number;
  /** Ore blocks placed. */
  ore: number;
  /** The mineable block, or null if the gallery offered no suitable cell. */
  target: MineTarget | null;
  /** Every lantern in the mine, decided once for the props AND the light. */
  lamps: Lamp[];
  /** The forge's fires: where the props stand them and the light comes from. */
  fires: MinePoint[];
  /** The beacon at the depot: centre of its base, on the turf's surface. */
  beacon: MinePoint;
};

/** The outside of the island: everything built on it or growing on it that
    the props and the camera need to find. World units, centred. */
export type SiteInfo = {
  /** The ledge: the centre of its outer edge... see `ledge.x` etc. */
  ledge: {
    /** Centre of the ledge's floor, top surface. */
    x: number;
    y: number;
    z: number;
    /** Out from the cliff, in the ground plane, and across the ledge. */
    out: [number, number];
    across: [number, number];
    /** The cliff face the ledge is fixed to, along `out`. */
    face: number;
    len: number;
    half: number;
  };
  /** The upper portal, where the journey comes back out: centre of its floor
      and the way it faces. */
  exit: { x: number; y: number; z: number; out: [number, number] };
  /** The hoist at the plateau's edge above the ledge: foot of its post. */
  winch: { x: number; y: number; z: number };
  /** The summit, for the opening camera to frame. */
  summit: { x: number; y: number; z: number };
  /** The plateau's top, and the island's half-width. */
  top: number;
  half: number;
  /** Small plants, eight numbers each: x, y, z, atlas tile, kind, facing,
      length, and 1 if it grows on the half that slides away. Kind 0 stands
      on a top face as two crossed cards, 1 lies flat against a cliff
      (vines), 2 hangs from an underside (roots). Facing is a face id for
      kind 1. Length is height in blocks. */
  plants: Float32Array;
};

export type VoxelTerrain = {
  /** xyz per instance, already centred on the origin in x and z. */
  offset: Float32Array;
  /** One material id per instance. */
  material: Float32Array;
  /** 0..1 sky access per instance. 1 is open, lower is shadowed. */
  ao: Float32Array;
  /** Per-instance brightness jitter, around 1. */
  tint: Float32Array;
  /** Instances actually emitted -- this is the draw's instance count. */
  count: number;
  /* --- per visible FACE, the same scene expressed as quads -------------------
     A cube instance always carries all six of its faces, but a cube sitting in
     terrain typically shows two or three. Emitting faces instead spends
     vertices only on what can actually be seen. Both forms are produced so
     the two can be benchmarked against each other on identical geometry. */
  /** Centre of the cube the face belongs to, 3 per face. */
  faceOffset: Float32Array;
  /** Which way the face points: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
  faceDir: Float32Array;
  faceMaterial: Float32Array;
  faceAo: Float32Array;
  faceTint: Float32Array;
  /** Atlas tile per face, with a quarter-turn packed above bit 8. */
  faceTile: Float32Array;
  /** Per face, four corners -- (-t,-b) (+t,-b) (-t,+b) (+t,+b) in the face's
      own basis -- of ambient occlusion, warm light and crystal light. */
  faceCornerAO: Float32Array;
  faceLightW: Float32Array;
  faceLightC: Float32Array;
  faceCount: number;
  /** Per face: 0 the half that stays, 1 the half that slides away when the
      island opens, 2 and 3 the same two halves' faces ON the cut, which only
      show while it is open. */
  faceHalf: Float32Array;
  /** Per face: its sky access with the island open. */
  faceAoOpen: Float32Array;
  /** Solid cells before hidden ones were discarded. */
  solid: number;
  trees: number;
  rocks: number;
  /** Where each fall meets the sea, so the water shader can foam there. */
  falls: Array<{ x: number; z: number }>;
  /** Where the tunnels and rooms ended up, for the camera to aim at. */
  mine: MineInfo;
  /** The outside: ledge, portals, hoist, summit and the small plants. */
  site: SiteInfo;
  /** Occupancy: EMPTY (255) or a material id, at [(y * N + z) * N + x].

      Returned rather than discarded so a camera path can be CHECKED against
      the terrain instead of guessed at. Framing a shot by eye and finding out
      from a screenshot that the lens is inside a wall is slow and, worse,
      only finds the shots that were sampled -- a spline between two clear
      keys can still pass through rock halfway. */
  cells: Uint8Array;
  /** Block light levels, 0-15, per cell, laid out like `cells`. Warm (the
      lanterns, and a faint glow off gold) and crystal, kept apart so the
      shader can colour and time them independently. Figures standing in the
      mine read their light from here. */
  lightW: Uint8Array;
  lightC: Uint8Array;
  /** Sky access per cell, 0-255, laid out like `cells`. */
  daylight: Uint8Array;
  /** The same with the island open: the dug air that sees out through the
      cut is in daylight. */
  daylightOpen: Uint8Array;
  /** Per column, at [z * N + x]: the grid y of its highest and lowest
      solid cells, -1 where there are none. Worked out here, in the worker,
      for the page's setup to read rather than scan half a million cells
      for: where the animals can walk, and the island's outline for framing
      it. */
  colTop: Int16Array;
  colBottom: Int16Array;
};

/** Empty, in the occupancy grid. */
export const EMPTY_CELL = 255;

function hash2(x: number, y: number, seed: number) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number) {
  return hash2(x + Math.imul(y, 7919), z, seed);
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function buildTerrain(
  seed = 0x7a19,
  {
    falls = true,
    onProgress,
  }: {
    falls?: boolean;
    /** Called as each stage of the build begins: how far through, 0 to 1,
        and what is being done -- for a loading screen that shows the work
        rather than a spinner. */
    onProgress?: (done: number, stage: string) => void;
  } = {},
): VoxelTerrain {
  const N = VOXEL_SIZE;
  const H = WORLD_HEIGHT;
  const HALF = (N - 1) / 2;

  /* A rounded square, not a circle: euclidean distance blended with the
     chebyshev one keeps broad flat flanks and corners, which is what makes a
     piece of land rather than a scoop of ice cream. Roughened at two scales
     so the rim is not a clean arc. Below 1 is inside. */
  const shape = (
    x: number,
    z: number,
    cx: number,
    cz: number,
    half: number,
    salt: number,
    rough: number,
  ) => {
    const nx = (x - HALF - cx) / half;
    const nz = (z - HALF - cz) / half;
    const euclid = Math.sqrt(nx * nx + nz * nz);
    const square = Math.max(Math.abs(nx), Math.abs(nz));
    const n =
      (valueNoise(x / 7, z / 7, seed ^ salt) - 0.5) * rough +
      (valueNoise(x / 3, z / 3, seed ^ (salt * 7)) - 0.5) * rough * 0.45;
    return euclid * 0.42 + square * 0.58 + n;
  };

  const top = new Int32Array(N * N).fill(-1);
  const bot = new Int32Array(N * N).fill(-1);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const d = shape(x, z, 0, 0, BASE_HALF, 0x77aa, 0.16);
      if (d >= 1) continue;
      let t = BASE_TOP;
      TIERS.forEach((tier, i) => {
        if (shape(x, z, tier.cx, tier.cz, tier.half, 0x1100 + i * 31, 0.22) < 1) t = tier.top;
      });
      /* The plateau's rim, worn: a block gone here and there along the outer
         ring, so the edge of the world is not a ruled line. */
      if (t === BASE_TOP && d > 0.93 && hash2(x, z, seed ^ 0x3e1) < 0.35) t -= 1;
      top[z * N + x] = t;

      /* The underside, in steps. Its own outline -- off-centre and rougher
         than the top's -- so the steps do not run parallel to the rim above
         them, which reads as a stack of plates. One step in four blocks, and
         a block of jitter in patches, so no step is a perfect ring. */
      const du = shape(x, z, 1.5, -1, BASE_HALF, 0x5c3d, 0.3);
      const band = Math.max(0, Math.floor((1 - du) / 0.115));
      const jitter = hash2(Math.floor(x / 3), Math.floor(z / 3), seed ^ 0x2a2) < 0.3 ? 1 : 0;
      /* The rock face: the +x side, a little toward the camera, blending into
         the tapered hull either side of it rather than meeting it at a seam. */
      const fx = (x - HALF) / BASE_HALF;
      const fz = (z - HALF) / BASE_HALF;
      const faceW =
        smooth(0.2, 0.7, fx) * (1 - smooth(0.45, 0.85, Math.abs(fz - 0.2)));
      const edge = Math.round(BODY_BOTTOM + (FACE_BOTTOM - BODY_BOTTOM) * faceW);
      bot[z * N + x] = Math.max(1, edge - band * UNDER_STEP - jitter);
    }
  }

  onProgress?.(0.01, "Raising the island");

  /* --- occupancy ----------------------------------------------------------
     Ground and everything built on it share one grid, so a post occludes the
     ground beneath it and the culling pass sees the whole scene. */
  const EMPTY = 255;
  const cells = new Uint8Array(N * N * H).fill(EMPTY);
  const at = (x: number, y: number, z: number) => (y * N + z) * N + x;
  const inside = (x: number, y: number, z: number) =>
    x >= 0 && z >= 0 && x < N && z < N && y >= 0 && y < H;
  const solidAt = (x: number, y: number, z: number) =>
    inside(x, y, z) && cells[at(x, y, z)] !== EMPTY;

  let solid = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const t = top[z * N + x];
      const b = bot[z * N + x];
      if (b < 0) continue;
      for (let y = b; y <= t; y++) {
        const below = t - y;
        /* Strata: thin turf, three courses of dirt, then stone down to a
           level, rock under that and the deep band at the bottom. By HEIGHT
           below the dirt, not by depth, so a horizontal cut anywhere shows
           one material and the bands line up from one cliff to the next. */
        cells[at(x, y, z)] =
          below === 0
            ? MATERIAL.grass
            : below <= 3
              ? MATERIAL.dirt
              : y >= STONE_Y
                ? MATERIAL.stone
                : y >= DEEP_Y
                  ? MATERIAL.rock
                  : MATERIAL.deep;
        solid++;
      }
    }
  }

  const put = (x: number, y: number, z: number, m: number) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] !== EMPTY) return;
    cells[at(x, y, z)] = m;
    solid++;
  };
  /** Replace whatever is there, solid or not. */
  const set = (x: number, y: number, z: number, m: number) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] === EMPTY) solid++;
    cells[at(x, y, z)] = m;
  };
  const columnIn = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < N && z < N && bot[z * N + x] >= 0;

  /* --- water ----------------------------------------------------------------
     A pond on the summit, and a stream from it that runs toward +z, down each
     tier in turn as a fall, and off the plateau's edge into the sea. Two
     blocks wide all the way, so the falls are sheets and not strings.

     Laid INTO the surface -- the top cell becomes water -- rather than on it,
     so its underside is not coplanar with the grass and the existing culling
     and face emission handle it for free. The falls between tiers are cells
     in the air in front of each cliff, with how far under its lip each one is
     and how tall its fall is: the shader runs the water faster the further it
     has fallen, and breaks it white at the crest and the foot. */
  type Fall = { x: number; z: number; dx: number; dz: number; lip: number };
  const fallPlan: Fall[] = [];
  const fallDrop = new Map<number, [number, number]>();
  const waterAt = new Set<number>();
  /* The stream's own cells, which run downhill (toward +z), as against the
     ponds' cells, which lie still -- and the two cells under each fall, where
     the water lands and churns. Read when the water's top faces are emitted. */
  const flowAt = new Set<number>();
  const churnAt = new Set<number>();

  const summit = TIERS[TIERS.length - 1];
  const pondX = Math.round(HALF + summit.cx + 1);
  const pondZ = Math.round(HALF + summit.cz + 2);
  const pondAt = (cx: number, cz: number, r: number, level: number) => {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx + 0.5, dz + 0.5) > r) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (!columnIn(x, z) || top[z * N + x] !== level) continue;
        set(x, level, z, MATERIAL.water);
        waterAt.add(z * N + x);
      }
    }
  };
  if (falls) {
    let level = top[pondZ * N + pondX];
    pondAt(pondX, pondZ, 2.6, level);
    let z = pondZ;
    let pooled = false;
    let froth = 0;
    for (let step = 0; step < N; step++) {
      const nz = z + 1;
      if (!columnIn(pondX, nz) || !columnIn(pondX + 1, nz)) {
        /* Off the edge. The fall into the sea is not in the grid -- it runs
           seventy blocks below it -- and is emitted separately below. */
        fallPlan.push({ x: pondX, z, dx: 0, dz: 1, lip: level });
        break;
      }
      const nt = Math.min(top[nz * N + pondX], top[nz * N + pondX + 1]);
      if (nt < level) {
        for (let y = nt + 1; y <= level; y++) {
          for (const x of [pondX, pondX + 1]) {
            set(x, y, nz, MATERIAL.fall);
            fallDrop.set(at(x, y, nz), [level - y, Math.max(1, level - nt)]);
          }
        }
        level = nt;
        froth = 2;
        /* The lower pond, where the stream lands on the first tier: a wider
           pool, so the water has somewhere to gather before going on. */
        if (!pooled && level === TIERS[0].top) {
          pondAt(pondX, nz + 2, 3.1, level);
          pooled = true;
        }
      }
      for (const x of [pondX, pondX + 1]) {
        if (top[nz * N + x] === level) {
          set(x, level, nz, MATERIAL.water);
          waterAt.add(nz * N + x);
          flowAt.add(at(x, level, nz));
          if (froth > 0) churnAt.add(at(x, level, nz));
        }
      }
      if (froth > 0) froth--;
      z = nz;
    }
  }

  onProgress?.(0.03, "Carving the mine");

  /* --- the mine ---------------------------------------------------------------
     Built along its track. The route is the spine -- a line of points, one
     per block, from the portal in the island's side to a depot on its top --
     and every tunnel, room and bridge is cut round it. The camera and the
     rails both walk the same points, which is the only way the two agree.

     Most of it lies just behind the cut: the plane the island opens along
     (see CUT_Z). The tunnels there are cut open when it does, so the whole
     mine shows at once, like an ant farm -- a gallery high on the right, an
     incline down to a bridge over a lava-lit chasm, an incline up to the
     forge on the left. Behind the cut, out of the section: the way in from
     the portal, the geode, and the long climb out to the upper portal.

     Set back to empty after the fill, which is the cheap half of the trick:
     a cell that loses a neighbour starts emitting the face that was hidden,
     so the walls of a tunnel are ordinary surface and cost nothing extra to
     find. Every cell emptied is remembered: the daylight flood needs to tell
     a room from the open air outside, and both are empty. */
  const carved = new Set<number>();
  const carve = (x: number, y: number, z: number, roofClear = 0) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] === EMPTY) return;
    // Keep this much rock between a cut and the open air above it.
    if (roofClear > 0 && y > top[z * N + x] - roofClear) return;
    // And never cut within two blocks of the underside.
    if (y < bot[z * N + x] + 2) return;
    cells[at(x, y, z)] = EMPTY;
    carved.add(at(x, y, z));
    solid--;
  };
  const timber = (x: number, y: number, z: number) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] === EMPTY) return;
    cells[at(x, y, z)] = MATERIAL.wood;
  };
  /** Grid column for a world coordinate. */
  const gx = (w: number) => Math.round(w + HALF);
  /** The first grid row past the cut: rows from here on slide away. */
  const CUT_GZ = Math.ceil(CUT_Z + HALF);

  /* The portal's row: behind the cut, so the ledge and everything on it stay
     with the island when it opens. The cliff face is found, not assumed --
     the rim is rough -- and taken as the FURTHEST-IN of the columns the
     ledge spans, so the ledge is fixed to rock along its whole width. */
  const PORTAL_Z = gx(PORTAL_WZ);
  let faceX = N;
  for (let dz = -LEDGE_HW; dz <= LEDGE_HW; dz++) {
    let edge = -1;
    for (let x = 0; x < N; x++) {
      const k = (PORTAL_Z + dz) * N + x;
      if (bot[k] >= 0 && bot[k] <= LEDGE_Y && top[k] >= LEDGE_Y + 6) edge = x;
    }
    faceX = Math.min(faceX, edge);
  }

  /* The upper portal, where the climb comes out: the first tier's cliff, on
     the same side as the ledge and eight blocks higher. */
  const tier1 = TIERS[0];
  const EXIT_Z = gx(EXIT_WZ);
  let exitX = -1;
  for (let x = 0; x < N; x++) {
    if (columnIn(x, EXIT_Z) && top[EXIT_Z * N + x] >= tier1.top) exitX = x;
  }

  /* --- the route --------------------------------------------------------------
     Waypoints in grid columns, each with the floor height there; straight
     runs between them, one point per block, floors interpolated. */
  type Pt = { x: number; y: number; z: number };
  const route: Pt[] = [];
  const stops: Record<string, number> = {};
  const leg = (x: number, z: number, y: number, stop?: string) => {
    const from = route[route.length - 1];
    if (!from) {
      route.push({ x, y, z });
    } else {
      const n = Math.max(Math.abs(x - from.x), Math.abs(z - from.z));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        route.push({
          x: Math.round(from.x + (x - from.x) * t),
          y: Math.round(from.y + (y - from.y) * t),
          z: Math.round(from.z + (z - from.z) * t),
        });
      }
    }
    if (stop) stops[stop] = route.length - 1;
  };
  const S = gx(SECTION_WZ);
  leg(faceX, PORTAL_Z, LEDGE_Y, "portal");
  leg(faceX - 5, PORTAL_Z, LEDGE_Y);
  leg(faceX - 5, S, LEDGE_Y);
  leg(gx(GALLERY_WX[1]), S, GALLERY_Y, "galleryIn");
  leg(gx(GALLERY_WX[0]), S, GALLERY_Y, "gallery");
  leg(gx(CHASM_WX[1] + 1), S, BRIDGE_Y);
  leg(gx(CHASM_WX[0] - 1), S, BRIDGE_Y, "bridge");
  leg(gx(JUNCTION_WX), S, BRIDGE_Y, "junction");
  /* A block of level road past the junction before the climb to the forge.
     A climb's rail is laid on the block below the step, and with the step
     straight after the junction that block was the junction itself: the
     main line rising across it while the spur left it at the bottom. */
  leg(gx(JUNCTION_WX) - 1, S, BRIDGE_Y);
  leg(gx(FORGE_WX[1]), S, FORGE_Y);
  /* Back into the rock a column in from the forge's far wall: the island's
     underside steps up toward its edge, and out there the rock under a
     floor at this height is a block thick. */
  leg(gx(FORGE_WX[0]) + 1, S, FORGE_Y, "forge");
  leg(gx(FORGE_WX[0]) + 1, EXIT_Z, FORGE_Y, "climb");
  leg(exitX, EXIT_Z, BASE_TOP, "exit");
  leg(exitX + 6, EXIT_Z, BASE_TOP, "depot");

  /* Cut the tunnel round each point: five wide in the section, where the cut
     takes the front row and leaves four to see into, and on the way in; three
     wide on the long climb. Four high. The floor cell is laid as well as the
     air above it cut -- on the bridge, as boards over the drop. */
  const onBridge = (p: Pt) =>
    p.z === S && p.x >= gx(CHASM_WX[0]) && p.x <= gx(CHASM_WX[1]);
  route.forEach((p, i) => {
    const a = route[Math.max(0, i - 1)];
    const b = route[Math.min(route.length - 1, i + 1)];
    const along = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? [1, 0] : [0, 1];
    // Past the forge the way runs behind the section, where nobody sees in.
    const hw = i > stops.forge ? 1 : 2;
    // Past the upper portal the track runs on the turf: nothing to cut.
    if (i > stops.exit) return;
    for (let o = -hw; o <= hw; o++) {
      const x = p.x + along[1] * o;
      const z = p.z + along[0] * o;
      if (onBridge(p)) set(x, p.y, z, MATERIAL.planks);
      else put(x, p.y, z, MATERIAL.rock);
      for (let y = p.y + 1; y <= p.y + ADIT_H; y++) carve(x, y, z, 2);
    }
    /* A set every four blocks, cut into the walls rather than standing in
       the way, and never at a bend, where its legs would block the turn. */
    const bend = a.x !== b.x && a.z !== b.z;
    if (i % 4 === 2 && !bend && !onBridge(p)) {
      for (let y = p.y + 1; y <= p.y + ADIT_H; y++) {
        timber(p.x + along[1] * (hw + 1), y, p.z + along[0] * (hw + 1));
        timber(p.x - along[1] * (hw + 1), y, p.z - along[0] * (hw + 1));
      }
      for (let o = -hw - 1; o <= hw + 1; o++) {
        timber(p.x + along[1] * o, p.y + ADIT_H + 1, p.z + along[0] * o);
      }
    }
  });

  /* --- the gallery ------------------------------------------------------------
     The working face: a long room behind the track, its back wall the seam
     the crew is working, tall enough for scaffolding against it. */
  const galleryX0 = gx(GALLERY_WX[0]);
  const galleryX1 = gx(GALLERY_WX[1]);
  const galleryBack = S - 5;
  for (let x = galleryX0; x <= galleryX1; x++) {
    for (let z = galleryBack; z <= S + 2; z++) {
      put(x, GALLERY_Y, z, MATERIAL.rock);
      for (let y = GALLERY_Y + 1; y <= GALLERY_Y + 6; y++) carve(x, y, z, 2);
    }
  }

  /* --- the chasm ----------------------------------------------------------------
     A slot cut deep through the middle of the island, under the bridge. Lava
     at the bottom on one side and a pool on the other, fed by a fall down
     the back wall: the glow comes up from below, the water catches it. And a
     shaft of daylight down into it from the top of the island -- the one
     skylight the mine has. */
  const chasmX0 = gx(CHASM_WX[0]);
  const chasmX1 = gx(CHASM_WX[1]);
  const chasmBack = S - 7;
  for (let x = chasmX0; x <= chasmX1; x++) {
    for (let z = chasmBack; z <= S + 2; z++) {
      for (let y = CHASM_FLOOR + 1; y <= BRIDGE_Y + 4; y++) {
        // The bridge itself, and the boards it stands on, stay.
        if (z >= S - 2 && y === BRIDGE_Y) continue;
        carve(x, y, z);
      }
    }
  }
  // What lies at the bottom: lava toward the incline, water under the fall.
  const lavaAt: number[] = [];
  const poolX = chasmX1 - 1;
  for (let x = chasmX0; x <= chasmX1; x++) {
    for (let z = chasmBack; z <= S + 2; z++) {
      const k = at(x, CHASM_FLOOR + 1, z);
      if (!carved.has(k)) continue;
      if (x >= poolX) {
        set(x, CHASM_FLOOR + 1, z, MATERIAL.water);
        carved.delete(k);
      } else {
        set(x, CHASM_FLOOR + 1, z, MATERIAL.lava);
        carved.delete(k);
        lavaAt.push(x, CHASM_FLOOR + 1, z);
      }
    }
  }
  // The fall down the back wall, two wide, into the pool.
  for (let y = CHASM_FLOOR + 2; y <= BRIDGE_Y + 2; y++) {
    for (const x of [poolX, poolX + 1]) {
      const k = at(x, y, chasmBack);
      if (!carved.has(k)) continue;
      set(x, y, chasmBack, MATERIAL.fall);
      fallDrop.set(k, [BRIDGE_Y + 2 - y, BRIDGE_Y + 2 - CHASM_FLOOR - 1]);
    }
  }
  // Timber legs under the bridge, down to the floor of the chasm.
  for (const x of [chasmX0 + 1, chasmX1 - 1]) {
    for (let y = BRIDGE_Y - 1; y > CHASM_FLOOR + 1; y--) {
      if (cells[at(x, y, S - 2)] === EMPTY) set(x, y, S - 2, MATERIAL.wood);
    }
  }
  // The skylight: a three-by-three shaft from the chasm to the turf above.
  const skyX = Math.round((chasmX0 + chasmX1) / 2);
  const skyZ = S - 4;
  const skylight: number[] = [];
  for (let y = BRIDGE_Y + 5; y < H; y++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = skyX + dx;
        const z = skyZ + dz;
        if (!inside(x, y, z) || y > top[z * N + x]) continue;
        if (cells[at(x, y, z)] === EMPTY) continue;
        cells[at(x, y, z)] = EMPTY;
        carved.add(at(x, y, z));
        solid--;
        if (y === top[z * N + x]) skylight.push(x, y, z);
      }
    }
  }

  /* --- the lower working ------------------------------------------------------------
     A second level under the first: a drift off the chasm's far wall,
     breaking into the chasm as a balcony over the pool, with a ladder up the
     wall to the bridge. In the open section it is what makes this a mine of
     levels rather than one corridor with rooms on it. */
  const lowerX0 = chasmX1 + 1;
  const lowerX1 = gx(LOWER_WX);
  const lowerBack = S - 3;
  for (let x = lowerX0; x <= lowerX1; x++) {
    for (let z = lowerBack; z <= S + 2; z++) {
      put(x, LOWER_Y, z, MATERIAL.rock);
      for (let y = LOWER_Y + 1; y <= LOWER_Y + 4; y++) carve(x, y, z, 2);
    }
  }
  // Sets across it every four blocks: posts in the back wall, a cap overhead.
  for (let x = lowerX0 + 2; x < lowerX1; x += 4) {
    for (let y = LOWER_Y + 1; y <= LOWER_Y + 4; y++) timber(x, y, lowerBack - 1);
    for (let z = lowerBack - 1; z <= S + 2; z++) timber(x, LOWER_Y + 5, z);
  }

  /* --- the geode ------------------------------------------------------------------
     The find. A hollow in the rock lined with crystal, sealed except for the
     passage cut to it from the junction -- the one enclosed space the camera
     goes into, so it is behind the cut and stays whole when the island opens.
     Crystal over a shell of pale stone, the way a real geode is layered. */
  const geodeX = gx(GEODE_W[0]);
  const geodeY = GEODE_W[1];
  const geodeZ = gx(GEODE_W[2]);
  const GR = GEODE_R;
  /* Whole cells either side of the centre. The radius is not a whole number,
     and a loop counted from minus the radius walks half-cells: every index
     it made was fractional, every write to the grid went nowhere, and the
     geode was never cut at all. */
  const GB = Math.ceil(GR + 2);
  for (let dy = -GB; dy <= GB; dy++) {
    for (let dz = -GB; dz <= GB; dz++) {
      for (let dx = -GB; dx <= GB; dx++) {
        const d = Math.hypot(dx, dy * 1.1, dz);
        const x = geodeX + dx;
        const y = geodeY + dy;
        const z = geodeZ + dz;
        if (!inside(x, y, z)) continue;
        if (d <= GR - 1.4) carve(x, y, z);
        else if (d <= GR && cells[at(x, y, z)] !== EMPTY) set(x, y, z, MATERIAL.oreCrystal);
        else if (d <= GR + 1.2 && cells[at(x, y, z)] !== EMPTY) set(x, y, z, MATERIAL.stone);
      }
    }
  }
  /* Spires standing on its floor and hanging from its roof. The floor is a
     bowl, so each one is grown from wherever the bowl is under it -- found,
     not assumed -- and the side the spur comes in by is left clear. */
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.4;
    const r = 1.8 + (k % 3) * 0.9;
    const x = Math.round(geodeX + Math.cos(a) * r);
    const z = Math.round(geodeZ + Math.sin(a) * r);
    if (z > geodeZ + 1) continue;
    const up = k % 2 === 0;
    const len = 1 + (k % 3);
    const step = up ? 1 : -1;
    let y = geodeY;
    while (inside(x, y, z) && cells[at(x, y, z)] === EMPTY && Math.abs(y - geodeY) <= GR + 1) y -= step;
    for (let i = 1; i <= len; i++) {
      const yy = y + step * i;
      if (!inside(x, yy, z) || cells[at(x, yy, z)] !== EMPTY) break;
      set(x, yy, z, MATERIAL.oreCrystal);
      carved.delete(at(x, yy, z));
    }
  }
  /* The spur: from the junction back into the rock and down to the geode,
     ending a block inside its hollow -- stopping at the lining leaves a
     doorway one block square, which is a hole and not a way in. Three wide,
     its own short line of points for the camera. */
  const spur: Pt[] = [];
  {
    const j = route[stops.junction];
    const n = j.z - geodeZ - Math.floor(GR - 1.4) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      spur.push({ x: j.x, y: Math.round(j.y + (geodeY - 1 - j.y) * t), z: j.z - i });
    }
    for (const p of spur) {
      for (let o = -1; o <= 1; o++) {
        put(p.x + o, p.y, p.z, MATERIAL.rock);
        for (let y = p.y + 1; y <= p.y + 3; y++) carve(p.x + o, y, p.z, 2);
      }
    }
  }

  /* --- the forge ------------------------------------------------------------------
     Where the ore is turned into something: a hall at the top of the second
     incline, its furnaces and anvils standing along the back wall. The
     things in it are props; this is the room. */
  const forgeX0 = gx(FORGE_WX[0]);
  const forgeX1 = gx(FORGE_WX[1]);
  for (let x = forgeX0; x <= forgeX1; x++) {
    for (let z = S - 6; z <= S + 2; z++) {
      put(x, FORGE_Y, z, MATERIAL.rock);
      for (let y = FORGE_Y + 1; y <= FORGE_Y + 7; y++) carve(x, y, z, 3);
    }
  }

  onProgress?.(0.04, "Opening the caves");

  /* --- caves ------------------------------------------------------------------------
     Pockets the miners never cut: holes in the rock from a three-dimensional
     noise, kept clear of the tunnels and of the hull. In the section they
     are what makes the rock between the levels look like ground rather than
     fill. */
  const keep = new Uint8Array(N * N * H);
  for (const k of carved) {
    const x = k % N;
    const z = Math.floor(k / N) % N;
    const y = Math.floor(k / (N * N));
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (inside(x + dx, y + dy, z + dz)) keep[at(x + dx, y + dy, z + dz)] = 1;
        }
      }
    }
  }
  const noise3 = (x: number, y: number, z: number) =>
    (valueNoise(x / 5.5 + y * 0.31, z / 5.5, seed ^ 0x33c1) +
      valueNoise(y / 4.5 + z * 0.17, x / 6.5, seed ^ 0x7e21)) *
    0.5;
  for (let y = 4; y < BASE_TOP - 4; y++) {
    // The stage shares are measured: this loop is a quarter of the build.
    if (y % 6 === 0) onProgress?.(0.04 + 0.24 * ((y - 4) / (BASE_TOP - 8)), "Opening the caves");
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const k = at(x, y, z);
        if (keep[k] || cells[k] === EMPTY) continue;
        const m = cells[k];
        if (m !== MATERIAL.rock && m !== MATERIAL.deep && m !== MATERIAL.stone) continue;
        // Well inside the hull: three blocks from the underside and the sides.
        if (y < bot[z * N + x] + 3 || y > top[z * N + x] - 5) continue;
        let edge = false;
        for (const [ox, oz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
          const c = (z + oz) * N + x + ox;
          if (!columnIn(x + ox, z + oz) || bot[c] > y - 1) edge = true;
        }
        if (edge) continue;
        /* More of them just behind the cut, where the section shows them:
           elsewhere a pocket is only ever seen from a tunnel that passes it,
           and the rock between the levels of an open mine is the one place
           a visitor looks straight at the inside of the ground. */
        const nearCut = z < CUT_GZ && z >= CUT_GZ - 3;
        if (noise3(x, y, z) > (nearCut ? 0.6 : 0.69)) carve(x, y, z);
      }
    }
  }

  onProgress?.(0.28, "Seeding the ore");

  /* --- ore ---------------------------------------------------------------------------
     In clusters, the way it comes in the game this is built on: a seed
     block and a few around it, each kind at the depth it belongs to. Coal
     high, iron anywhere, gold and the red ore deep, green rare. Through the
     whole body of the island, not only the walls, because the cut shows the
     inside of the rock as well as the tunnels. */
  let ore = 0;
  const veinAt = (x: number, y: number, z: number, m: number, size: number) => {
    let cx = x;
    let cy = y;
    let cz = z;
    for (let i = 0; i < size; i++) {
      if (inside(cx, cy, cz)) {
        const c = cells[at(cx, cy, cz)];
        if (c === MATERIAL.rock || c === MATERIAL.deep || c === MATERIAL.stone) {
          cells[at(cx, cy, cz)] = m;
          ore++;
        }
      }
      const r = hash3(cx, cy + i, cz, seed ^ 0x4e11);
      if (r < 0.34) cx += r < 0.17 ? 1 : -1;
      else if (r < 0.67) cz += r < 0.5 ? 1 : -1;
      else cy += r < 0.84 ? 1 : -1;
    }
  };
  for (let y = 4; y < BASE_TOP - 3; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const c = cells[at(x, y, z)];
        if (c !== MATERIAL.rock && c !== MATERIAL.deep && c !== MATERIAL.stone) continue;
        const r = hash3(x, y, z, seed ^ 0x0de5);
        /* Denser than a game would have it: the cut face is a great flat
           expanse of the inside of the rock, and at the game's density it
           showed a handful of specks across the whole island. */
        if (r > 0.024) continue;
        const pick = hash3(z, x, y, seed ^ 0x5a5a);
        const m =
          y > 38 && pick < 0.45
            ? MATERIAL.oreCoal
            : pick < 0.62
              ? MATERIAL.oreIron
              : y < 36 && pick < 0.78
                ? MATERIAL.oreGold
                : y < 32 && pick < 0.92
                  ? MATERIAL.oreRed
                  : pick < 0.97
                    ? MATERIAL.oreCopper
                    : MATERIAL.oreGreen;
        veinAt(x, y, z, m, 3 + Math.floor(r * 250));
      }
    }
  }
  // The lower working's far end is a face being worked too: gold and red.
  for (let y = LOWER_Y + 1; y <= LOWER_Y + 4; y++) {
    for (let z = lowerBack; z <= S + 1; z++) {
      const x = lowerX1 + 1;
      const c = cells[at(x, y, z)];
      if (c !== MATERIAL.rock && c !== MATERIAL.stone && c !== MATERIAL.deep) continue;
      const r = hash3(x, y, z, seed ^ 0x51c3);
      if (r < 0.24) cells[at(x, y, z)] = MATERIAL.oreGold;
      else if (r < 0.36) cells[at(x, y, z)] = MATERIAL.oreRed;
    }
  }
  // The gallery's back wall is the seam itself: gold and copper, thick.
  for (let x = galleryX0; x <= galleryX1; x++) {
    for (let y = GALLERY_Y + 1; y <= GALLERY_Y + 5; y++) {
      const z = galleryBack - 1;
      const c = cells[at(x, y, z)];
      if (c !== MATERIAL.rock && c !== MATERIAL.stone) continue;
      const r = hash3(x, y, z, seed ^ 0x9a1b);
      if (r < 0.2) cells[at(x, y, z)] = MATERIAL.oreGold;
      else if (r < 0.32) cells[at(x, y, z)] = MATERIAL.oreCopper;
    }
  }

  /* The find's walls. Lined all over with crystal, the room was one even
     cyan -- nothing in it brighter than anything else, so nothing in it
     glowed: a glow is only seen against a dark. So the lining goes to the
     dark stone of the deep band, and the crystal stays as clusters on it,
     thickest on the far wall the camera comes in facing. Done here, after
     the caves and the veins, because both work through dark stone: lined
     with it from the start, the room would have been holed by the one and
     speckled with gold by the other. The spires are left as they are. */
  for (let dy = -GB; dy <= GB; dy++) {
    for (let dz = -GB; dz <= GB; dz++) {
      for (let dx = -GB; dx <= GB; dx++) {
        const x = geodeX + dx;
        const y = geodeY + dy;
        const z = geodeZ + dz;
        if (!inside(x, y, z) || cells[at(x, y, z)] !== MATERIAL.oreCrystal) continue;
        const d = Math.hypot(dx, dy * 1.1, dz);
        if (d <= GR - 1.4 || d > GR) continue;
        // Clumped in pairs of blocks, with ragged edges, like the seams.
        const r = 0.7 * hash3(x >> 1, y >> 1, z >> 1, seed ^ 0x6e0d) + 0.3 * hash3(x, y, z, seed ^ 0x2c47);
        const far = Math.min(1, Math.max(0, -dz / GR));
        if (r > 0.3 + 0.3 * far) cells[at(x, y, z)] = MATERIAL.deep;
      }
    }
  }

  /* --- the one block that can be mined -------------------------------------
     In the gallery's back wall, near its middle and a block above the floor
     -- within reach of a pick -- and plain rock, so that breaking it reveals
     the ore behind it rather than more ore. Its faces are left out of the
     island's buffers while the cell stays SOLID, and a separate mesh that
     can move and crack fills the gap exactly. */
  let targetIdx = -1;
  const targetFace: [number, number, number] = [0, 0, 1];
  {
    const midX = Math.round((galleryX0 + galleryX1) / 2);
    let best = -Infinity;
    for (let x = galleryX0 + 2; x <= galleryX1 - 2; x++) {
      for (let y = GALLERY_Y + 1; y <= GALLERY_Y + 3; y++) {
        const z = galleryBack - 1;
        const m = cells[at(x, y, z)];
        if (m !== MATERIAL.rock && m !== MATERIAL.stone) continue;
        if (!carved.has(at(x, y, z + 1))) continue;
        let near = 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nb = cells[at(x + ox, y + oy, z)];
          if (nb >= MATERIAL.oreCopper && nb <= MATERIAL.oreCrystal) near++;
        }
        const score = -Math.abs(x - midX) * 0.6 - Math.abs(y - (GALLERY_Y + 2)) - near * 1.2;
        if (score > best) {
          best = score;
          targetIdx = at(x, y, z);
        }
      }
    }
  }

  /* --- the ledge and the portal ----------------------------------------------
     Boards on a beam, the beam on two raking struts back to the cliff: a
     cantilever you can see the structure of. The portal's frame stands a
     block proud of the rock so it reads as a frame and not as a stain round
     a hole. */
  const LEDGE_X0 = faceX + 1;
  /* A dressed face. The cliff is rough and the ledge is fixed to its
     furthest-in point, so elsewhere along the ledge's width the rock juts
     out over the boards -- in front of the portal, it blocked the way in.
     Cut back flat from the boards to the top: open air, not part of the dig. */
  for (let o = -LEDGE_HW; o <= LEDGE_HW; o++) {
    for (let x = LEDGE_X0; x < N; x++) {
      for (let y = LEDGE_Y + 1; y <= BASE_TOP + 1; y++) {
        const k = at(x, y, PORTAL_Z + o);
        if (cells[k] === EMPTY) continue;
        cells[k] = EMPTY;
        solid--;
      }
    }
  }
  for (let dx = 0; dx < LEDGE_LEN; dx++) {
    for (let o = -LEDGE_HW; o <= LEDGE_HW; o++) put(LEDGE_X0 + dx, LEDGE_Y, PORTAL_Z + o, MATERIAL.planks);
  }
  for (let o = -LEDGE_HW; o <= LEDGE_HW; o++) put(LEDGE_X0 + LEDGE_LEN - 1, LEDGE_Y - 1, PORTAL_Z + o, MATERIAL.wood);
  for (const o of [-LEDGE_HW, LEDGE_HW]) {
    for (let k = 0; k < LEDGE_LEN - 1; k++) {
      put(LEDGE_X0 + k, LEDGE_Y - (LEDGE_LEN - 1) + k, PORTAL_Z + o, MATERIAL.wood);
    }
  }
  for (let y = LEDGE_Y + 1; y <= LEDGE_Y + ADIT_H; y++) {
    for (const o of [-ADIT_HW - 1, ADIT_HW + 1]) {
      timber(faceX, y, PORTAL_Z + o);
      put(faceX + 1, y, PORTAL_Z + o, MATERIAL.wood);
    }
  }
  for (let o = -ADIT_HW - 1; o <= ADIT_HW + 1; o++) {
    timber(faceX, LEDGE_Y + ADIT_H + 1, PORTAL_Z + o);
    put(faceX + 1, LEDGE_Y + ADIT_H + 1, PORTAL_Z + o, MATERIAL.wood);
  }

  /* Ore showing in the cliff round the portal: a few specks of what is
     inside, on the outside, where the opening shot can see them. Only on
     faces open to the air, and sparse -- a tease, not a seam. */
  for (let z = PORTAL_Z - 14; z <= PORTAL_Z + 14; z++) {
    for (let y = LEDGE_Y - 9; y <= BASE_TOP - 5; y++) {
      for (let x = faceX - 2; x < N - 1; x++) {
        const m = cells[at(x, y, z)];
        if (m !== MATERIAL.stone && m !== MATERIAL.rock) continue;
        if (solidAt(x + 1, y, z)) continue;
        if (Math.abs(z - PORTAL_Z) <= LEDGE_HW + 1 && y >= LEDGE_Y - 6) continue;
        const h = hash3(x, y, z, seed ^ 0x0e5c);
        if (h < 0.05) cells[at(x, y, z)] = h < 0.018 ? MATERIAL.oreGold : MATERIAL.oreCopper;
      }
    }
  }

  /* --- the upper portal's frame -------------------------------------------------
     The climb cuts its way out through the first tier's cliff; this stands a
     frame round the hole, a block proud of the rock like the one below. */
  if (exitX > 0) {
    for (let y = BASE_TOP + 1; y <= BASE_TOP + 4; y++) {
      put(exitX + 1, y, EXIT_Z - 2, MATERIAL.wood);
      put(exitX + 1, y, EXIT_Z + 2, MATERIAL.wood);
    }
    for (let o = -2; o <= 2; o++) put(exitX + 1, BASE_TOP + 5, EXIT_Z + o, MATERIAL.wood);
  }

  /* --- the path, the hoist ----------------------------------------------------
     Gravel from the upper portal across the plateau to the hoist at the edge
     above the ledge -- the route a crew would actually wear into the turf. */
  const winchX = faceX - 1;
  const winchZ = PORTAL_Z + LEDGE_HW - 1;
  const reserved = new Set<number>();
  const reserve = (x: number, z: number, r: number) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (columnIn(x + dx, z + dz)) reserved.add((z + dz) * N + x + dx);
      }
    }
  };
  if (exitX > 0) {
    const p0 = [exitX + 2, EXIT_Z];
    const p1 = [exitX + 9, PORTAL_Z - 1];
    const p2 = [winchX - 1, winchZ - 1];
    for (let i = 0; i <= 80; i++) {
      const s = i / 80;
      const px = (1 - s) * (1 - s) * p0[0] + 2 * (1 - s) * s * p1[0] + s * s * p2[0];
      const pz = (1 - s) * (1 - s) * p0[1] + 2 * (1 - s) * s * p1[1] + s * s * p2[1];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.round(px + dx * 0.5);
          const z = Math.round(pz + dz * 0.5);
          if (!columnIn(x, z)) continue;
          const t = top[z * N + x];
          if (cells[at(x, t, z)] === MATERIAL.grass) cells[at(x, t, z)] = MATERIAL.gravel;
          reserved.add(z * N + x);
        }
      }
    }
    reserve(exitX + 2, EXIT_Z, 3);
  }
  reserve(winchX, winchZ, 3);
  for (const k of waterAt) reserve(k % N, Math.floor(k / N), 2);
  // Nothing grows over the skylight, or on the track out to the depot.
  reserve(skyX, skyZ, 3);
  for (let i = stops.exit; i < route.length; i++) reserve(route[i].x, route[i].z, 2);
  /* The beacon at the depot: three blocks square, behind the end of the
     track, on the turf. The props build it and the light comes from it. */
  const beaconAt = { x: route[stops.depot].x + 1, z: route[stops.depot].z - 3 };
  // Wide enough that no crown overhangs it: the beam goes straight up.
  reserve(beaconAt.x, beaconAt.z, 4);

  onProgress?.(0.33, "Growing the woods");

  /* --- the woods ---------------------------------------------------------------
     Two trees: an oak with a broad round crown, and a birch -- pale bark,
     taller, a narrower and lighter crown -- so the woods are two greens. A
     tall trunk under a narrow canopy reads as a lollipop on a stick, which is
     what the first pass grew; these are short and wide.

     Sited in a fixed scattered order, kept apart from each other, off the
     path and the water, and back from the edge of whatever they stand on so
     no trunk is planted on a lip. */
  let trees = 0;
  let rocks = 0;
  const placed: Array<[number, number]> = [];
  const farEnough = (x: number, z: number, min: number) =>
    placed.every(([px, pz]) => Math.hypot(px - x, pz - z) >= min);
  const nearDrop = (x: number, z: number, r: number) => {
    const t = top[z * N + x];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!columnIn(x + dx, z + dz)) return true;
        if (top[(z + dz) * N + x + dx] < t) return true;
      }
    }
    return false;
  };
  const oak = (x: number, z: number, ty: number, big: boolean) => {
    const trunk = big ? 6 : 5;
    for (let i = 0; i < trunk; i++) put(x, ty + i, z, MATERIAL.wood);
    const cy = ty + trunk;
    const r = big ? 3 : 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
        put(x + dx, cy - 2, z + dz, MATERIAL.leaf);
        put(x + dx, cy - 1, z + dz, MATERIAL.leaf);
        if (Math.abs(dx) < r && Math.abs(dz) < r) put(x + dx, cy, z + dz, MATERIAL.leaf);
      }
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(x + dx, cy + 1, z + dz, MATERIAL.leaf);
      }
    }
  };
  const birch = (x: number, z: number, ty: number) => {
    const trunk = 7;
    for (let i = 0; i < trunk; i++) put(x, ty + i, z, MATERIAL.birch);
    const cy = ty + trunk;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        put(x + dx, cy - 2, z + dz, MATERIAL.birchLeaf);
        if (Math.abs(dx) + Math.abs(dz) <= 2) put(x + dx, cy - 1, z + dz, MATERIAL.birchLeaf);
      }
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(x + dx, cy, z + dz, MATERIAL.birchLeaf);
      }
    }
    put(x, cy + 1, z, MATERIAL.birchLeaf);
  };

  /* A fixed permutation of the columns: 7919 is prime and shares no factor
     with the grid's area, so stepping by it visits every column once in a
     scattered order. Siting in raster order instead crowds the first rows. */
  const AREA = N * N;
  for (let i = 0; i < AREA; i++) {
    const k = (i * 7919) % AREA;
    const x = k % N;
    const z = Math.floor(k / N);
    if (!columnIn(x, z) || reserved.has(k)) continue;
    const t = top[k];
    if (cells[at(x, t, z)] !== MATERIAL.grass) continue;
    const r = hash2(x, z, seed ^ 0x2f1b);
    // Woods, not a forest: room left between them for the tiers to read.
    if (trees < 19 && r > 0.93 && farEnough(x, z, 7) && !nearDrop(x, z, 2)) {
      if (hash2(z, x, seed ^ 0x6b1) < 0.36) birch(x, z, t + 1);
      else oak(x, z, t + 1, r > 0.965);
      placed.push([x, z]);
      reserve(x, z, 1);
      trees++;
    } else if (r > 0.86 && r < 0.885 && !nearDrop(x, z, 1)) {
      /* Bushes: a block or two of leaf. Cheap, and detail density is most of
         what tells the eye how large the island is. */
      put(x, t + 1, z, MATERIAL.leaf);
      if (r > 0.875) put(x + 1, t + 1, z, MATERIAL.leaf);
      reserved.add(k);
    }
  }

  /* --- small plants -------------------------------------------------------------
     Not cubes: cards, drawn by their own program -- see the plant pass in the
     renderer. Tufts and flowers on open turf; vines hanging down the cliffs
     from their top edge; roots hanging from the underside's steps. Each is
     seven numbers -- see SiteInfo. */
  const plants: number[] = [];
  const TUFTS = [TILE.tuft, TILE.tuft, TILE.tuft, TILE.fern];
  const FLOWERS = [TILE.flowerRed, TILE.flowerYellow, TILE.flowerBlue];
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const k = z * N + x;
      if (!columnIn(x, z)) continue;
      const t = top[k];
      if (cells[at(x, t, z)] !== MATERIAL.grass) continue;
      if (solidAt(x, t + 1, z) || reserved.has(k)) continue;
      const r = hash2(x, z, seed ^ 0x7a11);
      /* Meadows: patches where the flowers gather, one colour leading in
         each, as against a thin scatter at one rate over the whole island,
         which read as specks of colour rather than as flowers. */
      const meadow = valueNoise(x * 0.16, z * 0.16, seed ^ 0x51f3);
      if (meadow > 0.6 && r > 0.45) {
        const hue = valueNoise(x * 0.07 + 13.1, z * 0.07 - 7.3, seed ^ 0x2be1);
        const lead = hue < 0.42 ? 0 : hue < 0.68 ? 1 : 2;
        const tile = FLOWERS[r > 0.9 ? (lead + 1) % 3 : lead];
        plants.push(x - HALF, t + 0.5, z - HALF, tile, 0, 0, 0.75, z >= CUT_GZ ? 1 : 0);
      } else if (r < 0.2) {
        plants.push(x - HALF, t + 0.5, z - HALF, TUFTS[Math.floor(r * 20) % 4], 0, 0, 0.7 + r * 1.5, z >= CUT_GZ ? 1 : 0);
      } else if (r < 0.245) {
        plants.push(x - HALF, t + 0.5, z - HALF, FLOWERS[Math.floor(r * 400) % 3], 0, 0, 0.75, z >= CUT_GZ ? 1 : 0);
      }
    }
  }

  /* Vines: from a top edge down the cliff below it, as far as the cliff goes
     and no further. Kept off the ledge, the portals and the falls -- a vine
     across a doorway is a curtain. */
  const SIDES: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 1],
    [0, 1, 4],
    [0, -1, 5],
  ];
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const k = z * N + x;
      if (!columnIn(x, z) || waterAt.has(k)) continue;
      const t = top[k];
      for (const [dx, dz, f] of SIDES) {
        const nx = x + dx;
        const nz = z + dz;
        const out = !columnIn(nx, nz);
        const below = out ? bot[k] : top[nz * N + nx];
        const drop = t - below;
        if (drop < 3) continue;
        if (Math.abs(z - PORTAL_Z) <= LEDGE_HW + 2 && dx === 1) continue;
        if (Math.abs(z - EXIT_Z) <= 3 && dx === 1) continue;
        if (Math.abs(x - pondX) <= 3 && dz === 1) continue;
        const r = hash3(x, f, z, seed ^ 0x1d3a);
        if (r > (out ? 0.11 : 0.16)) continue;
        const len = Math.min(drop - 1, out ? 3 + Math.floor(r * 70) : 2 + Math.floor(r * 25));
        plants.push(x - HALF, t + 0.5, z - HALF, TILE.vine, 1, f, len, z >= CUT_GZ ? 1 : 0);
      }
    }
  }

  /* Roots from the underside, and the odd stalactite: hung from the edges of
     the steps, where they are seen against the sky from the side. */
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const k = z * N + x;
      const b = bot[k];
      if (b < 0) continue;
      let edge = false;
      for (const [dx, dz] of SIDES) {
        if (!columnIn(x + dx, z + dz) || bot[(z + dz) * N + x + dx] > b) edge = true;
      }
      if (!edge) continue;
      const r = hash2(x, z, seed ^ 0x40c7);
      if (r < 0.1) {
        plants.push(x - HALF, b - 0.5, z - HALF, TILE.root, 2, 0, 2 + Math.floor(r * 45), z >= CUT_GZ ? 1 : 0);
      } else if (r > 0.975 && b > 4) {
        const len = 2 + Math.floor((r - 0.975) * 120);
        for (let i = 1; i <= len && b - i >= 0; i++) set(x, b - i, z, b - i >= DEEP_Y ? MATERIAL.rock : MATERIAL.deep);
        rocks++;
      }
    }
  }

  const toWorld = (p: Pt) => ({ x: p.x - HALF, y: p.y, z: p.z - HALF });
  const site: SiteInfo = {
    ledge: {
      x: LEDGE_X0 + (LEDGE_LEN - 1) / 2 - HALF,
      y: LEDGE_Y + 0.5,
      z: PORTAL_Z - HALF,
      out: [1, 0],
      across: [0, 1],
      face: faceX + 0.5 - HALF,
      len: LEDGE_LEN,
      half: LEDGE_HW,
    },
    exit: { x: exitX + 1.5 - HALF, y: BASE_TOP + 0.5, z: EXIT_Z - HALF, out: [1, 0] },
    winch: { x: winchX - HALF, y: top[winchZ * N + winchX] + 0.5, z: winchZ - HALF },
    summit: { x: summit.cx, y: summit.top + 0.5, z: summit.cz },
    top: BASE_TOP,
    half: BASE_HALF,
    plants: new Float32Array(plants),
  };

  onProgress?.(0.35, "Letting in the daylight");

  /* --- how far daylight gets -----------------------------------------------
     A flood through the carved air only, starting at the shaft mouth. The
     island's exterior is never visited, so its approved shading is untouched;
     the value is applied as a MINIMUM against the existing sky-access figure,
     which means a face can only ever be made darker by being buried.

     It is a flood rather than a formula because the shape matters: the shaft
     carries light straight down, the chamber takes it round a corner, and a
     depth-based falloff would light the chamber roof as brightly as the
     shaft beside it. */
  const LIGHT_MAX = 46;
  const DOWN_COST = 2;
  const SIDE_COST = 4;
  const day = new Map<number, number>();
  const queue: number[] = [];

  /* Seeded at the two mouths: the portal on the ledge and the stub behind
     the upper one. */
  const mouth = (x: number, z: number, y0: number, hw: number) => {
    for (let o = -hw; o <= hw; o++) {
      for (let y = y0; y < y0 + ADIT_H; y++) {
        const k = at(x, y, z + o);
        if (!carved.has(k)) continue;
        day.set(k, LIGHT_MAX);
        queue.push(x, y, z + o);
      }
    }
  };
  mouth(faceX, PORTAL_Z, LEDGE_Y + 1, ADIT_HW);
  if (exitX > 0) mouth(exitX, EXIT_Z, BASE_TOP + 1, 1);
  for (let i = 0; i < skylight.length; i += 3) {
    const k = at(skylight[i], skylight[i + 1], skylight[i + 2]);
    day.set(k, LIGHT_MAX);
    queue.push(skylight[i], skylight[i + 1], skylight[i + 2]);
  }

  for (let head = 0; head < queue.length; head += 3) {
    const cx = queue[head];
    const cy = queue[head + 1];
    const cz = queue[head + 2];
    const here = day.get(at(cx, cy, cz)) ?? 0;
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = NB[f];
      const nx = cx + dx;
      const ny = cy + dy;
      const nz = cz + dz;
      if (!inside(nx, ny, nz)) continue;
      /* Only through what was dug. The open air outside is empty too, and a
         flood let loose in it darkens the island's own cliffs. */
      if (!carved.has(at(nx, ny, nz))) continue;
      const next = here - (dy !== 0 ? DOWN_COST : SIDE_COST);
      if (next <= 0) continue;
      const k = at(nx, ny, nz);
      if ((day.get(k) ?? 0) >= next) continue;
      day.set(k, next);
      queue.push(nx, ny, nz);
    }
  }

  /* Outside the carved air there is no entry, which means full daylight --
     the flood is a way of DARKENING what it reached, not of lighting the
     island. */
  const dayAt = (x: number, y: number, z: number) => {
    if (!inside(x, y, z)) return 1;
    const k = at(x, y, z);
    const l = day.get(k);
    // Carved but out of reach of the flood: the far end of the chamber.
    if (l === undefined) return carved.has(k) ? 0.035 : 1;
    return Math.max(0.035, Math.pow(l / LIGHT_MAX, 0.85));
  };

  /* Daylight per cell, 0-255, for whatever stands in the mine without being
     part of the grid -- the crew, the cart, the rails. Outside the dig the
     flood never ran and the value is full sky, exactly as for the faces. */
  const daylight = new Uint8Array(N * N * H).fill(255);
  /* And with the island open: dug air that sees out through the cut is in
     daylight; the rest is as it was. */
  const daylightOpen = new Uint8Array(N * N * H).fill(255);
  for (const k of carved) {
    const l = day.get(k);
    const v = l === undefined ? 0.035 : Math.max(0.035, Math.pow(l / LIGHT_MAX, 0.85));
    daylight[k] = Math.round(v * 255);
    daylightOpen[k] = daylight[k];
  }

  /* --- the lanterns ---------------------------------------------------------
     Decided here, once, because two things need the answer: the props that
     draw a lantern and the light that comes out of it. Decided in two places
     they drift apart, and a pool of warm light on a wall with nothing near it
     reads as a fault in the renderer. */
  const lamps: Lamp[] = [];
  /* Along the track, nine apart: far enough for the light to fall away
     between them, so a tunnel is a string of pools and not one lit corridor.
     Against the wall AWAY from the cut, so none is standing in the half of
     the tunnel that goes when the island opens. */
  route.forEach((p, i) => {
    if (i <= stops.portal + 1 || i >= stops.exit - 1) return;
    if (i % 9 !== 4 || onBridge(p)) return;
    const a = route[Math.max(0, i - 1)];
    const b = route[Math.min(route.length - 1, i + 1)];
    const alongX = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z);
    const side = (i >= stops.climb ? 1 : 2) + 0.1;
    lamps.push({
      x: p.x - (alongX ? 0 : side) - HALF,
      y: p.y + 0.5,
      z: p.z - (alongX ? side : 0) - HALF,
      hang: 0,
    });
  });
  // A pair at the ledge's outer corners, and a pair at the depot.
  for (const side of [LEDGE_HW - 0.6, -(LEDGE_HW - 0.6)]) {
    lamps.push({ x: LEDGE_X0 + LEDGE_LEN - 1.5 - HALF, y: LEDGE_Y + 0.5, z: PORTAL_Z + side - HALF, hang: 0 });
  }
  {
    // Past the buffer, either side of the line: not between it and the portal.
    const d = route[stops.depot];
    for (const side of [1.4, -1.4]) {
      lamps.push({ x: d.x + 1 - HALF, y: d.y + 0.5, z: d.z + side - HALF, hang: 0 });
    }
  }

  /* Hanging from the gallery's roof, over the face: hung rather than stood
     on a post because the floor there is where the crew works. Each only
     accepted with air under it and a roof within a chain's reach. */
  const hangLamp = (lx: number, lz: number, want: number) => {
    if (!inside(lx, want, lz) || cells[at(lx, want, lz)] !== EMPTY) return false;
    if (cells[at(lx, want - 1, lz)] !== EMPTY) return false;
    for (let y = want + 1; y < Math.min(H, want + 8); y++) {
      if (cells[at(lx, y, lz)] === EMPTY) continue;
      lamps.push({ x: lx - HALF, y: want, z: lz - HALF, hang: y - 0.5 - (want + 0.35) });
      return true;
    }
    return false;
  };
  for (const lx of [galleryX0 + 3, galleryX1 - 3]) hangLamp(lx, galleryBack + 2, GALLERY_Y + 4);
  hangLamp(Math.round((forgeX0 + forgeX1) / 2), S - 2, FORGE_Y + 5);
  for (const lx of [lowerX0 + 3, lowerX1 - 2]) hangLamp(lx, S - 1, LOWER_Y + 3);
  /* Two just inside the upper portal, over the track: the cart comes up
     out of the dark into the day, and without them the mouth it comes out
     of is a black rectangle. */
  for (const back of [2, 7]) {
    /* Three over that point's floor -- the incline is still climbing here --
       and over the side of the way, not its middle, where the crew walk. */
    const at = route.find((q) => q.x === exitX - back && q.z === EXIT_Z);
    if (at) hangLamp(at.x, EXIT_Z - 1, at.y + 3);
  }

  /* The forge's fires: three furnaces along its back wall. The props stand
     the furnaces there and the light comes out of the same three points. */
  const fires: Pt[] = [];
  // East of where the track turns into the back wall, clear of the cart.
  for (const fx of [forgeX1 - 4, forgeX1 - 2, forgeX1]) {
    fires.push({ x: fx, y: FORGE_Y, z: S - 5 });
  }

  onProgress?.(0.36, "Lighting the lanterns");

  /* --- block light -----------------------------------------------------------
     The way caves are lit in every game of this kind, and the reason it looks
     right: a level from 0 to 15 per cell, flooded outward through the air
     from each source and losing one a block. A sealed room with three
     lanterns in it gets three pools of light with darkness between them,
     which is exactly what a single travelling lamp could never produce.

     Two floods rather than one coloured one. Combining warm and cyan sources
     into a single RGB value at build time would fix their balance forever;
     kept apart, the shader can flicker the flames without flickering the
     crystal, and the reveal can turn the crystal up as the visitor arrives. */
  const lightW = new Uint8Array(N * N * H);
  const lightC = new Uint8Array(N * N * H);
  const flood = (grid: Uint8Array, seeds: number[]) => {
    const q: number[] = [];
    for (let i = 0; i < seeds.length; i += 4) {
      const sx = seeds[i];
      const sy = seeds[i + 1];
      const sz = seeds[i + 2];
      const lv = seeds[i + 3];
      if (!inside(sx, sy, sz)) continue;
      const k = at(sx, sy, sz);
      if (cells[k] !== EMPTY || grid[k] >= lv) continue;
      grid[k] = lv;
      q.push(sx, sy, sz);
    }
    for (let h = 0; h < q.length; h += 3) {
      const cx = q[h];
      const cy = q[h + 1];
      const cz = q[h + 2];
      const next = grid[at(cx, cy, cz)] - 1;
      if (next <= 0) continue;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = NB[f];
        const nx = cx + dx;
        const ny = cy + dy;
        const nz = cz + dz;
        if (!inside(nx, ny, nz)) continue;
        const k = at(nx, ny, nz);
        if (cells[k] !== EMPTY || grid[k] >= next) continue;
        grid[k] = next;
        q.push(nx, ny, nz);
      }
    }
  };

  const warmSeeds: number[] = [];
  for (const l of lamps) {
    const gy = l.hang > 0 ? Math.round(l.y) : Math.round(l.y + 0.95);
    warmSeeds.push(Math.round(l.x + HALF), gy, Math.round(l.z + HALF), 14);
  }
  for (const f of fires) warmSeeds.push(f.x, f.y + 2, f.z + 1, 15);
  // Lava lights the whole chasm from below.
  for (let i = 0; i < lavaAt.length; i += 3) warmSeeds.push(lavaAt[i], lavaAt[i + 1] + 1, lavaAt[i + 2], 15);
  /* Glowing ore: light seeded into the air touching each block. Crystal in
     the cavern is the find and burns bright; crystal anywhere else is a seam
     and only glimmers; gold gives the faintest warm sheen, enough to catch on
     the wall beside it and no more. */
  const crystalSeeds: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const m = cells[at(x, y, z)];
        if (m !== MATERIAL.oreCrystal && m !== MATERIAL.oreGold && m !== MATERIAL.oreRed) continue;
        const inGeode = Math.hypot(x - geodeX, y - geodeY, z - geodeZ) <= GR + 1;
        const lv = m === MATERIAL.oreCrystal ? (inGeode ? 12 : 8) : m === MATERIAL.oreRed ? 6 : 5;
        const into = m === MATERIAL.oreCrystal ? crystalSeeds : warmSeeds;
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = NB[f];
          into.push(x + dx, y + dy, z + dz, lv);
        }
      }
    }
  }
  flood(lightW, warmSeeds);
  flood(lightC, crystalSeeds);

  /* --- corners ---------------------------------------------------------------
     Per-corner ambient occlusion and light, sampled the way smooth lighting
     has always been done in this genre: each corner of a face looks at the
     layer of air in front of the face -- the cell straight out, the two
     beside it along the face's edges, and the one diagonally across -- and
     counts how many are solid.

     It is the single strongest depth cue in voxel art. Two blocks meeting in
     a corner get a soft shadow along the join, a ledge darkens the wall under
     it, and a tunnel's floor goes dark at the walls. Flat-shaded faces have
     none of it, which is a large part of why the last build looked like
     cardboard.

     The bases are the vertex shader's, face by face: the shader interpolates
     these four values with the same (t, b) frame, so any disagreement here
     puts a shadow in the wrong corner of every block on the island. */
  const BASIS_T: Array<[number, number, number]> = [
    [0, 0, -1],
    [0, 0, 1],
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  const BASIS_B: Array<[number, number, number]> = [
    [0, 1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
  ];
  /* Occlusion 0..3 to brightness. Kept well off black: this is the shadow in
     a joint, and a corner taken to near-zero reads as a hole. */
  const AO_CURVE = [0.5, 0.67, 0.84, 1.0];
  // Light level to intensity: squared, so a pool falls off like a pool.
  const LUX = Array.from({ length: 16 }, (_, l) => (l / 15) ** 2);
  const occludes = (x: number, y: number, z: number) => {
    if (!inside(x, y, z)) return false;
    const m = cells[at(x, y, z)];
    return m !== EMPTY && m !== MATERIAL.water && m !== MATERIAL.fall;
  };
  const lux = (grid: Uint8Array, x: number, y: number, z: number) =>
    inside(x, y, z) ? LUX[grid[at(x, y, z)]] : 0;
  const cAO = [1, 1, 1, 1];
  const cW = [0, 0, 0, 0];
  const cC = [0, 0, 0, 0];
  const corners = (x: number, y: number, z: number, f: number) => {
    const [nx, ny, nz] = NB[f];
    const t = BASIS_T[f];
    const b = BASIS_B[f];
    const fx = x + nx;
    const fy = y + ny;
    const fz = z + nz;
    let k = 0;
    // Order: (-t,-b) (+t,-b) (-t,+b) (+t,+b), which is the shader's bilerp.
    for (const sv of [-1, 1]) {
      for (const su of [-1, 1]) {
        const ax = fx + su * t[0];
        const ay = fy + su * t[1];
        const az = fz + su * t[2];
        const bx = fx + sv * b[0];
        const by = fy + sv * b[1];
        const bz = fz + sv * b[2];
        const cx = ax + sv * b[0];
        const cy = ay + sv * b[1];
        const cz = az + sv * b[2];
        const o1 = occludes(ax, ay, az) ? 1 : 0;
        const o2 = occludes(bx, by, bz) ? 1 : 0;
        const oc = occludes(cx, cy, cz) ? 1 : 0;
        cAO[k] = AO_CURVE[o1 && o2 ? 0 : 3 - (o1 + o2 + oc)];
        /* Light is the average of the open cells among the four, never
           counting the diagonal when both sides are shut: light cannot get
           round a corner that is sealed on both edges. */
        let w = lux(lightW, fx, fy, fz);
        let c = lux(lightC, fx, fy, fz);
        let n = 1;
        if (!o1) {
          w += lux(lightW, ax, ay, az);
          c += lux(lightC, ax, ay, az);
          n++;
        }
        if (!o2) {
          w += lux(lightW, bx, by, bz);
          c += lux(lightC, bx, by, bz);
          n++;
        }
        if (!oc && !(o1 && o2)) {
          w += lux(lightW, cx, cy, cz);
          c += lux(lightC, cx, cy, cz);
          n++;
        }
        cW[k] = w / n;
        cC[k] = c / n;
        k++;
      }
    }
  };

  /* --- sky access ----------------------------------------------------------
     How much sky each column sees, from how far its neighbours rise above it.
     Computed per column rather than per face, which keeps every face
     perfectly flat: brightness varies BETWEEN cubes, never across one. */
  const sky = new Float32Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const h = top[z * N + x];
      let blocked = 0;
      let n = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dz === 0) continue;
          const ox = x + dx;
          const oz = z + dz;
          if (ox < 0 || oz < 0 || ox >= N || oz >= N) continue;
          if (bot[oz * N + ox] < 0) continue;
          const fall = 1 / (Math.abs(dx) + Math.abs(dz));
          blocked += Math.max(0, Math.min(6, top[oz * N + ox] - h)) * fall;
          n += 6 * fall;
        }
      }
      sky[z * N + x] = n > 0 ? 1 - blocked / n : 1;
    }
  }

  onProgress?.(0.53, "Laying the faces");

  /* --- emit ---------------------------------------------------------------- */
  const offsets: number[] = [];
  const materials: number[] = [];
  const aos: number[] = [];
  const tints: number[] = [];

  let target: MineTarget | null = null;

  const fOffsets: number[] = [];
  const fDirs: number[] = [];
  const fMaterials: number[] = [];
  const fAos: number[] = [];
  const fTints: number[] = [];
  const fTiles: number[] = [];
  const fCorner: number[] = [];
  const fLightW: number[] = [];
  const fLightC: number[] = [];
  /* The cut. Each face says which half it moves with and whether it is part
     of the cross-section -- the faces along the cut plane that only exist
     while the island is open -- and how much sky it sees when it is. */
  const fHalf: number[] = [];
  const fAoOpen: number[] = [];
  /** Air that sees out through the cut once the island is open: a clear run
      toward +z, through what stays, to the plane itself. */
  const opensOut = (x: number, y: number, z: number) => {
    if (z >= CUT_GZ) return true;
    for (let k = z + 1; k < CUT_GZ; k++) if (cells[at(x, y, k)] !== EMPTY) return false;
    return true;
  };
  /* How much sky a face sees through the opened cut, by which way it faces:
     straight out most, the floors and walls of an opened tunnel half, its
     roof least. */
  const OPEN_SKY = [0.7, 0.7, 0.78, 0.5, 0.95, 0];
  for (const k of carved) {
    const x = k % N;
    const z = Math.floor(k / N) % N;
    const y = Math.floor(k / (N * N));
    if (z < CUT_GZ && opensOut(x, y, z)) daylightOpen[k] = Math.max(daylightOpen[k], 225);
  }

  for (let y = 0; y < H; y++) {
    // Nearly half the build: the bar keeps moving through it.
    if (y % 6 === 0) onProgress?.(0.53 + 0.46 * (y / H), "Laying the faces");
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const m = cells[at(x, y, z)];
        if (m === EMPTY) continue;

        /* On the cut plane, with solid rock across it: there is a face here
           the open island shows, whatever the other five sides are doing. */
        const front = z >= CUT_GZ;
        const onCut =
          (z === CUT_GZ - 1 && solidAt(x, y, z + 1)) || (z === CUT_GZ && solidAt(x, y, z - 1));
        // Sealed on all six sides: it can never be seen, so never draw it.
        if (
          !onCut &&
          solidAt(x + 1, y, z) &&
          solidAt(x - 1, y, z) &&
          solidAt(x, y + 1, z) &&
          solidAt(x, y - 1, z) &&
          solidAt(x, y, z + 1) &&
          solidAt(x, y, z - 1)
        ) {
          continue;
        }

        let ao: number;
        if (m === MATERIAL.fall) {
          // How far under its lip this cell is, in blocks -- see the water.
          ao = fallDrop.get(at(x, y, z))?.[0] ?? 0;
        } else if (m === MATERIAL.water) {
          // Water is lit by its own shader branch; sinking it into the
          // column's shadow just makes it look like dirty glass.
          ao = 0.97;
        } else if (
          m === MATERIAL.wood ||
          m === MATERIAL.leaf ||
          m === MATERIAL.birch ||
          m === MATERIAL.birchLeaf ||
          m === MATERIAL.planks
        ) {
          /* Props stand clear of the ground and are not in its shadow.
             Inheriting the column's sky value would black out a tree grown
             in a hollow. */
          ao =
            m === MATERIAL.leaf || m === MATERIAL.birchLeaf
              ? 0.78 + hash3(x, y, z, seed) * 0.22
              : 0.9;
        } else {
          const t = top[z * N + x];
          const depth = Math.max(0, t - y);
          // Underside and deep cliff faces fall away into shadow.
          /* Capped lower than before: at 0.55 the keel fell so far into
             shadow that the taper was invisible against the backdrop, which
             defeated the point of having one. */
          /* Gently, now. This was tuned to sink the old keel into shadow; with
             a real sun and a real fill, the extra darkening put the whole
             shaded rock face under the ledge at black. */
          ao = sky[z * N + x] * (1 - Math.min(0.22, depth * 0.01));
        }

        /* A fall's slot is a distance, not a light level, and is left as it
           is. */
        const isFall = m === MATERIAL.fall;
        const aoC = isFall ? ao : Math.max(0.22, Math.min(1, ao));
        /* Per-cube jitter, cut from +/-12% to +/-4%.

            It exists to stop a cliff being one flat rectangle, and at the old
            width it did something else as well: the spread WITHIN a band was
            measured at 1.46 while dirt and rock differed by only 1.28, so a
            bright rock block was lighter than a dark dirt one and the strata
            dissolved. Definition now comes from the face edges instead,
            which adds structure without adding luminance noise. */
        /* A fall's carries the height of the whole fall instead, which with
           the distance under the lip says how far down it this block is. */
        const tintC = isFall
          ? (fallDrop.get(at(x, y, z))?.[1] ?? 1)
          : 0.96 + hash3(x, y, z, seed ^ 0x5bd1) * 0.08;

        /* A face is emitted only where the neighbour on that side is empty --
           and since that neighbour is the air the face looks out into, it is
           also the thing that says how much daylight the face receives. Taken
           as a minimum against the sky-access figure: outside the dig the
           flood never ran, dayAt returns 1, and nothing changes. */
        // Drawn by the mineable-block mesh instead; see the pick above.
        const isTarget = targetIdx >= 0 && at(x, y, z) === targetIdx;
        /* A quarter-turn per block for the tiles that have no up or down, so a
           cliff of one material is not one picture repeated. Per BLOCK, not
           per face, so the faces of one cube still agree with each other. */
        const turn = Math.floor(hash3(x, y, z, seed ^ 0x2c71) * 4);

        let open = 0;
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = NB[f];
          const ax = x + dx;
          const ay = y + dy;
          const az = z + dz;
          /* The cross-section: the face between the two halves, toward the
             half that goes. Hidden while the island is closed; open, it is
             a face of the cut, square to the daylight, with nothing in front
             of it to darken its corners. */
          if ((f === 4 && z === CUT_GZ - 1) || (f === 5 && z === CUT_GZ)) {
            if (solidAt(ax, ay, az) && !isTarget) {
              fOffsets.push(x - HALF, y, z - HALF);
              fDirs.push(f);
              fMaterials.push(m === MATERIAL.water || m === MATERIAL.fall ? MATERIAL.stone : m);
              fAos.push(1);
              fTints.push(tintC);
              fTiles.push(tileFor(m === MATERIAL.water || m === MATERIAL.fall ? MATERIAL.stone : m, f, turn));
              fHalf.push(front ? 3 : 2);
              fAoOpen.push(1);
              for (let c = 0; c < 4; c++) {
                fCorner.push(1);
                fLightW.push(0);
                fLightC.push(0);
              }
              continue;
            }
          }
          if (solidAt(ax, ay, az)) continue;
          const d = dayAt(ax, ay, az);
          if (d > open) open = d;
          if (isTarget) continue;
          fOffsets.push(x - HALF, y, z - HALF);
          fDirs.push(f);
          fMaterials.push(m);
          fAos.push(isFall ? aoC : Math.min(aoC, d));
          fTints.push(tintC);
          /* The water's top: flagged above the tile and its turn where it
             runs (bit 10) and where a fall churns it (bit 11). */
          const here = at(x, y, z);
          const wet =
            m === MATERIAL.water && f === 2
              ? (flowAt.has(here) ? 1024 : 0) + (churnAt.has(here) ? 2048 : 0)
              : 0;
          fTiles.push(tileFor(m, f, turn) + wet);
          fHalf.push(front ? 1 : 0);
          /* Once open, a face of the half that stays sees the sky through
             the cut if nothing stands between it and the plane. */
          const closedAo = isFall ? aoC : Math.min(aoC, d);
          fAoOpen.push(!front && opensOut(ax, ay, az) ? Math.max(closedAo, OPEN_SKY[f]) : closedAo);
          corners(x, y, z, f);
          /* Water takes no contact shadow: a pond is lit as a sheet, and
             darkening its rim makes it read as a dish. */
          const flat = m === MATERIAL.water || m === MATERIAL.fall;
          for (let c = 0; c < 4; c++) {
            fCorner.push(flat ? 1 : cAO[c]);
            fLightW.push(cW[c]);
            fLightC.push(cC[c]);
          }
        }

        if (isTarget) {
          /* Its sky access and jitter go with it, so the separate draw can
             reproduce exactly what this cell would have looked like. A block
             that is a shade off from the wall it sits in announces itself
             before anyone is meant to notice it. */
          const tf = NB.findIndex(
            ([a, b, c]) => a === targetFace[0] && b === targetFace[1] && c === targetFace[2],
          );
          corners(x, y, z, tf);
          const [fx, fy, fz] = NB[tf];
          const closed = Math.min(aoC, open);
          target = {
            x: x - HALF,
            y,
            z: z - HALF,
            ao: closed,
            aoOpen: z < CUT_GZ && opensOut(x + fx, y + fy, z + fz) ? Math.max(closed, OPEN_SKY[tf]) : closed,
            tint: tintC,
            face: targetFace,
            material: m,
            tile: tileFor(m, tf, turn),
            cornerAO: [...cAO],
            lightW: [...cW],
            lightC: [...cC],
          };
          continue;
        }

        /* The cube path has one value for all six sides, so it takes the
           brightest -- a block in a wall is lit by the side facing the room,
           not by the five buried in rock. */
        offsets.push(x - HALF, y, z - HALF);
        materials.push(m);
        aos.push(isFall ? aoC : Math.min(aoC, open));
        tints.push(tintC);
      }
    }
  }

  /* --- the falling columns -------------------------------------------------
     Emitted straight into the buffers rather than through the voxel grid,
     for one reason: they run down to y = -42 and the grid starts at 0. They
     also want none of what the grid gives -- no sky-access shadow on a sheet
     of falling water, and no neighbour culling against terrain they never
     touch. Only their own interior faces need removing. */
  const fallMeta: Array<{ x: number; z: number }> = [];
  for (const f of fallPlan) {
    const px = f.dz;
    const pz = -f.dx;
    const col: Array<[number, number]> = [];
    for (let k = 1; k <= 2; k++) {
      for (let j = 0; j <= 1; j++) {
        col.push([f.x + f.dx * k + px * j, f.z + f.dz * k + pz * j]);
      }
    }
    /* Keyed on a packed integer rather than a template string: this is
       checked four times per block for the whole length of every fall, and
       a string key allocates on each one. */
    const key = (cx: number, cz: number) => cx * 256 + cz;
    const inCol = new Set(col.map(([cx, cz]) => key(cx, cz)));
    const SIDES: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 1],
      [0, 1, 4],
      [0, -1, 5],
    ];

    const span = Math.max(1, f.lip - SEA_Y);
    for (const [cx, cz] of col) {
      for (let y = f.lip; y > SEA_Y; y--) {
        /* The AO slot carries how far under the lip this block is, in
           blocks, and the tint slot how tall the whole fall is. Falling
           water has no sky-access shadow and takes no jitter, so both
           channels were dead weight, and the shader needs the two to run
           the water faster the further it has fallen and to break it white
           at the crest and the base -- without either a seventh attribute or
           a uniform per fall. */
        const tintC = span;
        const prog = f.lip - y;
        offsets.push(cx - HALF, y, cz - HALF);
        materials.push(MATERIAL.fall);
        aos.push(prog);
        tints.push(tintC);

        for (const [dx, dz, face] of SIDES) {
          if (inCol.has(key(cx + dx, cz + dz))) continue;
          fOffsets.push(cx - HALF, y, cz - HALF);
          fDirs.push(face);
          fMaterials.push(MATERIAL.fall);
          fAos.push(prog);
          fTints.push(tintC);
          fTiles.push(tileFor(MATERIAL.fall, face, 0));
          fCorner.push(1, 1, 1, 1);
          fLightW.push(0, 0, 0, 0);
          fLightC.push(0, 0, 0, 0);
          fHalf.push(cz >= CUT_GZ ? 1 : 0);
          fAoOpen.push(prog);
        }
        // Only the lip shows a top face; the base is under the sea surface.
        if (y === f.lip) {
          fOffsets.push(cx - HALF, y, cz - HALF);
          fDirs.push(2);
          fMaterials.push(MATERIAL.fall);
          fAos.push(prog);
          fTints.push(tintC);
          fTiles.push(tileFor(MATERIAL.fall, 2, 0));
          fCorner.push(1, 1, 1, 1);
          fLightW.push(0, 0, 0, 0);
          fLightC.push(0, 0, 0, 0);
          fHalf.push(cz >= CUT_GZ ? 1 : 0);
          fAoOpen.push(prog);
        }
      }
    }

    fallMeta.push({
      x: f.x + f.dx * 1.5 + px * 0.5 - HALF,
      z: f.z + f.dz * 1.5 + pz * 0.5 - HALF,
    });
  }

  const colTop = new Int16Array(N * N).fill(-1);
  const colBottom = new Int16Array(N * N).fill(-1);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < H; y++) {
        if (cells[at(x, y, z)] === EMPTY) continue;
        if (colBottom[z * N + x] < 0) colBottom[z * N + x] = y;
        colTop[z * N + x] = y;
      }
    }
  }

  return {
    offset: new Float32Array(offsets),
    material: new Float32Array(materials),
    ao: new Float32Array(aos),
    tint: new Float32Array(tints),
    count: materials.length,
    faceOffset: new Float32Array(fOffsets),
    faceDir: new Float32Array(fDirs),
    faceMaterial: new Float32Array(fMaterials),
    faceAo: new Float32Array(fAos),
    faceTint: new Float32Array(fTints),
    faceTile: new Float32Array(fTiles),
    faceCornerAO: new Float32Array(fCorner),
    faceLightW: new Float32Array(fLightW),
    faceLightC: new Float32Array(fLightC),
    faceCount: fDirs.length,
    faceHalf: new Float32Array(fHalf),
    faceAoOpen: new Float32Array(fAoOpen),
    daylightOpen,
    solid,
    trees,
    rocks,
    falls: fallMeta,
    cells,
    lightW,
    lightC,
    daylight,
    colTop,
    colBottom,
    site,
    mine: {
      route: route.map(toWorld),
      stops: {
        portal: stops.portal,
        gallery: stops.gallery,
        bridge: stops.bridge,
        junction: stops.junction,
        forge: stops.forge,
        climb: stops.climb,
        exit: stops.exit,
        depot: stops.depot,
      },
      spur: spur.map(toWorld),
      gallery: { x0: galleryX0 - HALF, x1: galleryX1 - HALF, back: galleryBack - HALF, floorY: GALLERY_Y },
      chasm: { x0: chasmX0 - HALF, x1: chasmX1 - HALF, back: chasmBack - HALF, floorY: CHASM_FLOOR, bridgeY: BRIDGE_Y },
      geode: { x: geodeX - HALF, y: geodeY, z: geodeZ - HALF, r: GR },
      forge: { x0: forgeX0 - HALF, x1: forgeX1 - HALF, back: S - 6 - HALF, floorY: FORGE_Y },
      lower: { x0: lowerX0 - HALF, x1: lowerX1 - HALF, back: lowerBack - HALF, floorY: LOWER_Y },
      skylight: {
        x: skyX - HALF,
        z: skyZ - HALF,
        topY: skylight.length ? Math.max(...skylight.filter((_, i) => i % 3 === 1)) : BRIDGE_Y + 5,
        bottomY: BRIDGE_Y + 5,
      },
      sectionZ: S - HALF,
      cutZ: CUT_Z,
      rimY: LEDGE_Y + 0.5,
      ore,
      target,
      lamps,
      fires: fires.map(toWorld),
      beacon: {
        x: beaconAt.x - HALF,
        y: top[beaconAt.z * N + beaconAt.x] + 0.5,
        z: beaconAt.z - HALF,
      },
    },
  };
}
