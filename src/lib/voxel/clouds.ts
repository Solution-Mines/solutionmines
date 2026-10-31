/* ----------------------------------------------------------------------------
   CLOUDS

   Flat slabs of white at the height of the island's top, drifting very
   slowly. Few things say "a world made of blocks" faster than square clouds,
   and reference 1 frames its island with exactly these.

   Laid out on a coarse grid from a noise mask, with each row of adjacent
   cloud cells merged into one long box so a cloud bank is a handful of
   instances, not dozens. Kept out of a ring around the island -- a cloud is
   never allowed to sit over the thing it is framing -- and out of the wedge
   between the island and the opening camera, so the first frame is never a
   wall of white.
-------------------------------------------------------------------------------*/

const CELL = 6;
const THICK = 2.4;
/** Underside of the cloud layer, level with the island's plateau. */
const BASE_Y = 50;
/** Clear of the island's corners, which reach forty-three from its middle. */
const R_MIN = 56;
const R_MAX = 190;
/** The opening camera's bearing from the island, and the half-width of the
    wedge kept clear in front of it. */
const HERO_BEARING = Math.atan2(109, 78);
const HERO_CLEAR = 0.42;
/** And the ledge's: the approach to the mine is filmed from out over the
    sea on that side, and a cloud bank there is a wall in front of the lens. */
const LEDGE_BEARING = Math.atan2(6.5, 32);
const LEDGE_CLEAR = 0.5;

function hash(x: number, z: number) {
  let h = Math.imul(x + 0x3c5, 0x27d4eb2d) ^ Math.imul(z - 0x71, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Value noise, so clouds come in banks with ragged edges rather than as
   salt and pepper. */
function noise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fz) + (a - b - c + d) * s(fx) * s(fz);
}

export type Clouds = {
  /** Per box: centre xyz and a drift phase. */
  at: Float32Array;
  /** Per box: size. */
  size: Float32Array;
  count: number;
};

export function buildClouds(): Clouds {
  const at: number[] = [];
  const size: number[] = [];
  const span = Math.ceil(R_MAX / CELL);
  const keep = (gx: number, gz: number) => {
    const x = gx * CELL;
    const z = gz * CELL;
    const r = Math.hypot(x, z);
    if (r < R_MIN || r > R_MAX) return false;
    let off = Math.atan2(z, x) - HERO_BEARING;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    if (Math.abs(off) < HERO_CLEAR && r < 165) return false;
    let side = Math.atan2(z, x) - LEDGE_BEARING;
    side = Math.atan2(Math.sin(side), Math.cos(side));
    if (Math.abs(side) < LEDGE_CLEAR && r < 120) return false;
    return noise(gx / 3.2, gz / 3.2) > 0.6;
  };
  for (let gz = -span; gz <= span; gz++) {
    let run = 0;
    for (let gx = -span; gx <= span + 1; gx++) {
      if (gx <= span && keep(gx, gz)) {
        run++;
        continue;
      }
      if (run > 0) {
        const x0 = (gx - run) * CELL;
        const len = run * CELL;
        // Every other row a little thicker, so a bank has a stepped edge.
        const thick = THICK * (Math.abs(gz) % 2 === 0 ? 1 : 0.8);
        at.push(x0 + len / 2 - CELL / 2, BASE_Y + thick / 2, gz * CELL, hash(gz, run) * 6.28);
        size.push(len, thick, CELL);
        run = 0;
      }
    }
  }
  return { at: new Float32Array(at), size: new Float32Array(size), count: at.length / 4 };
}
