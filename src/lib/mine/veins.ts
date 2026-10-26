/* ----------------------------------------------------------------------------
   ORE VEIN GEOMETRY

   A deterministic branching structure grown by space colonisation: scatter
   attractors through a volume of rock, let nodes grow toward the attractors
   nearest them, and remove each attractor once something has reached it.

   Space colonisation rather than a recursive/L-system split because the two
   produce visibly different things. A recursive split gives you a diagram of
   a tree — self-similar, evenly forked, obviously generated. Space
   colonisation gives you irregular spacing, branches that crowd where the
   material is rich and stretch where it is thin, and the occasional long
   unbranched run. That is what an ore vein looks like, and it is also what a
   dendrite looks like, which is the whole argument of this section.

   Everything here is pure and seeded: no DOM, no time, no randomness that
   differs between two runs. That matters for three separate reasons — the
   reduced-motion path renders exactly one frame and must not get a different
   structure than the animated path, the server and client must agree, and a
   layout that changes on every reload cannot be art-directed.
-------------------------------------------------------------------------------*/

export type VeinGeometry = {
  /** xyz triples, interleaved. */
  position: Float32Array;
  /** 0 at the shaft, 1 at the far tip of that vein. Drives the flow pulse. */
  along: Float32Array;
  /** 0 at the surface, 1 at bedrock. Drives the scroll reveal. */
  depth: Float32Array;
  /** Which extraction level fed this point, or -1 for the shaft itself. */
  level: Float32Array;
  /** Da Vinci thickness, already normalised to 0..1. Drives point size. */
  thickness: Float32Array;
  /** Stable per-point noise, so points can twinkle without a time-varying hash. */
  seed: Float32Array;
  /** 0 barren rock .. 1 ore. Decided here, not in the shader, because the
      extraction beat has to displace exactly these points. */
  ore: Float32Array;
  /** Depth of the SEAM this point belongs to, as opposed to its own depth.
      Extraction fires per seam, so every point in a seam must share one
      trigger or a vein would tear itself apart as the cut crossed it. */
  anchorDepth: Float32Array;
  count: number;
};

export type VeinOptions = {
  /** How many extraction levels to grow from. One per delivery stage. */
  levels?: number;
  /** Attractor count. The single biggest lever on both richness and cost. */
  attractors?: number;
  /** Roughly the distance a branch advances per growth iteration. */
  step?: number;
  seed?: number;
};

/* The same generator the load topology used. Small, fast, and — unlike
   Math.random — seedable, which is the only property that matters here. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Node = {
  x: number;
  y: number;
  z: number;
  parent: number;
  level: number;
  /** Cumulative path length from this node's root. */
  dist: number;
  children: number;
  thickness: number;
};

/* Uniform-grid spatial hash over the node set.

   Without it this is O(attractors x nodes) every iteration — with the counts
   below that is well over a hundred million distance checks, on the main
   thread, before the first frame. The grid makes each attractor look at the
   27 cells around it instead of the whole structure. Cell size is the
   influence radius, which is what makes 27 cells sufficient: nothing outside
   them can be within range. */
class NodeGrid {
  private cells = new Map<number, number[]>();
  constructor(private size: number) {}

  private key(x: number, y: number, z: number) {
    const i = Math.floor(x / this.size);
    const j = Math.floor(y / this.size);
    const k = Math.floor(z / this.size);
    // Three smallish integers folded into one number. The multipliers are
    // primes so that (i,j,k) triples do not collide in a regular pattern.
    return i * 73856093 + j * 19349663 + k * 83492791;
  }

  insert(index: number, x: number, y: number, z: number) {
    const k = this.key(x, y, z);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(index);
    else this.cells.set(k, [index]);
  }

  near(x: number, y: number, z: number, out: number[]) {
    out.length = 0;
    const ci = Math.floor(x / this.size);
    const cj = Math.floor(y / this.size);
    const ck = Math.floor(z / this.size);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let k = ck - 1; k <= ck + 1; k++) {
          const bucket = this.cells.get(
            i * 73856093 + j * 19349663 + k * 83492791,
          );
          if (bucket) for (const n of bucket) out.push(n);
        }
      }
    }
  }
}

/* The rock mass. Wider than it is deep because this is read as a cross
   section — a cutaway through the ground, not a block floating in space. */
const X_HALF = 0.62;
const Z_HALF = 0.3;
const Y_TOP = -0.06;
const Y_BOT = -0.96;
/* Nothing grows inside this radius of the shaft: that is the void the shaft
   occupies, and veins reaching across it would read as scaffolding. */
const SHAFT_R = 0.04;

/* The shader needs the same vertical bounds and shaft radius to aim the
   extraction travel, and two copies of these numbers would drift apart. */
export const VEIN_BOUNDS = { yTop: Y_TOP, yBot: Y_BOT, shaftR: SHAFT_R };

const INFLUENCE = 0.19;
const KILL = 0.032;
const MAX_ITER = 170;
/* Hard ceiling on the node count. Node growth is not bounded by the attractor
   count — a single attractor can pull a branch for many iterations — so the
   accumulators are sized from this instead. Writing past the end of a typed
   array is silently discarded rather than throwing, so without the cap an
   overflow would show up as veins that mysteriously stop growing. */
const MAX_NODES = 24000;

export function buildVeins(opts: VeinOptions = {}): VeinGeometry {
  const levels = opts.levels ?? 5;
  const attractorCount = opts.attractors ?? 1500;
  const step = opts.step ?? 0.021;
  const rnd = mulberry32(opts.seed ?? 0x0e1a);

  /* --- attractors -------------------------------------------------------- */
  const ax: number[] = [];
  const ay: number[] = [];
  const az: number[] = [];
  const alive: boolean[] = [];

  for (let i = 0; i < attractorCount; i++) {
    let x = 0;
    let z = 0;
    let r = 0;
    // Rejection-sample the shaft void rather than pushing points out of it:
    // displacing them piles attractors against the shaft wall and the veins
    // all sprout from one ring.
    do {
      x = (rnd() * 2 - 1) * X_HALF;
      z = (rnd() * 2 - 1) * Z_HALF;
      r = Math.hypot(x, z);
    } while (r < SHAFT_R * 1.6);

    /* Biased toward the walls: rock near the shaft has already been dug out.
       Cubing a 0..1 uniform pushes mass outward without a hard edge. */
    const bias = 0.35 + 0.65 * Math.pow(rnd(), 0.6);
    ax.push(x * bias + (rnd() - 0.5) * 0.06);
    ay.push(Y_TOP + (Y_BOT - Y_TOP) * rnd());
    az.push(z * bias);
    alive.push(true);
  }

  /* --- roots ------------------------------------------------------------- */
  const nodes: Node[] = [];
  const grid = new NodeGrid(INFLUENCE);

  const addNode = (
    x: number,
    y: number,
    z: number,
    parent: number,
    level: number,
    dist: number,
  ) => {
    const i = nodes.length;
    nodes.push({ x, y, z, parent, level, dist, children: 0, thickness: 0 });
    if (parent >= 0) nodes[parent].children++;
    grid.insert(i, x, y, z);
    return i;
  };

  /* One seam per delivery stage, spaced down the shaft with margin at both
     ends so the first and last are not flush against the surface or bedrock. */
  for (let l = 0; l < levels; l++) {
    const t = (l + 0.5) / levels;
    const y = Y_TOP + (Y_BOT - Y_TOP) * t;
    /* Two roots per level, pointing opposite ways out of the shaft wall, so
       a seam reads as cut THROUGH by the shaft rather than hanging off it. */
    for (const dir of [-1, 1]) {
      const jitter = (rnd() - 0.5) * 0.05;
      addNode(dir * SHAFT_R, y + jitter, (rnd() - 0.5) * 0.04, -1, l, 0);
    }
  }

  /* --- grow -------------------------------------------------------------- */
  const accX = new Float64Array(MAX_NODES);
  const accY = new Float64Array(MAX_NODES);
  const accZ = new Float64Array(MAX_NODES);
  const accN = new Int32Array(MAX_NODES);
  const candidates: number[] = [];
  /* How much of the node array the kill pass has already seen. Not the same
     as the growth front: the roots exist before the first iteration and must
     be tested too, or an attractor sitting on a root survives and drags that
     branch outward forever. */
  let killChecked = 0;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    accN.fill(0, 0, nodes.length);
    accX.fill(0, 0, nodes.length);
    accY.fill(0, 0, nodes.length);
    accZ.fill(0, 0, nodes.length);

    let active = 0;

    for (let a = 0; a < attractorCount; a++) {
      if (!alive[a]) continue;
      active++;
      grid.near(ax[a], ay[a], az[a], candidates);

      let best = -1;
      let bestD = INFLUENCE * INFLUENCE;
      for (const n of candidates) {
        const dx = ax[a] - nodes[n].x;
        const dy = ay[a] - nodes[n].y;
        const dz = az[a] - nodes[n].z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best < 0) continue;

      const dx = ax[a] - nodes[best].x;
      const dy = ay[a] - nodes[best].y;
      const dz = az[a] - nodes[best].z;
      const len = Math.hypot(dx, dy, dz) || 1;
      accX[best] += dx / len;
      accY[best] += dy / len;
      accZ[best] += dz / len;
      accN[best]++;
    }

    if (active === 0) break;

    const grownFrom = nodes.length;
    for (let n = 0; n < grownFrom; n++) {
      if (accN[n] === 0) continue;
      if (nodes.length >= MAX_NODES) break;
      let dx = accX[n] / accN[n];
      let dy = accY[n] / accN[n];
      let dz = accZ[n] / accN[n];

      /* A slight downward lean. Ore follows gravity and bedding planes, and
         without it the structure grows as a symmetric starburst that reads
         as a dandelion rather than a seam. */
      dy -= 0.16;
      /* Z is compressed so branches stay near the cutting plane; otherwise
         half the structure points at the camera and reads as noise. */
      dz *= 0.55;

      const len = Math.hypot(dx, dy, dz) || 1;
      const nx = nodes[n].x + (dx / len) * step;
      const ny = nodes[n].y + (dy / len) * step;
      const nz = nodes[n].z + (dz / len) * step;

      if (ny > Y_TOP || ny < Y_BOT) continue;
      if (Math.abs(nx) > X_HALF || Math.abs(nz) > Z_HALF) continue;

      addNode(nx, ny, nz, n, nodes[n].level, nodes[n].dist + step);
    }

    if (nodes.length === grownFrom) break;

    /* Only nodes the kill pass has not already seen can newly satisfy the
       kill radius: an older node was tested against this attractor on an
       earlier pass, and nodes never move. Skipping them turns the kill pass
       from a scan of the whole structure into a scan of what is new. */
    for (let a = 0; a < attractorCount; a++) {
      if (!alive[a]) continue;
      grid.near(ax[a], ay[a], az[a], candidates);
      for (const n of candidates) {
        if (n < killChecked) continue;
        const dx = ax[a] - nodes[n].x;
        const dy = ay[a] - nodes[n].y;
        const dz = az[a] - nodes[n].z;
        if (dx * dx + dy * dy + dz * dz < KILL * KILL) {
          alive[a] = false;
          break;
        }
      }
    }
    killChecked = nodes.length;
  }

  /* --- thickness --------------------------------------------------------- */
  /* Da Vinci's rule: a branch is as thick as its children combined, summed in
     area rather than radius. Walking the array backwards is enough to reach
     every child before its parent, because a node is always appended after
     the node it grew from. */
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.children === 0) n.thickness = 1;
    if (n.parent >= 0) {
      nodes[n.parent].thickness = Math.sqrt(
        nodes[n.parent].thickness * nodes[n.parent].thickness +
          n.thickness * n.thickness,
      );
    }
  }
  let maxThick = 1;
  for (const n of nodes) if (n.thickness > maxThick) maxThick = n.thickness;

  /* Longest run per level, so `along` is 0..1 within its own seam rather than
     across the whole structure — otherwise short seams never reach a full
     pulse and look dead next to long ones. */
  const maxDist = new Float64Array(levels).fill(1e-6);
  for (const n of nodes) {
    if (n.level >= 0 && n.dist > maxDist[n.level]) maxDist[n.level] = n.dist;
  }

  /* --- flatten to points ------------------------------------------------- */
  const px: number[] = [];
  const pAlong: number[] = [];
  const pDepth: number[] = [];
  const pLevel: number[] = [];
  const pThick: number[] = [];
  const pSeed: number[] = [];
  const pOre: number[] = [];
  const pAnchor: number[] = [];

  const pushPoint = (
    x: number,
    y: number,
    z: number,
    along: number,
    level: number,
    thick: number,
    anchorDepth: number,
  ) => {
    px.push(x, y, z);
    pAlong.push(along);
    // Depth is measured in world space, not along the branch: the scroll
    // reveal is a plane descending through the rock, and it should cut
    // everything at that height at once regardless of which seam fed it.
    pDepth.push((y - Y_TOP) / (Y_BOT - Y_TOP));
    pLevel.push(level);
    pThick.push(thick);
    const s = rnd();
    pSeed.push(s);
    pAnchor.push(anchorDepth);
    /* Ore concentrates in the thick trunks, with enough per-point noise that
       the ore/rock boundary is ragged instead of a clean threshold. */
    const v = Math.min(1, Math.max(0, (thick * 0.75 + s * 0.4 - 0.18) / 0.44));
    pOre.push(v * v * (3 - 2 * v));
  };

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0) continue;
    const p = nodes[n.parent];
    const thick = n.thickness / maxThick;

    /* Denser sampling on thick trunks than on hair-thin tips: it is the
       trunks that have to read as solid matter. The floor of 4 is what makes
       a vein read as a continuous seam rather than a dotted line -- sprites
       have to overlap along the segment, not merely sit near each other. */
    const samples = 4 + Math.round(thick * 9);
    for (let s = 0; s < samples; s++) {
      const t = (s + rnd() * 0.85) / samples;
      pushPoint(
        p.x + (n.x - p.x) * t,
        p.y + (n.y - p.y) * t,
        p.z + (n.z - p.z) * t,
        Math.min(1, (p.dist + (n.dist - p.dist) * t) / maxDist[n.level]),
        n.level,
        thick,
        (n.level + 0.5) / levels,
      );
    }
  }

  /* --- the shaft --------------------------------------------------------- */
  /* Level -1. Dense, nearly straight, and slightly noisy so it reads as a cut
     rather than a drawn line. This is the one piece of the structure the
     viewer is travelling along, so it stays visible at every scroll depth. */
  const shaftPoints = 520;
  for (let i = 0; i < shaftPoints; i++) {
    const t = i / shaftPoints;
    const y = Y_TOP + (Y_BOT - Y_TOP) * t;
    const ang = rnd() * Math.PI * 2;
    const r = SHAFT_R * (0.55 + rnd() * 0.45);
    pushPoint(
      Math.cos(ang) * r,
      y,
      Math.sin(ang) * r * 0.6,
      t,
      -1,
      0.22 + rnd() * 0.2,
      // The shaft is the route out, not a seam -- it is never extracted.
      t,
    );
  }

  return {
    position: new Float32Array(px),
    along: new Float32Array(pAlong),
    depth: new Float32Array(pDepth),
    level: new Float32Array(pLevel),
    thickness: new Float32Array(pThick),
    seed: new Float32Array(pSeed),
    ore: new Float32Array(pOre),
    anchorDepth: new Float32Array(pAnchor),
    count: pAlong.length,
  };
}
