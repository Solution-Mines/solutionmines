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

/** Land footprint, in cubes. */
export const VOXEL_SIZE = 48;
/** Vertical room: keel at the bottom, canopies at the top. */
export const WORLD_HEIGHT = 64;
/** Cliff height. Heights snap to this, which is what makes terraces. */
const TERRACE = 3;
/* The waterline the island is built around: terrain rises above it, the keel
   hangs below it. */
const DATUM = 16;

/* Where the sea sits, in the same units as everything else. Below the keel's
   tip at y=0, because the island is meant to FLOAT: drowning the keel at the
   waterline would hide the taper the whole silhouette rests on.

   How far below is a framing decision, not a physical one. At -42 the falls
   were longer than the island is tall, so no camera could hold the plateaus
   and the point where the water lands at the same time. Eighteen leaves a
   clear gap under the keel and still fits the whole fall in frame. */
export const SEA_Y = -18;

export const MATERIAL = {
  grass: 0,
  dirt: 1,
  stone: 2,
  rock: 3,
  wood: 4,
  leaf: 5,
  /* Still water lying in the plateau surface, feeding a fall. */
  water: 6,
  /* The falling column. A separate id only so the shader can scroll one and
     ripple the other without guessing from the face normal. */
  fall: 7,
  /* The bottom of the section. Colder and darker than rock, so the descent
     has a fourth band to pass through rather than thirty blocks of one
     colour once the stone runs out. */
  deep: 8,
  oreCopper: 9,
  oreGold: 10,
  oreCrystal: 11,
} as const;

/* --- the mine ---------------------------------------------------------------
   An open pit sunk into the middle of the plateau, a shaft bored from its
   floor, and a chamber cut into the keel at the bottom.

   All three are CARVED, not added. The pit is a change to the height field,
   so the strata, the culling and the sky-access pass all handle it without
   knowing it is there. The shaft and chamber are cells set back to empty
   after the fill -- which means their walls become ordinary surface and get
   faces emitted for free. That is the whole reason the journey can go
   underground at all: the island's interior is hollow (only the shell is
   emitted), so the only way to see rock from inside is to make a hole whose
   walls ARE the shell.

   Where the pit sits is not a choice. It has to be the middle of the island,
   because the keel tapers and the middle is the only place with enough rock
   under it to hold a chamber. */
const PIT_R = 15;
const PIT_DEPTH = 12;
/** Horizontal run per bench.

    Benches are three cubes tall, so this is also the slope: at 2.0 the wall
    fell twelve over eight and the pit read as a cylinder with a black hole in
    it rather than as cut steps. 2.4 is still steeper than a real pit and
    still reads as one, which is the trade this is making. */
const BENCH = 2.2;
/** Half-width of the bore. 2 gives a 5x5 shaft, which a camera fits down. */
const SHAFT_R = 2;
/** Above this, anything that is not turf or dirt is stone. The flat top of
    the rock, in other words -- see the strata rule in the fill. Exported so
    the depth readout names the band the camera is actually inside rather
    than a second guess at where the bands are. */
export const STONE_Y = 30;
/** And below this, rock turns to the cold deep band the chamber is cut in. */
export const DEEP_Y = 13;

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
  tint: number;
  /** Which way it faces the room: the axis a pick would come in along. */
  face: [number, number, number];
  /** The material it reads as before it is broken, so the separate draw uses
      the wall's own colour rather than a guess at it. */
  material: number;
};

/** Where the dig is, in the same world units as everything else. */
export type MineInfo = {
  /** Centre of the pit and the shaft, already centred on the origin. */
  x: number;
  z: number;
  /** Original ground level at the pit, i.e. depth zero. */
  rimY: number;
  /** The pit floor, where the shaft starts. */
  floorY: number;
  /** Where the shaft meets the chamber roof. */
  shaftBottomY: number;
  /** Middle of the chamber, and its floor. */
  chamberY: number;
  chamberFloorY: number;
  /** Chamber half-width, for framing the last shot. */
  chamberR: number;
  /** Ore blocks placed, by kind. */
  ore: number;
  /** The mineable block, or null if the chamber offered no suitable cell. */
  target: MineTarget | null;

  /* --- the haulage drift ---------------------------------------------------
     The centre line, one point per block of run, carrying the floor height
     that the keel actually allowed at that point. The camera follows it and
     so do the rails, which is the only way the two can agree: a drift whose
     floor is computed twice is a cart running through the ground. */
  drift: Array<{ x: number; y: number; z: number }>;
  /** Which way it runs, in the ground plane. Axis-aligned. */
  driftDir: [number, number];
  /** The room at the end of it. */
  cavern: { x: number; z: number; floorY: number; roofY: number; r: number };
  /** The formation standing in that room: base centre and height. */
  crystal: { x: number; y: number; z: number; h: number };
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
  faceCount: number;
  /** Solid cells before hidden ones were discarded. */
  solid: number;
  trees: number;
  rocks: number;
  /** Where each fall meets the sea, so the water shader can foam there. */
  falls: Array<{ x: number; z: number }>;
  /** Where the pit, shaft and chamber ended up, for the camera to aim at. */
  mine: MineInfo;
  /** Occupancy: EMPTY (255) or a material id, at [(y * N + z) * N + x].

      Returned rather than discarded so a camera path can be CHECKED against
      the terrain instead of guessed at. Framing a shot by eye and finding out
      from a screenshot that the lens is inside a bench is slow and, worse,
      only finds the shots that were sampled -- a spline between two clear
      keys can still pass through rock halfway. It is the array the build
      already used, so keeping it costs 144 KB and no work. */
  cells: Uint8Array;
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

/* Four octaves. The grid is large enough now that a coarse pass alone leaves
   visibly smooth ground between features. */
function fbm(x: number, z: number, seed: number) {
  return (
    valueNoise(x / 26, z / 26, seed) * 0.52 +
    valueNoise(x / 12, z / 12, seed ^ 0x9e37) * 0.26 +
    valueNoise(x / 5.5, z / 5.5, seed ^ 0x51ed) * 0.14 +
    valueNoise(x / 2.4, z / 2.4, seed ^ 0x2b7f) * 0.08
  );
}

export function buildTerrain(
  seed = 0x7a19,
  { falls = true }: { falls?: boolean } = {},
): VoxelTerrain {
  const N = VOXEL_SIZE;
  const H = WORLD_HEIGHT;
  const HALF = (N - 1) / 2;

  const top = new Int32Array(N * N);
  const bot = new Int32Array(N * N).fill(-1);

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const nx = (x - HALF) / HALF;
      const nz = (z - HALF) / HALF;

      /* A rounded square, not a circle. Blending euclidean distance with the
         chebyshev one keeps broad flat flanks and corners, which is what
         makes the island read as a piece of land rather than a scoop of ice
         cream. The edge is then roughened so the rim is not a clean arc. */
      const euclid = Math.sqrt(nx * nx + nz * nz);
      const square = Math.max(Math.abs(nx), Math.abs(nz));
      const edgeNoise = (valueNoise(x / 7, z / 7, seed ^ 0x77aa) - 0.5) * 0.17;
      const d = euclid * 0.45 + square * 0.55 + edgeNoise;

      // Flat across the interior, falling away only over the outer fifth.
      const t = Math.max(0, Math.min(1, (0.97 - d) / 0.22));
      const falloff = t * t * (3 - 2 * t);
      if (falloff <= 0.04) continue;

      /* The power curve pushes mid heights down and leaves the peaks, so the
         island gets distinct high ground instead of one broad shelf at the
         average. Flat relief was what made the terracing invisible. */
      const raw = (1 + Math.pow(fbm(x, z, seed), 1.3) * 36) * falloff;
      /* Quantised to whole cliffs. This single line is the difference
         between plateaus and a dome. */
      const surface = Math.round(raw / TERRACE) * TERRACE;

      /* Both surfaces are measured from ONE datum, which is the whole trick.
         Deriving the underside from the top instead -- top minus a
         thickness -- makes the bottom follow the terrain upward wherever the
         island is tall, so the hull comes out a bowl and the island reads as
         a drum. Here the top rises from the datum and the keel descends from
         it independently, which is what produces a taper. */
      const surfaceY = Math.min(H - 12, DATUM + surface);
      /* The keel uses the RAW distance, not the plateau falloff. That falloff
         is deliberately ~1 across the whole interior -- which is what gives
         the top its flat shelves -- so driving the underside from it made the
         bottom a flat slab at y=0 with a 2-cube lip at the rim. Distance
         gives a genuine cone. */
      const dn = Math.min(1, Math.max(0, d / 0.97));
      const keelDepth = Math.round(Math.pow(1 - dn, 1.15) * DATUM);

      top[z * N + x] = surfaceY;
      bot[z * N + x] = Math.max(0, DATUM - keelDepth);
    }
  }

  /* --- the pit -------------------------------------------------------------
     Cut into the HEIGHT FIELD, before anything is filled. A pit dug after the
     fact would have to delete cells and then repair the faces around the hole;
     lowering the surface first means the existing fill, culling and
     sky-access passes produce a terraced pit without being told one exists.

     The strata are the reason the original surface is kept. Material is
     assigned by depth below the ground, and if that depth were measured from
     the carved height the pit floor would come out as turf -- a grass lawn at
     the bottom of a mine. Measured from `surf` instead, the floor lands in
     stone and the benches show the band they actually cut through, which is
     the cross-section the whole descent is for. */
  const MINE_X = Math.round(HALF);
  const MINE_Z = Math.round(HALF);
  const surf = Int32Array.from(top);
  const rimY = top[MINE_Z * N + MINE_X];
  const floorY = rimY - PIT_DEPTH;

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (bot[z * N + x] < 0) continue;
      const r = Math.hypot(x - MINE_X, z - MINE_Z);
      if (r > PIT_R) continue;
      /* One bench per step inward. The floor is whatever is left inside the
         innermost step, which is what the shaft needs to open into. */
      const steps = Math.floor((PIT_R - r) / BENCH);
      const want = Math.max(floorY, rimY - steps * TERRACE);
      if (want < top[z * N + x]) top[z * N + x] = want;
    }
  }

  /* --- occupancy ----------------------------------------------------------
     Ground and props share one grid, so props occlude the ground beneath them
     and the culling pass sees the whole scene rather than half of it. */
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
        // Depth below the ORIGINAL ground, not the dug one -- see the pit.
        const below = surf[z * N + x] - y;
        /* Strata. Thin turf, a little dirt, then a long way down through two
           stones into deep rock -- the proportions of a cliff, not a lawn. */
        /* One course of dirt, not three. Terraces are three cubes tall, so
           three courses of dirt meant every single step exposed grass + dirt
           + dirt and stone never appeared on the shelves at all -- the whole
           island came out brown. */
        /* Two rules for stone, and both are needed.

           Depth below the surface is what gives a cliff its band, and that
           is the rule the island's exterior was composed with -- six courses
           of stone under the turf, whatever height the cliff is at. Keep it
           and nothing outside changes.

           But depth-from-surface alone puts the SAME band at a different
           altitude under every hill, and the moment you cut a flat floor
           across several of them the bands do not line up: one bench comes
           out stone and the next, cut to exactly the same level, comes out
           rock, because the ground above them was not the same height. A pit
           cut that way has no readable section in it at all -- which is what
           the first one looked like.

           So stone is also anything above a flat datum. Cuts into high
           ground stay in the stone band until they pass that line, the
           island's own cliffs keep the band they had, and a horizontal cut
           anywhere shows one material. */
        cells[at(x, y, z)] =
          below === 0
            ? MATERIAL.grass
            : below === 1
              ? MATERIAL.dirt
              : below <= 7 || y >= STONE_Y
                ? MATERIAL.stone
                : y <= DEEP_Y
                  ? MATERIAL.deep
                  : MATERIAL.rock;
        solid++;
      }
    }
  }

  /* --- props --------------------------------------------------------------- */
  const placed: Array<[number, number]> = [];
  const farEnough = (x: number, z: number, min: number) =>
    placed.every(([px, pz]) => Math.hypot(px - x, pz - z) >= min);

  let trees = 0;
  let rocks = 0;

  const put = (x: number, y: number, z: number, m: number) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] !== EMPTY) return;
    cells[at(x, y, z)] = m;
    solid++;
  };

  const tree = (x: number, z: number, ty: number, big: boolean) => {
    /* Short trunk, broad crown. A tall trunk under a narrow canopy reads as
       a lollipop on a stick, which is exactly what the first pass produced. */
    const trunk = big ? 7 : 5;
    for (let i = 0; i < trunk; i++) put(x, ty + i, z, MATERIAL.wood);
    const cy = ty + trunk;
    const r = big ? 3 : 2;
    // Three tapering courses: a broad skirt, a narrower body, then a cap.
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
        put(x + dx, cy - 2, z + dz, MATERIAL.leaf);
        put(x + dx, cy - 1, z + dz, MATERIAL.leaf);
      }
    }
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(x + dx, cy, z + dz, MATERIAL.leaf);
      }
    }
    put(x, cy + 1, z, MATERIAL.leaf);
  };

  for (let z = 3; z < N - 3; z++) {
    for (let x = 3; x < N - 3; x++) {
      const t = top[z * N + x];
      if (bot[z * N + x] < 0) continue;
      if (cells[at(x, t, z)] !== MATERIAL.grass) continue;
      /* Nothing grows inside the dig.

         Not a camera workaround, though it started as one: a bench cut to a
         height the ground was already at keeps its turf, the prop pass sees
         grass and plants on it, and the pit comes out with trees standing on
         its benches. The first one of those grew directly over the shaft and
         the descent flew through its canopy. */
      if (Math.hypot(x - MINE_X, z - MINE_Z) <= PIT_R + 1) continue;

      const r = hash2(x, z, seed ^ 0x2f1b);

      if (trees < 18 && r > 0.972 && farEnough(x, z, 5)) {
        tree(x, z, t + 1, r > 0.984);
        placed.push([x, z]);
        trees++;
      } else if (rocks < 34 && r > 0.93 && r < 0.95) {
        put(x, t + 1, z, MATERIAL.rock);
        if (r > 0.944) put(x + 1, t + 1, z, MATERIAL.rock);
        if (r > 0.948) put(x, t + 1, z + 1, MATERIAL.rock);
        rocks++;
      } else if (r > 0.9 && r < 0.915) {
        /* Shrubs: a single leaf block. Cheap, and detail density is most of
           what tells the eye how large the island is. */
        put(x, t + 1, z, MATERIAL.leaf);
      }
    }
  }

  /* --- waterfalls ----------------------------------------------------------
     Picked, not placed by hand: the highest rim columns that have clear air
     outboard of them, spread apart so three falls do not end up on the same
     face of the island. */
  type Fall = { x: number; z: number; dx: number; dz: number; lip: number };
  const voidAt = (x: number, z: number) =>
    x < 0 || z < 0 || x >= N || z >= N || bot[z * N + x] < 0;

  const planFalls = (want: number): Fall[] => {
    const cand: Fall[] = [];
    const DIRS: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (bot[z * N + x] < 0) continue;
        const lip = top[z * N + x];
        /* The rim is the LOW part of the island -- the falloff that gives the
           plateau its flat interior also pulls the edge down to the datum, so
           the tallest column adjacent to open air is around 22 while the
           island itself reaches 43. Screening for high ground here finds
           nothing at all; the useful filter is just "above the datum", and
           the sort below takes the best of what the rim actually offers. */
        if (lip < DATUM + 2) continue;
        for (const [dx, dz] of DIRS) {
          /* The whole 2x2 column has to hang in clear air, not clip the cliff
             on the way down. Checking only the first cell gives falls that
             vanish into the rock a few blocks below the lip. */
          const px = dz;
          const pz = -dx;
          let clear = true;
          for (let k = 1; k <= 2 && clear; k++) {
            for (let j = 0; j <= 1 && clear; j++) {
              if (!voidAt(x + dx * k + px * j, z + dz * k + pz * j)) clear = false;
            }
          }
          if (!clear) continue;
          cand.push({ x, z, dx, dz, lip });
          break;
        }
        /* No `break` on a blocked direction: a cell with void to the north
           and rock to the east is still a perfectly good source, and
           stopping at the first void neighbour threw those away. */
      }
    }
    cand.sort((a, b) => b.lip - a.lip);
    /* Spread by ANGLE around the island, not by distance between the cells.
       Plain distance let two of the three sit on the same face of the island
       a comfortable 23 cells apart, which left half the orbit with nothing
       falling in it. A third of the compass each is what the camera needs. */
    const out: Fall[] = [];
    const bearing = (f: Fall) => Math.atan2(f.z - HALF, f.x - HALF);
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % (Math.PI * 2);
      return Math.min(d, Math.PI * 2 - d);
    };
    for (const c of cand) {
      if (out.length >= want) break;
      const bc = bearing(c);
      if (out.every((o) => apart(bearing(o), bc) >= 1.75)) out.push(c);
    }
    return out;
  };

  const fallPlan = falls ? planFalls(3) : [];

  /* The spill: water laid INTO the plateau surface rather than on top of it.
     Sitting it on top would put its underside in the same plane as the grass
     it rests on, and two coplanar faces z-fight. Replacing the surface cell
     also means the existing culling and face emission handle it for free.

     It walks inland from the lip rather than carving a fixed square, so the
     water arrives from somewhere. A step is allowed to climb one terrace --
     water does not run uphill, but a stream cutting down through a terrace
     looks exactly like this from above, and a strictly-downhill rule stops
     at the first step and leaves a puddle. */
  for (const f of fallPlan) {
    const px = f.dz;
    const pz = -f.dx;
    let cx = f.x;
    let cz = f.z;
    let prev = f.lip;
    for (let step = 0; step < 7; step++) {
      for (let j = 0; j <= 1; j++) {
        const sx = cx + px * j;
        const sz = cz + pz * j;
        if (voidAt(sx, sz)) continue;
        cells[at(sx, top[sz * N + sx], sz)] = MATERIAL.water;
      }
      const nx = cx - f.dx;
      const nz = cz - f.dz;
      if (voidAt(nx, nz)) break;
      const nt = top[nz * N + nx];
      if (nt > prev + TERRACE) break;
      prev = nt;
      cx = nx;
      cz = nz;
    }
  }

  /* --- the shaft and the chamber -------------------------------------------
     Set back to empty after the fill, which is the cheap half of the trick:
     a cell that loses a neighbour starts emitting the face that was hidden,
     so the walls of a hole are ordinary surface and cost nothing extra to
     find. Carving a void is how you get geometry to stand inside; the
     alternative -- emitting the island's interior so it can be sliced open --
     is a volume instead of a shell, and this island is 99,000 cells against
     the 13,000 faces it currently draws. */
  /* Every cell the dig emptied. The light flood below needs to tell a void it
     made from the open air outside the island: both are empty, but one is a
     room and the other is the sky. */
  const carved = new Set<number>();
  const carve = (x: number, y: number, z: number, roofClear = 0) => {
    if (!inside(x, y, z)) return;
    if (cells[at(x, y, z)] === EMPTY) return;
    /* Keep this much rock between the cut and the open air above it.

       Zero for the shaft and the pit-floor chamber, which legitimately open
       at the surface -- the shaft's mouth IS the pit floor, and a blanket
       guard would refuse to cut it. Three for anything driven sideways
       under natural ground, where surfacing is not an entrance but a hole in
       the hillside with daylight pouring through it. */
    if (roofClear > 0 && y > top[z * N + x] - roofClear) return;
    /* Never cut within two blocks of the keel's outer surface. The chamber is
       as wide as the keel is thick at that height, and a shape that reaches
       its own radius breaches the hull -- which from outside is a hole in the
       underside of a floating island, and from inside is daylight in a room
       the whole point of which is that it has none. */
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

  /* The chamber first, because the shaft has to know where to stop. Its floor
     is driven by the keel rather than chosen: take the highest underside
     within its radius and sit two blocks above it. */
  const CHAMBER_R = 7;
  const CHAMBER_H = 8;
  let chamberFloorY = 0;
  for (let dz = -CHAMBER_R; dz <= CHAMBER_R; dz++) {
    for (let dx = -CHAMBER_R; dx <= CHAMBER_R; dx++) {
      if (dx * dx + dz * dz > CHAMBER_R * CHAMBER_R) continue;
      const b = bot[(MINE_Z + dz) * N + (MINE_X + dx)];
      if (b > chamberFloorY) chamberFloorY = b;
    }
  }
  chamberFloorY += 2;
  const chamberTopY = chamberFloorY + CHAMBER_H;

  for (let y = chamberFloorY; y <= chamberTopY; y++) {
    const h = (y - chamberFloorY) / CHAMBER_H;
    // Widest at the floor, domed over. A cylinder reads as a lift shaft.
    const r = CHAMBER_R * Math.sqrt(Math.max(0.04, 1 - h * h * 0.92));
    for (let dz = -CHAMBER_R; dz <= CHAMBER_R; dz++) {
      for (let dx = -CHAMBER_R; dx <= CHAMBER_R; dx++) {
        if (Math.hypot(dx, dz) > r) continue;
        carve(MINE_X + dx, y, MINE_Z + dz);
      }
    }
  }

  /* The bore. Five across with its four corners left standing as posts, so
     the descent has something close to the camera to measure itself against
     -- a smooth tube gives the eye nothing to read speed from and the fall
     looks like a still image of a wall. */
  const shaftBottomY = chamberTopY - 1;
  for (let y = floorY; y > shaftBottomY; y--) {
    for (let dz = -SHAFT_R; dz <= SHAFT_R; dz++) {
      for (let dx = -SHAFT_R; dx <= SHAFT_R; dx++) {
        const post =
          Math.abs(dx) === SHAFT_R && Math.abs(dz) === SHAFT_R;
        if (post) timber(MINE_X + dx, y, MINE_Z + dz);
        else carve(MINE_X + dx, y, MINE_Z + dz);
      }
    }
    // A set every six blocks, cut into the wall rather than into the bore:
    // framing that narrowed the opening would put beams through the camera.
    if ((floorY - y) % 6 === 3) {
      for (let d = -SHAFT_R - 1; d <= SHAFT_R + 1; d++) {
        timber(MINE_X + d, y, MINE_Z - SHAFT_R - 1);
        timber(MINE_X + d, y, MINE_Z + SHAFT_R + 1);
        timber(MINE_X - SHAFT_R - 1, y, MINE_Z + d);
        timber(MINE_X + SHAFT_R + 1, y, MINE_Z + d);
      }
    }
  }


  /* --- the haulage drift and the discovery cavern ---------------------------

     The chamber is the bottom of the dig and there is nothing underneath it.
     The keel is a cone, the chamber already sits on the two blocks of rock
     that cone leaves at the centre, and the carve guard refuses to go lower.
     So the journey cannot continue DOWN, and everything past the working
     face has to go sideways -- which is what a real mine does as well. A
     drift is driven off the chamber, and because the keel rises as it runs
     outward the drift has to climb with it.

     Every height below is read off the terrain. For most of its length this
     cut passes within three or four blocks of breaching the hull, and a
     number written into this file would be wrong the first time the island
     is reseeded or the taper retuned. */
  const DRIFT_HW = 2; // half width: a five-wide way, matching the shaft
  const DRIFT_H = 4; // floor to roof
  const DRIFT_FROM = 4; // run at which it leaves the chamber
  /** How far out the heading scan looks. The room search below never sites a
      cavern further than this, so a flank is judged on exactly the rock the
      drift and the room will actually be cut through. */
  const SCAN_REACH = 25;

  /** How much rock a column has in it: underside to open air. Negative where
      there is no island at all. */
  const thickness = (x: number, z: number) => {
    if (x < 1 || z < 1 || x >= N - 1 || z >= N - 1) return -1;
    if (bot[z * N + x] < 0) return -1;
    return top[z * N + x] - bot[z * N + x];
  };

  /* Which way to drive it. Measured rather than chosen: the island is a
     rounded square with noise on its rim, so one flank always carries
     materially more rock than the other three, and that is the only flank a
     room this size fits inside. Cardinal headings only -- the drift is five
     wide with square timber sets and a rail road down it, and a diagonal of
     those is a staircase. */
  const HEADINGS: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  let driftDir: [number, number] = [-1, 0];
  let bestWorst = -Infinity;
  for (const [hx, hz] of HEADINGS) {
    let worst = Infinity;
    for (let run = DRIFT_FROM; run <= SCAN_REACH; run++) {
      for (let o = -6; o <= 6; o++) {
        const t = thickness(
          MINE_X + hx * run - hz * o,
          MINE_Z + hz * run + hx * o,
        );
        if (t < worst) worst = t;
      }
    }
    if (worst > bestWorst) {
      bestWorst = worst;
      driftDir = [hx, hz];
    }
  }
  const [DX, DZ] = driftDir;
  // Perpendicular, in the ground plane: the drift's own cross-section axis.
  const PX = -DZ;
  const PZ = DX;

  /* The room at the end, sized and SITED by the rock rather than by a wish.

     The first version of this fixed the run at seventeen blocks and then
     shrank the radius until a room fitted. It fitted at four, which is not a
     room -- the formation standing in it sealed the drift, and the chamber
     stopped connecting to the cavern at all. The error was holding the one
     variable that costs nothing to move: how far out it is. Further out is
     thinner rock, so searching the distance as well as the radius finds a
     genuinely larger room a few blocks nearer in. */
  const roomAt = (run: number, r: number) => {
    const x0 = MINE_X + DX * run;
    const z0 = MINE_Z + DZ * run;
    let lo = 0;
    let hi = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx, dz) > r) continue;
        const x = x0 + dx;
        const z = z0 + dz;
        // Any column without island under it would open the room to the sky.
        if (thickness(x, z) < 0) return null;
        lo = Math.max(lo, bot[z * N + x] + 2);
        hi = Math.min(hi, top[z * N + x] - 3);
      }
    }
    // Capped as well as floored: a room taller than it is wide is a chimney.
    const roof = Math.min(hi, lo + 13);
    return roof - lo >= 9 ? { floor: lo, roof, r, run } : null;
  };

  let room: { floor: number; roof: number; r: number; run: number } | null = null;
  for (let run = 19; run >= 10; run--) {
    for (let r = 8; r >= 5; r--) {
      const cand = roomAt(run, r);
      if (!cand) continue;
      /* Width first, then height, then distance. A wide room reads as a
         cavern; a tall narrow one reads as the bottom of a well, and the
         whole job of this space is to be the one place in the journey that
         opens OUT. */
      const score = cand.r * 3 + (cand.roof - cand.floor) + cand.run * 0.25;
      const best = room ? room.r * 3 + (room.roof - room.floor) + room.run * 0.25 : -1;
      if (score > best) room = cand;
    }
  }
  /* Nothing fitted: the island was reseeded into something with no flank
     thick enough. Fall back to a modest room rather than carving a breach,
     and let the shot list frame a smaller space. */
  const CAVERN_AT = room ? room.run : 12;
  const cavR = room ? room.r : 4;
  const cavFloor = room ? room.floor : chamberFloorY + 6;
  const cavRoof = room ? room.roof : chamberFloorY + 15;
  const CAV_X = MINE_X + DX * CAVERN_AT;
  const CAV_Z = MINE_Z + DZ * CAVERN_AT;

  /* The floor profile. Linear from the chamber mouth to the room, then
     raised wherever the keel says it has to be -- so the gradient is as
     gentle as the island allows and never gentler. */
  const driftStartY = Math.min(chamberTopY - 3, chamberFloorY + 4);
  const driftLine: Array<{ x: number; y: number; z: number }> = [];

  for (let run = DRIFT_FROM; run <= CAVERN_AT; run++) {
    const cx = MINE_X + DX * run;
    const cz = MINE_Z + DZ * run;
    const t = (run - DRIFT_FROM) / (CAVERN_AT - DRIFT_FROM);
    let floor = Math.round(driftStartY + (cavFloor - driftStartY) * t);
    for (let o = -DRIFT_HW - 1; o <= DRIFT_HW + 1; o++) {
      const x = cx + PX * o;
      const z = cz + PZ * o;
      if (!inside(x, 0, z) || bot[z * N + x] < 0) continue;
      floor = Math.max(floor, bot[z * N + x] + 2);
    }
    for (let o = -DRIFT_HW; o <= DRIFT_HW; o++) {
      /* Lay the floor before opening the air above it.

         The first few runs are still inside the chamber, whose air was
         carved from its own floor eight blocks lower -- so the drift's floor
         cell there is not rock, it is a hole, and a cart would run off the
         end of the rails into the room below. put() only fills air, so
         everywhere else in the drift this does nothing at all. */
      put(cx + PX * o, floor, cz + PZ * o, MATERIAL.rock);
      for (let y = floor + 1; y <= floor + DRIFT_H; y++) {
        carve(cx + PX * o, y, cz + PZ * o, 3);
      }
    }
    /* A set every four blocks: two legs and a cap, cut INTO the wall rather
       than standing in the way. Framing that narrowed a five-wide drift
       would put a beam through the lens, and the camera comes down the
       middle of this. */
    if ((run - DRIFT_FROM) % 4 === 2) {
      for (let y = floor + 1; y <= floor + DRIFT_H; y++) {
        timber(cx + PX * (DRIFT_HW + 1), y, cz + PZ * (DRIFT_HW + 1));
        timber(cx - PX * (DRIFT_HW + 1), y, cz - PZ * (DRIFT_HW + 1));
      }
      for (let o = -DRIFT_HW - 1; o <= DRIFT_HW + 1; o++) {
        timber(cx + PX * o, floor + DRIFT_H + 1, cz + PZ * o);
      }
    }
    driftLine.push({ x: cx - HALF, y: floor, z: cz - HALF });
  }

  /* --- the incline ---------------------------------------------------------
     The drift leaves four blocks above the chamber floor, because that is
     where the keel let it leave. Between the two there was nothing: open air
     from the working face up to the mouth of the way out, which reads as an
     unfinished edit rather than as a mine.

     A ramp of rock, laid rather than cut -- the chamber air is already there
     and this fills part of it back in. It is steep, about one in two, which
     is a self-acting incline rather than a level haulage; that is an honest
     thing for a mine to have and it is what the rock here allows. */
  const RAMP_FROM = -2;
  /* Walked from the mouth back toward the chamber, so the points can be
     unshifted one at a time and still come out in order. Running the loop
     forwards reversed the ramp inside the centre line, which put the cart on
     rails that doubled back on themselves. */
  for (let run = DRIFT_FROM - 1; run >= RAMP_FROM; run--) {
    const cx = MINE_X + DX * run;
    const cz = MINE_Z + DZ * run;
    const t = (run - RAMP_FROM) / (DRIFT_FROM - RAMP_FROM);
    const floor = Math.round(
      chamberFloorY + (driftStartY - chamberFloorY) * t,
    );
    for (let o = -DRIFT_HW; o <= DRIFT_HW; o++) {
      const x = cx + PX * o;
      const z = cz + PZ * o;
      for (let y = chamberFloorY; y <= floor; y++) put(x, y, z, MATERIAL.rock);
      for (let y = floor + 1; y <= floor + DRIFT_H; y++) carve(x, y, z, 3);
    }
    driftLine.unshift({ x: cx - HALF, y: floor, z: cz - HALF });
  }

  // The room itself: widest at the floor, domed over, same as the chamber.
  for (let y = cavFloor + 1; y <= cavRoof; y++) {
    const h = (y - cavFloor) / Math.max(1, cavRoof - cavFloor);
    const r = cavR * Math.sqrt(Math.max(0.05, 1 - h * h * 0.88));
    for (let dz = -cavR; dz <= cavR; dz++) {
      for (let dx = -cavR; dx <= cavR; dx++) {
        if (Math.hypot(dx, dz) > r) continue;
        carve(CAV_X + dx, y, CAV_Z + dz, 3);
      }
    }
  }

  /* --- the formation -------------------------------------------------------
     Stepped spires of crystal standing on the floor of the room.

     Terrain cells, not a separate mesh. They are landscape-scale -- the tall
     one is nine blocks, taller than four of the figures stacked -- so they
     belong on the terrain grid where the culling, the strata jitter and the
     ore shading already handle them. Put behind the centre of the room, so
     the camera arrives with floor in front of it rather than nose against
     the thing it came to see. */
  /* Set back from the middle of the room, on the far side from the way in.

     Not an aesthetic choice. Centred, the cluster's outer spires reached the
     mouth of the drift and sealed it -- the chamber stopped connecting to the
     cavern at all, and the fault was invisible from every still because the
     plug is exactly where the camera is looking FROM. Four blocks back, with
     the ring kept inside three, leaves the whole approach clear. */
  const CRY_BACK = Math.max(1, cavR - 4);
  const CRY_RING = Math.max(1, cavR - 5);
  const CRY_X = CAV_X + DX * CRY_BACK;
  const CRY_Z = CAV_Z + DZ * CRY_BACK;
  /* Two blocks of air left over its point. A spire that touches the roof
     stops reading as a thing standing in a room and becomes a column
     holding it up. */
  const CRY_H = Math.max(4, Math.min(10, cavRoof - cavFloor - 2));
  const spire = (sx: number, sz: number, h: number, r: number) => {
    for (let i = 0; i < h; i++) {
      // Tapered to a point, and never wider than it started.
      const rr = r * (1 - i / h);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.hypot(dx, dz) > rr + 0.3) continue;
          const x = sx + dx;
          const z = sz + dz;
          /* Never into the way in.

             The cluster is set back from the middle of the room, but a
             spire on the near side of the ring still reaches the mouth of
             the drift -- and a crystal block standing in the rail bed is a
             cart running through a boulder. Measured along the drift's own
             axis, so it holds whichever flank the drift was driven into. */
          const along = (x - CAV_X) * DX + (z - CAV_Z) * DZ;
          const across = Math.abs((x - CAV_X) * PX + (z - CAV_Z) * PZ);
          if (along < 2 && across <= DRIFT_HW + 1) continue;
          put(x, cavFloor + 1 + i, z, MATERIAL.oreCrystal);
        }
      }
    }
  };
  spire(CRY_X, CRY_Z, CRY_H, 2);
  /* A ring of smaller ones round it. Uneven heights on purpose: six spires
     of one height is a fence, and the reading the brief asks for -- a find,
     not an installation -- comes from the cluster being irregular. */
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.45;
    /* Kept inside the room with two blocks to spare. The cluster filling
       the floor is what sealed the drift the first time this ran. */
    const rad = Math.min(CRY_RING, 2 + (k % 3));
    spire(
      Math.round(CRY_X + Math.cos(a) * rad),
      Math.round(CRY_Z + Math.sin(a) * rad),
      Math.min(CRY_H - 2, 2 + ((k * 3) % 5)),
      k % 3 === 0 ? 2 : 1,
    );
  }

  /* Ore, in seams rather than scattered. A hash per block gives salt and
     pepper, which reads as damage; a noise field sheared by height gives
     bands running diagonally through the rock, which is what ore does. Only
     on faces that something can actually see -- a seam buried in the wall is
     a block nobody will ever draw. */
  let ore = 0;
  const exposed = (x: number, y: number, z: number) =>
    !solidAt(x + 1, y, z) ||
    !solidAt(x - 1, y, z) ||
    !solidAt(x, y + 1, z) ||
    !solidAt(x, y - 1, z) ||
    !solidAt(x, y, z + 1) ||
    !solidAt(x, y, z - 1);

  /* Two passes with separate budgets, not one with a shared cap.

     Sharing a budget looks reasonable and is not: the chamber's walls expose
     an order of magnitude more rock than a five-wide shaft does, so a single
     counter running from the bottom up spent itself on the chamber and left
     the entire shaft with one block of copper in it. The shaft is the long
     part of the journey and it needs something to pass. */
  const seam = (
    yLo: number,
    yHi: number,
    reach: number,
    cut: number,
    cap: number,
    kind: (pick: number) => number,
    /* Where to look. Defaulted to the shaft because that is where the first
       two seams are; the drift and the cavern are somewhere else entirely,
       and a window centred on the shaft never reaches them. */
    atX = MINE_X,
    atZ = MINE_Z,
  ) => {
    let n = 0;
    const lo = Math.max(0, atX - reach);
    const hi = Math.min(N - 1, atX + reach);
    const loZ = Math.max(0, atZ - reach);
    const hiZ = Math.min(N - 1, atZ + reach);
    for (let y = yLo; y <= yHi && n < cap; y++) {
      for (let z = loZ; z <= hiZ && n < cap; z++) {
        for (let x = lo; x <= hi && n < cap; x++) {
          const m = cells[at(x, y, z)];
          if (m !== MATERIAL.rock && m !== MATERIAL.deep && m !== MATERIAL.stone)
            continue;
          // A seam buried in the wall is a block nobody will ever draw.
          if (!exposed(x, y, z)) continue;
          const vein = valueNoise(
            x / 4.5 + y * 0.41,
            z / 4.5 - y * 0.23,
            seed ^ 0x51a7,
          );
          if (vein < cut) continue;
          cells[at(x, y, z)] = kind(hash3(x, y, z, seed ^ 0x0d1e));
          n++;
        }
      }
    }
    ore += n;
  };

  // Copper in the shaft walls: the first sign that this is a working mine.
  /* A much lower cut than the chamber gets. The shaft offers one ring of
     wall per level and the frames take two levels in six of it, so the same
     threshold that seeds a chamber wall handsomely leaves the shaft bare. */
  seam(chamberTopY + 2, floorY - 4, SHAFT_R + 2, 0.56, 26, () => MATERIAL.oreCopper);
  // Gold and crystal at the bottom, which is what the descent arrives at.
  /* Thinner than the first pass, and the reason is framing rather than
     realism. The chamber is about fourteen blocks across and the act that
     happens in it is shot from inside: at a threshold of 0.74 and a cap of
     48 the near wall came out as a chequerboard of saturated gold and teal
     filling a quarter of the frame, which reads as a texture rather than as
     a seam in rock. Ore has to be the thing you notice, and it stops being
     that the moment there is a lot of it. */
  seam(chamberFloorY - 1, chamberTopY + 1, CHAMBER_R + 2, 0.82, 26, (pick) =>
    pick > 0.55 ? MATERIAL.oreCrystal : MATERIAL.oreGold,
  );
  /* And along the drift, which is otherwise eighteen blocks of bare wall
     between the two rooms that have something in them. Copper and gold: the
     drift is the part of the story about carrying a find out, so the rock it
     passes through should look like rock worth having driven through. */
  seam(
    driftStartY,
    cavRoof,
    CAVERN_AT + cavR,
    0.85,
    30,
    (pick) => (pick > 0.62 ? MATERIAL.oreGold : MATERIAL.oreCopper),
    Math.round((MINE_X + CAV_X) / 2),
    Math.round((MINE_Z + CAV_Z) / 2),
  );

  /* --- the one block that can be mined -------------------------------------
     Picked here, because only the generator knows which cells are chamber
     wall, which of them face the room rather than being buried behind it,
     and which already carry ore. This block has to be plain rock with ore
     UNDER it, so it must not be one of the seams it stands among.

     Its faces are then left out of the island's buffers while the cell stays
     SOLID -- so its neighbours go on hiding the faces they were already
     hiding, and what is left is a block-shaped gap that a separate,
     animatable mesh fills exactly. Nothing else in the scene has to know
     that one of its blocks is drawn by someone else. */
  let targetIdx = -1;
  let targetFace: [number, number, number] = [0, 0, 1];
  {
    /* Into the octant the seams favour, and a little above the floor: high
       enough to be clear of it in frame, low enough that the dome has not
       started closing in over it. */
    const WANT_BEARING = -0.62;
    /* Two above the floor, not three.

       A figure is 2.3 world units and stands on the chamber floor; with the
       pick raised its tip reaches about 2.6 above his feet. At three the
       block sat half a cube above the highest the pick ever gets, so the man
       at the face was swinging at the wall under it -- which no still ever
       showed, because a still does not have the arm at the top of its arc. */
    const WANT_Y = chamberFloorY + 2;
    const reach = CHAMBER_R + 1;
    let best = -Infinity;
    for (let y = chamberFloorY; y <= chamberTopY; y++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const x = MINE_X + dx;
          const z = MINE_Z + dz;
          if (!inside(x, y, z)) continue;
          const m = cells[at(x, y, z)];
          if (m !== MATERIAL.rock && m !== MATERIAL.deep) continue;

          /* Open to the CARVED air specifically, not to any empty cell. A
             block on the outside of the keel is also "exposed"; it is just
             exposed to the sky, forty metres from anywhere a visitor ever
             stands. */
          let face: [number, number, number] | null = null;
          for (let f = 0; f < 6; f++) {
            const [ox, oy, oz] = NB[f];
            if (!inside(x + ox, y + oy, z + oz)) continue;
            if (!carved.has(at(x + ox, y + oy, z + oz))) continue;
            face = [ox, oy, oz];
            break;
          }
          if (!face) continue;

          /* Away from the seams, not in them.

             Scoring on bearing and height alone put the block in the middle
             of the gold cluster, where it is a gold block among gold blocks
             before anyone touches it and a gold block among gold blocks
             after. The reveal only means anything against plain rock, so
             neighbouring ore is a penalty. */
          let near = 0;
          for (let f = 0; f < 6; f++) {
            const [ox, oy, oz] = NB[f];
            if (!inside(x + ox, y + oy, z + oz)) continue;
            const nb = cells[at(x + ox, y + oy, z + oz)];
            if (nb >= MATERIAL.oreCopper && nb <= MATERIAL.oreCrystal) near++;
          }

          const bearing = Math.atan2(dz, dx);
          let off = Math.abs(bearing - WANT_BEARING) % (Math.PI * 2);
          if (off > Math.PI) off = Math.PI * 2 - off;
          const score = -off * 3 - Math.abs(y - WANT_Y) * 0.8 - near * 2.5;
          if (score > best) {
            best = score;
            targetIdx = at(x, y, z);
            targetFace = face;
          }
        }
      }
    }
  }

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

  for (let dz = -SHAFT_R; dz <= SHAFT_R; dz++) {
    for (let dx = -SHAFT_R; dx <= SHAFT_R; dx++) {
      const k = at(MINE_X + dx, floorY, MINE_Z + dz);
      if (cells[k] !== EMPTY) continue;
      day.set(k, LIGHT_MAX);
      queue.push(MINE_X + dx, floorY, MINE_Z + dz);
    }
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
      if (cells[at(nx, ny, nz)] !== EMPTY) continue;
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

  for (let y = 0; y < H; y++) {
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const m = cells[at(x, y, z)];
        if (m === EMPTY) continue;

        // Sealed on all six sides: it can never be seen, so never draw it.
        if (
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
        if (m === MATERIAL.water) {
          // Water is lit by its own shader branch; sinking it into the
          // column's shadow just makes it look like dirty glass.
          ao = 0.97;
        } else if (m === MATERIAL.wood || m === MATERIAL.leaf) {
          /* Props stand clear of the ground and are not in its shadow.
             Inheriting the column's sky value would black out a tree grown
             in a hollow. */
          ao = m === MATERIAL.leaf ? 0.78 + hash3(x, y, z, seed) * 0.22 : 0.9;
        } else {
          const t = top[z * N + x];
          const depth = Math.max(0, t - y);
          // Underside and deep cliff faces fall away into shadow.
          /* Capped lower than before: at 0.55 the keel fell so far into
             shadow that the taper was invisible against the backdrop, which
             defeated the point of having one. */
          ao = sky[z * N + x] * (1 - Math.min(0.38, depth * 0.022));
        }

        const aoC = Math.max(0.22, Math.min(1, ao));
        /* Per-cube jitter, cut from +/-12% to +/-4%.

            It exists to stop a cliff being one flat rectangle, and at the old
            width it did something else as well: the spread WITHIN a band was
            measured at 1.46 while dirt and rock differed by only 1.28, so a
            bright rock block was lighter than a dark dirt one and the strata
            dissolved. Definition now comes from the face edges instead,
            which adds structure without adding luminance noise. */
        const tintC = 0.96 + hash3(x, y, z, seed ^ 0x5bd1) * 0.08;

        /* A face is emitted only where the neighbour on that side is empty --
           and since that neighbour is the air the face looks out into, it is
           also the thing that says how much daylight the face receives. Taken
           as a minimum against the sky-access figure: outside the dig the
           flood never ran, dayAt returns 1, and nothing changes. */
        // Drawn by the mineable-block mesh instead; see the pick above.
        const isTarget = targetIdx >= 0 && at(x, y, z) === targetIdx;

        let open = 0;
        for (let f = 0; f < 6; f++) {
          const [dx, dy, dz] = NB[f];
          const ax = x + dx;
          const ay = y + dy;
          const az = z + dz;
          if (solidAt(ax, ay, az)) continue;
          const d = dayAt(ax, ay, az);
          if (d > open) open = d;
          if (isTarget) continue;
          fOffsets.push(x - HALF, y, z - HALF);
          fDirs.push(f);
          fMaterials.push(m);
          fAos.push(Math.min(aoC, d));
          fTints.push(tintC);
        }

        if (isTarget) {
          /* Its sky access and jitter go with it, so the separate draw can
             reproduce exactly what this cell would have looked like. A block
             that is a shade off from the wall it sits in announces itself
             before anyone is meant to notice it. */
          target = {
            x: x - HALF,
            y,
            z: z - HALF,
            ao: Math.min(aoC, open),
            tint: tintC,
            face: targetFace,
            material: m,
          };
          continue;
        }

        /* The cube path has one value for all six sides, so it takes the
           brightest -- a block in a wall is lit by the side facing the room,
           not by the five buried in rock. */
        offsets.push(x - HALF, y, z - HALF);
        materials.push(m);
        aos.push(Math.min(aoC, open));
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
        /* A touch of jitter per cube. The column is one material over 70-odd
           blocks, and without it the fall is a flat painted stripe. */
        const tintC = 0.97 + hash3(cx, y, cz, seed ^ 0x3cc1) * 0.06;
        /* The AO slot carries how far down the fall this block is instead --
           0 at the lip, 1 at the sea. Falling water has no sky-access
           shadow, so the channel was dead weight, and the shader needs the
           progress to put broken white at the crest and the base without
           either a seventh attribute or a uniform per fall. */
        const prog = (f.lip - y) / span;
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
        }
        // Only the lip shows a top face; the base is under the sea surface.
        if (y === f.lip) {
          fOffsets.push(cx - HALF, y, cz - HALF);
          fDirs.push(2);
          fMaterials.push(MATERIAL.fall);
          fAos.push(prog);
          fTints.push(tintC);
        }
      }
    }

    fallMeta.push({
      x: f.x + f.dx * 1.5 + px * 0.5 - HALF,
      z: f.z + f.dz * 1.5 + pz * 0.5 - HALF,
    });
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
    faceCount: fDirs.length,
    solid,
    trees,
    rocks,
    falls: fallMeta,
    cells,
    mine: {
      x: MINE_X - HALF,
      z: MINE_Z - HALF,
      rimY,
      floorY,
      shaftBottomY,
      chamberY: chamberFloorY + CHAMBER_H * 0.45,
      chamberFloorY,
      chamberR: CHAMBER_R,
      ore,
      target,
      drift: driftLine,
      driftDir,
      cavern: {
        x: CAV_X - HALF,
        z: CAV_Z - HALF,
        floorY: cavFloor,
        roofY: cavRoof,
        r: cavR,
      },
      crystal: { x: CRY_X - HALF, y: cavFloor, z: CRY_Z - HALF, h: CRY_H },
    },
  };
}
