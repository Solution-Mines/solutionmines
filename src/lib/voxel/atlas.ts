/* ----------------------------------------------------------------------------
   THE ATLAS

   Every texture in the scene, painted in code at startup into one image.

   WHY TEXTURES AT ALL
   A voxel scene in flat colours reads as a low-poly demo, however well it is
   lit. What makes the genre recognisable is a 16x16 pixel picture on every
   face: grass that hangs over the edge of the dirt, speckled dirt, mottled
   stone, ore sitting in rock as specks, plank seams, bark. That was the single
   largest gap between the previous build and every reference image.

   WHY PAINTED IN CODE
   No image files, no exported assets, and nothing copied from any game: each
   tile is a short hand-designed rule plus seeded noise. The base colours are
   the palette calibrated in the last pass, and every tile is built as that
   colour times a pattern whose multipliers average out near one -- so at a
   distance, where the pattern can no longer be resolved, each material comes
   back to the colour it was measured at.

   LAYOUT
   256 wide. The top 256 rows are 16x16 block tiles, sixteen to a row. Below
   them, crew skins: 64x64 each, four to a row. The top half of each is the
   head alone, at sixteen texels a side -- a face needs the room to have
   eyes with a catchlight in them, brows and a mouth that smiles, and at
   eight texels it had a row for each. The bottom half is the body, the arms
   and the legs, unfolded as box nets at the terrain's own density.

   MIP LEVELS
   Built here, in LINEAR light, rather than by the GPU. The shader fetches
   exact texels with texelFetch -- no filtering, no bleeding between tiles --
   and picks its own level from the screen footprint. Tiles sit on 16-pixel
   boundaries, so down to level 4 every tile is still its own block of texels
   and level 4 is exactly one texel per tile: the tile's average colour.

   EMISSION
   The alpha channel is not transparency. It says how much light a texel gives
   off by itself: the facets of a crystal, the metal in an ore. Per texel, so
   a nugget glows and the rock it sits in does not -- the whole block glowing
   is what made the first ore read as a lit cube rather than metal in stone.
   Averaged down the mip chain like the colour, so a distant seam glows by
   the share of it that is metal.
-------------------------------------------------------------------------------*/

export type RGB = [number, number, number];
/** A colour and how much light the texel gives off on its own, 0..1. The
    fourth number rides in the atlas's alpha channel. */
export type RGBE = [number, number, number, number];

export const ATLAS_W = 256;
export const TILE = 16;
const TILE_ROWS = 16;
export const SKIN_W = 64;
export const SKIN_H = 64;
const SKINS_PER_ROW = ATLAS_W / SKIN_W;
export const SKIN_Y = TILE * TILE_ROWS;
export const SKIN_ROWS = 2;
export const ATLAS_H = SKIN_Y + SKIN_H * SKIN_ROWS;
/** Deepest level built. At 4 a block tile is one texel. */
export const ATLAS_LEVELS = 5;

/** Tile slots. A slot number is its position in the 16-wide grid. */
export const T = {
  grassTop: 0,
  grassSide: 1,
  dirt: 2,
  stone: 3,
  granite: 4,
  deepslate: 5,
  logSide: 6,
  logTop: 7,
  leaves: 8,
  planks: 9,
  oreCopper: 10,
  oreGold: 11,
  crystal: 12,
  iron: 13,
  crate: 14,
  water: 15,
  fall: 16,
  gravel: 17,
  birchSide: 18,
  birchTop: 19,
  birchLeaves: 20,
  /* Plants: alpha here is COVERAGE, not emission -- they are cut out by
     their own program and never drawn on a block. */
  tuft: 21,
  fern: 22,
  flowerRed: 23,
  flowerYellow: 24,
  flowerBlue: 25,
  vine: 26,
  root: 27,
  /** Four tiles side by side: the board over the portal. */
  sign: 28,
  oreCoal: 32,
  oreIron: 33,
  oreRed: 34,
  oreGreen: 35,
  lava: 36,
  /** Ten tiles side by side: a block giving way, stage by stage. Alpha is
      COVERAGE here, as on the plants -- the crack is drawn over the block. */
  crack: 40,
  /** Items, for the page's hotbar rather than the world: alpha is coverage. */
  itemMap: 50,
  itemPick: 51,
  itemIngot: 52,
  itemCart: 53,
  itemBeacon: 54,
} as const;

/* --- the palette ------------------------------------------------------------
   The calibrated material colours, unchanged. They are the far-distance colour
   of each tile, so the luminance separation measured between strata still
   holds wherever the texture has averaged away. */
export const PALETTE = {
  /* Retuned for a real sun. Under the old flat light these read true; under
     a key light past white the grass went lime, the dirt orange and the
     stone to sand. A deeper, cooler green, a browner earth, a greyer stone
     -- the warmth now comes from the light, not the paint. */
  grass: [0.35, 0.53, 0.25] as RGB,
  dirt: [0.47, 0.33, 0.22] as RGB,
  stone: [0.5, 0.5, 0.5] as RGB,
  /* Browner and less red than it was: the mine is cut in this band now, and
     under lantern light the old red went to a single flat orange. */
  rock: [0.4, 0.31, 0.26] as RGB,
  wood: [0.46, 0.31, 0.17] as RGB,
  leaf: [0.25, 0.44, 0.19] as RGB,
  deep: [0.195, 0.205, 0.255] as RGB,
  copper: [0.78, 0.42, 0.2] as RGB,
  gold: [0.95, 0.76, 0.24] as RGB,
  crystal: [0.24, 0.6, 0.72] as RGB,
  planks: [0.6, 0.45, 0.27] as RGB,
  iron: [0.46, 0.48, 0.52] as RGB,
  water: [0.18, 0.42, 0.62] as RGB,
  gravel: [0.52, 0.5, 0.48] as RGB,
  birch: [0.86, 0.85, 0.8] as RGB,
  birchLeaf: [0.4, 0.55, 0.22] as RGB,
  /** The site's accent. Vests, and nowhere it would compete with ore. */
  // The brand's orange, a shade under full: under a lamp past white it
  // still has to be orange rather than a hot white-yellow.
  hivis: [0.93, 0.4, 0.22] as RGB,
};

/* Which tile each face of each material shows: [top, sides, bottom]. Indexed
   by the material ids in terrain.ts. */
const MATERIAL_TILES: Array<[number, number, number]> = [
  [T.grassTop, T.grassSide, T.dirt], // 0 grass
  [T.dirt, T.dirt, T.dirt], // 1 dirt
  [T.stone, T.stone, T.stone], // 2 stone
  [T.granite, T.granite, T.granite], // 3 rock
  [T.logTop, T.logSide, T.logTop], // 4 wood
  [T.leaves, T.leaves, T.leaves], // 5 leaf
  [T.water, T.water, T.water], // 6 water
  [T.fall, T.fall, T.fall], // 7 fall
  [T.deepslate, T.deepslate, T.deepslate], // 8 deep
  [T.oreCopper, T.oreCopper, T.oreCopper], // 9 copper ore
  [T.oreGold, T.oreGold, T.oreGold], // 10 gold ore
  [T.crystal, T.crystal, T.crystal], // 11 crystal
  [T.planks, T.planks, T.planks], // 12 planks
  [T.gravel, T.gravel, T.gravel], // 13 gravel
  [T.birchTop, T.birchSide, T.birchTop], // 14 birch
  [T.birchLeaves, T.birchLeaves, T.birchLeaves], // 15 birch leaves
  [T.oreCoal, T.oreCoal, T.oreCoal], // 16 coal
  [T.oreIron, T.oreIron, T.oreIron], // 17 iron
  [T.oreRed, T.oreRed, T.oreRed], // 18 red ore
  [T.oreGreen, T.oreGreen, T.oreGreen], // 19 green ore
  [T.lava, T.lava, T.lava], // 20 lava
];

/* Tiles with no up or down in them may be turned per block, which is most of
   what stops a cliff of one material reading as wallpaper. Grass sides, bark,
   planks and the ores keep their orientation: grass hangs DOWN, bark runs up
   the trunk, and a nugget with its highlight on the wrong side looks lit
   from below. */
const TURNABLE = new Set<number>([
  T.grassTop,
  T.dirt,
  T.gravel,
  T.birchLeaves,
  T.stone,
  T.granite,
  T.leaves,
  T.crystal,
]);

/** The tile a face shows, with a quarter-turn packed above bit 8 where the
    tile allows one. Face ids are the emitter's: +X -X +Y -Y +Z -Z. */
export function tileFor(material: number, face: number, turn: number): number {
  const set = MATERIAL_TILES[material] ?? MATERIAL_TILES[2];
  const tile = face === 2 ? set[0] : face === 3 ? set[2] : set[1];
  return TURNABLE.has(tile) ? tile + 256 * (turn & 3) : tile;
}

/* --- crew looks -------------------------------------------------------------
   Painted into the skin rows. Original people, not any game's characters:
   hard hats with a lamp, the site's orange hi-vis over a work shirt, gloves,
   boots. The surveyor wears white -- on a real site white helmets mark the
   engineers, which is a small piece of storytelling that costs nothing. */
export type Look = {
  skin: RGB;
  hair: RGB;
  beard?: boolean;
  shirt: RGB;
  trousers: RGB;
  boots: RGB;
  helmet: RGB;
  eyes: RGB;
};

const SKIN_TONES: RGB[] = [
  [0.88, 0.71, 0.58],
  [0.8, 0.6, 0.45],
  [0.64, 0.45, 0.31],
  [0.45, 0.3, 0.21],
  [0.33, 0.22, 0.15],
];
const HAIR = {
  black: [0.1, 0.08, 0.07] as RGB,
  brown: [0.25, 0.16, 0.09] as RGB,
  ginger: [0.6, 0.29, 0.12] as RGB,
  blonde: [0.82, 0.66, 0.36] as RGB,
  grey: [0.55, 0.54, 0.52] as RGB,
};
const HELMET = {
  orange: PALETTE.hivis,
  white: [0.92, 0.92, 0.89] as RGB,
  yellow: [0.97, 0.78, 0.2] as RGB,
};

export const LOOKS: Look[] = [
  // 0 the surveyor
  { skin: SKIN_TONES[3], hair: HAIR.black, shirt: [0.3, 0.45, 0.66], trousers: [0.2, 0.21, 0.24], boots: [0.16, 0.12, 0.1], helmet: HELMET.white, eyes: [0.24, 0.16, 0.1] },
  // 1 bearded rigger
  { skin: SKIN_TONES[0], hair: HAIR.ginger, beard: true, shirt: [0.2, 0.32, 0.22], trousers: [0.22, 0.3, 0.45], boots: [0.12, 0.11, 0.11], helmet: HELMET.orange, eyes: [0.25, 0.42, 0.6] },
  // 2 lamp bearer
  { skin: SKIN_TONES[1], hair: HAIR.black, shirt: [0.38, 0.38, 0.4], trousers: [0.15, 0.18, 0.28], boots: [0.2, 0.14, 0.1], helmet: HELMET.yellow, eyes: [0.2, 0.14, 0.1] },
  // 3 at the face
  { skin: SKIN_TONES[4], hair: HAIR.black, shirt: [0.16, 0.2, 0.32], trousers: [0.52, 0.46, 0.32], boots: [0.18, 0.13, 0.1], helmet: HELMET.orange, eyes: [0.18, 0.12, 0.08] },
  // 4 at the face, second pick
  { skin: SKIN_TONES[0], hair: HAIR.blonde, shirt: [0.42, 0.16, 0.16], trousers: [0.22, 0.3, 0.45], boots: [0.12, 0.11, 0.11], helmet: HELMET.orange, eyes: [0.3, 0.5, 0.42] },
  // 5 loader
  { skin: SKIN_TONES[2], hair: HAIR.brown, beard: true, shirt: [0.36, 0.3, 0.22], trousers: [0.2, 0.21, 0.24], boots: [0.16, 0.12, 0.1], helmet: HELMET.orange, eyes: [0.22, 0.15, 0.1] },
  // 6 finder
  { skin: SKIN_TONES[1], hair: HAIR.grey, shirt: [0.2, 0.3, 0.3], trousers: [0.15, 0.18, 0.28], boots: [0.12, 0.11, 0.11], helmet: HELMET.white, eyes: [0.28, 0.4, 0.55] },
  // 7 pusher
  { skin: SKIN_TONES[2], hair: HAIR.black, shirt: [0.3, 0.26, 0.26], trousers: [0.52, 0.46, 0.32], boots: [0.2, 0.14, 0.1], helmet: HELMET.orange, eyes: [0.2, 0.14, 0.1] },
];

/** Where a crew skin starts in the atlas, in pixels. */
export function skinOrigin(i: number): [number, number] {
  return [(i % SKINS_PER_ROW) * SKIN_W, SKIN_Y + Math.floor(i / SKINS_PER_ROW) * SKIN_H];
}

/* Box nets inside one skin, in skin pixels: [u, v, w, h, d]. The fold follows
   the shader exactly -- see the net lookup in crew.glsl.ts -- so a face
   painted here lands on that face of the box. */
export const NET = {
  head: [0, 0, 16, 16, 16],
  body: [32, 32, 8, 12, 4],
  armR: [0, 48, 4, 12, 4],
  armL: [16, 48, 4, 12, 4],
  legR: [32, 48, 4, 12, 4],
  legL: [48, 48, 4, 12, 4],
} as const;

/* The face, drawn as it is seen: column 0 is the figure's own right, row 0
   the top, under the brim of the hat. Big eyes with the catchlight on the
   same side in both -- light comes from one place -- brows, a nose that is
   only its shadow, a mouth turned up at the corners.

     h hair   s skin   d skin in shade   c cheek   b brow
     w white of the eye   g catchlight   i iris   k pupil
     m mouth   t lip */
const FACE = [
  "hhhhhhhhhhhhhhhh",
  "hhhhhhhhhhhhhhhh",
  "hhhhhhhhhhhhhhhh",
  "hssssssssssssssh",
  "hssssssssssssssh",
  "ssbbbbssssbbbbss",
  "sswwwwsssswwwwss",
  "sswgkwsssswgkwss",
  "sswikwsssswikwss",
  "ssssssssssssssss",
  "scssssddddsssscs",
  "ssssmssssssmssss",
  "sssssmmmmmmsssss",
  "ssssssttttssssss",
  "ssssssssssssssss",
  "dssssssssssssssd",
] as const;

/* --- painting ---------------------------------------------------------------*/

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;

/** A stable per-pixel hash, 0..1. Wrapped at 16 so every tile repeats with
    itself, and keyed by a salt so two tiles never share a pattern. */
function hash(x: number, y: number, salt: number) {
  let h = Math.imul((x & 15) + 1, 0x27d4eb2d) ^ Math.imul((y & 15) + 7, 0x165667b1) ^ Math.imul(salt + 13, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const scale = (c: RGB, m: number): RGB => [c[0] * m, c[1] * m, c[2] * m];
const mixC = (a: RGB, b: RGB, k: number): RGB => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

type Painter = (x: number, y: number) => RGB | RGBE;

/* Each tile is a rule from a pixel to a colour. They are written to be read:
   a pattern first, then the few pixels that break it. */

/* The textures are calmer than the first pass: larger clumps, smaller steps
   between neighbouring texels, fewer dark specks. Up close under a real sun
   with real shadows, per-texel noise at the old strength read as static --
   the light now does the work the noise was doing. */
const grassTop: Painter = (x, y) => {
  const clump = hash(x >> 2, y >> 2, 13) * 0.6 + hash(x >> 1, y >> 1, 11) * 0.4;
  const n = hash(x, y, 12);
  let m = 0.95 + clump * 0.1;
  if (n < 0.08) m *= 0.88; // the shadow side of a blade
  const c = scale(PALETTE.grass, m);
  // Bright tips go a touch yellow, which is what keeps grass from reading teal.
  return n > 0.94 ? [c[0] * 1.08, c[1] * 1.06, c[2] * 0.94] : c;
};

// Plain colour: grassSide darkens it, which needs three channels.
const dirt = (x: number, y: number): RGB => {
  const clump = hash(x >> 1, y >> 1, 21);
  const n = hash(x, y, 22);
  if (n > 0.975) return [0.56, 0.52, 0.47]; // a pebble
  let m = 0.95 + n * 0.08;
  if (clump < 0.2) m = 0.84 + n * 0.06;
  else if (clump > 0.86 && n > 0.55) m = 1.1;
  return scale(PALETTE.dirt, m);
};

const grassSide: Painter = (x, y) => {
  /* Grass hanging over the edge of the dirt: three rows everywhere, then a
     ragged fringe one or two rows deeper, and a dark line of shadow under
     the fringe so the overhang reads as an overhang and not a stripe. */
  const depth =
    3 + (hash(x, 0, 31) < 0.5 ? 1 : 0) + (hash(x, 1, 32) < 0.2 ? 1 : 0) + (hash(x, 2, 33) < 0.07 ? 1 : 0);
  if (y < depth) {
    const m = (y === depth - 1 ? 0.84 : 0.94) * (0.92 + hash(x, y, 34) * 0.16);
    return scale(PALETTE.grass, m);
  }
  if (y === depth) return scale(dirt(x, y), 0.76);
  return dirt(x, y);
};

const stone: Painter = (x, y) => {
  // Long low blotches, wider than tall, the way sedimentary stone mottles.
  const blot = hash(x >> 2, y >> 1, 41);
  const n = hash(x, y, 42);
  let m = 0.93 + blot * 0.12 + (n - 0.5) * 0.05;
  if (hash(x >> 1, y, 43) < 0.05) m *= 0.84; // short cracks
  if (n > 0.972) m = 1.12; // a lighter fleck
  return scale(PALETTE.stone, m);
};

const granite: Painter = (x, y) => {
  /* Calmer than the first pass. Close to the camera a texel of this is ten
     pixels across, and specks at two-thirds and one-and-a-half times the
     base read as orange gravel filling a third of the frame. Kept within a
     fifth either way it still reads as speckled stone, and stays behind the
     things in front of it. */
  const n = hash(x, y, 51);
  const clump = hash(x >> 1, y >> 1, 52);
  if (n < 0.07) return scale(PALETTE.rock, 0.8);
  if (n > 0.93) return mixC(PALETTE.rock, [0.56, 0.39, 0.33], 0.55); // feldspar
  return scale(PALETTE.rock, 0.93 + clump * 0.12 + (n - 0.5) * 0.06);
};

const deepslate: Painter = (x, y) => {
  // Layered: every row has its own tone, with dark dashes running along it.
  const row = 0.93 + hash(0, y, 61) * 0.14;
  const n = hash(x, y, 62);
  let m = row + (n - 0.5) * 0.06;
  if (hash(x >> 2, y, 63) < 0.09) m *= 0.8;
  if (n > 0.975) m *= 1.18;
  return scale(PALETTE.deep, m);
};

/* Bark: one tone per column, written out rather than hashed, because the
   rhythm of ridges and grooves is the whole texture and noise never lands on
   a good one. */
const BARK = [1.06, 0.93, 0.72, 1.1, 1.0, 0.8, 1.08, 0.94, 0.74, 1.04, 0.99, 0.82, 1.09, 0.9, 0.75, 1.02];
const logSide: Painter = (x, y) => {
  let m = BARK[x] * (0.94 + hash(x, y >> 2, 71) * 0.12);
  if (hash(x, y, 72) < 0.035) m *= 0.68; // a knot
  return scale(PALETTE.wood, m);
};

const logTop: Painter = (x, y) => {
  const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (r > 6.9) return scale(PALETTE.wood, 0.72); // the bark rim
  const ring = Math.floor(r);
  const m = r < 1 ? 0.82 : ring % 2 === 0 ? 1.06 : 0.9;
  return scale([0.66, 0.5, 0.31], m * (0.97 + hash(x, y, 73) * 0.06));
};

const leaves: Painter = (x, y) => {
  const clump = hash(x >> 1, y >> 1, 81);
  const n = hash(x, y, 82);
  if (n < 0.1) return scale(PALETTE.leaf, 0.62); // a gap into the crown
  let m = 0.9 + clump * 0.2;
  if (n > 0.92) m *= 1.1;
  return scale(PALETTE.leaf, m);
};

const planks: Painter = (x, y) => {
  // Four boards, each with its own tone, a dark seam under it, and an end
  // joint at a different place on each so the courses are staggered.
  const board = y >> 2;
  const yy = y & 3;
  let m = (0.93 + hash(board, 0, 91) * 0.14) * (0.96 + hash(x, y, 92) * 0.08);
  if (yy === 3) m *= 0.7;
  const joint = Math.floor(hash(board, 1, 93) * 16);
  if (x === joint) m *= 0.72;
  if ((x === (joint + 15) % 16 || x === (joint + 1) % 16) && yy === 1) m *= 0.62; // nails
  if (hash(x >> 2, y, 94) < 0.1) m *= 0.9; // grain
  return scale(PALETTE.planks, m);
};

/* Ore: stone, with nuggets set into it. Each nugget is lit from the top left
   -- highlight, body, shadow -- because a flat coloured blob reads as paint
   on the rock rather than metal in it. */
const NUGGETS: Array<[number, number]> = [
  [2, 3],
  [9, 2],
  [5, 9],
  [12, 8],
  [8, 13],
];
function ore(color: RGB, glow = 1): Painter {
  return (x, y) => {
    for (const [nx, ny] of NUGGETS) {
      const dx = x - nx;
      const dy = y - ny;
      if (dx < 0 || dy < 0 || dx > 2 || dy > 1) continue;
      if (dx === 2 && dy === 1) continue; // rounded off
      if (dx === 0 && dy === 0) return [...mixC(color, [1, 1, 1], 0.32), glow] as RGBE;
      if (dy === 1 || dx === 2) return [...scale(color, 0.68), 0.35 * glow] as RGBE;
      return [...color, 0.75 * glow] as RGBE;
    }
    return stone(x, y);
  };
}

/* Lava: a bright molten body under a broken dark crust, the crust in slabs
   that drift as the tile scrolls. Alpha is emission, and nearly all of it
   gives off light -- the crust least. */
const lava: Painter = (x, y) => {
  const crust = hash(x >> 2, y >> 2, 261) < 0.3 && hash(x, y, 262) < 0.8;
  if (crust) return [0.28, 0.1, 0.06, 0.25];
  const hot = hash(x >> 1, y >> 1, 263);
  const c: RGB = hot > 0.7 ? [1, 0.82, 0.3] : hot > 0.35 ? [1, 0.55, 0.12] : [0.9, 0.3, 0.06];
  return [...c, 0.75 + hot * 0.25];
};

const crystal: Painter = (x, y) => {
  /* Facets: diagonal bands at four tones, cut across by a second diagonal so
     the bands break into lozenges, with a bright edge where two meet. */
  const band = ((x + y) >> 2) & 3;
  let m = [0.74, 0.98, 1.22, 0.88][band];
  if ((x + y) % 4 === 0) m = 1.38;
  if ((x - y + 16) % 6 === 0) m *= 0.82;
  const c = scale(PALETTE.crystal, m);
  /* Every facet gives off light, the edges most. The tone curve is what keeps
     the brightest of them from going flat white now, not the paint: the
     sparkles can be as bright as they need to be and roll off into cyan. */
  const glow = Math.min(1, Math.max(0.2, (m - 0.62) / 0.76));
  return hash(x, y, 121) > 0.975 ? [0.62, 0.9, 0.96, 1] : [...c, glow];
};

const iron: Painter = (x, y) => {
  let m = 0.95 + hash(x, y >> 1, 111) * 0.1;
  if (x === 0 || y === 0) m = 1.16;
  if (x === 15 || y === 15) m = 0.7;
  for (const [rx, ry] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ]) {
    if (x === rx && y === ry) m = 1.32;
    if (x === rx + 1 && y === ry + 1) m = 0.66;
  }
  return scale(PALETTE.iron, m);
};

const crate: Painter = (x, y) => {
  const edge = Math.min(x, y, 15 - x, 15 - y);
  if (edge === 0) return scale(PALETTE.wood, 0.62);
  if (edge === 1) return scale(PALETTE.wood, 0.86 + hash(x, y, 141) * 0.08);
  // A diagonal brace across the middle.
  if (Math.abs(x - y) <= 1) return scale(PALETTE.wood, 0.92);
  return planks(x, y);
};

const water: Painter = (x, y) => {
  const wave = (y + Math.round(Math.sin(x * 0.8) * 1.5) + 16) % 5 === 0;
  return scale(PALETTE.water, wave ? 1.2 : 0.95 + hash(x, y, 151) * 0.08);
};

const fall: Painter = (x, y) => {
  let m = 0.9 + hash(x, y >> 2, 161) * 0.2;
  if (hash(x, 0, 162) < 0.25) m *= 1.16; // brighter lanes in the sheet
  return scale(PALETTE.water, m);
};

const BEVELLED = new Set<number>([
  T.stone,
  T.granite,
  T.deepslate,
  T.oreCopper,
  T.oreGold,
  T.oreCoal,
  T.oreIron,
  T.oreRed,
  T.oreGreen,
]);

const gravel: Painter = (x, y) => {
  /* Pebbles: two-by-two stones in three greys with a dark gap round each,
     the way a path looks from standing height. */
  const cell = hash(x >> 1, y >> 1, 171);
  const tone = cell < 0.33 ? 0.82 : cell < 0.7 ? 1.0 : 1.16;
  const gap = (x & 1) + (y & 1) === 2 && hash(x, y, 172) < 0.5;
  return scale(PALETTE.gravel, gap ? 0.66 : tone * (0.95 + hash(x, y, 173) * 0.1));
};

/* Birch: pale bark with dark dashes running across the trunk, which is the
   one thing that makes a birch a birch at any distance. */
const birchSide: Painter = (x, y) => {
  const dash = hash(x >> 2, y, 181) < 0.16 && hash(x, y >> 1, 182) < 0.7;
  if (dash) return scale(PALETTE.birch, 0.32);
  return scale(PALETTE.birch, 0.94 + hash(x, y, 183) * 0.1);
};
const birchTop: Painter = (x, y) => {
  const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (r > 6.9) return scale(PALETTE.birch, 0.9);
  return scale([0.78, 0.68, 0.5], (Math.floor(r) % 2 === 0 ? 1.04 : 0.92) * (0.97 + hash(x, y, 184) * 0.06));
};
const birchLeaves: Painter = (x, y) => {
  const clump = hash(x >> 1, y >> 1, 191);
  const n = hash(x, y, 192);
  if (n < 0.1) return scale(PALETTE.birchLeaf, 0.6);
  let m = 0.9 + clump * 0.22;
  if (n > 0.9) m *= 1.12;
  return scale(PALETTE.birchLeaf, m);
};

/* --- plants: cut-out cards ---------------------------------------------------
   Alpha is coverage. A clear texel still carries the plant's colour, not
   black: the mip chain averages colour and coverage together, and a black
   surround would rim every distant tuft in a dark halo. */
const clear = (c: RGB): RGBE => [c[0], c[1], c[2], 0];
const grassBlade: RGB = [0.36, 0.56, 0.24];

const tuft: Painter = (x, y) => {
  // Blades rising from the bottom row, each column its own height.
  const h = 5 + Math.floor(hash(x, 0, 201) * 10);
  const lean = hash(x, 1, 202) < 0.5 ? 0 : 1;
  const xx = x - (y < 8 ? lean : 0);
  const show = hash(xx, 2, 203) < 0.62 && 15 - y < h;
  return show ? [...scale(grassBlade, 0.78 + (15 - y) / 30 + hash(x, y, 204) * 0.08), 1] : clear(grassBlade);
};

const fern: Painter = (x, y) => {
  // A stem up the middle with fronds angled up and out from it.
  const c: RGB = [0.24, 0.48, 0.22];
  if (y > 3 && (x === 7 || x === 8)) return [...scale(c, 0.8), 1];
  const d = Math.abs(x - 7.5);
  const frond = y > 2 && (15 - y + Math.round(d * 0.7)) % 3 === 0 && d < 1 + (16 - y) * 0.45;
  return frond ? [...scale(c, 0.9 + hash(x, y, 211) * 0.2), 1] : clear(c);
};

function flower(head: RGB): Painter {
  return (x, y) => {
    const stem: RGB = [0.3, 0.52, 0.22];
    // A head of petals round a centre, on a stem with one leaf.
    const dx = x - 7.5;
    const dy = y - 5.5;
    const r = Math.hypot(dx, dy);
    if (r < 1.2) return [0.95, 0.82, 0.3, 1];
    if (r < 3.1 && !(Math.abs(dx) > 2.2 && Math.abs(dy) > 2.2)) return [...scale(head, 0.88 + hash(x, y, 221) * 0.2), 1];
    if ((x === 7 || x === 8) && y > 7) return [...stem, 1];
    if (y === 11 && x >= 9 && x <= 11) return [...scale(stem, 1.1), 1];
    return clear(stem);
  };
}

const vine: Painter = (x, y) => {
  /* Strands down the card, wandering a texel either way, with leaves off
     them. Seamless top to bottom: a vine is this tile repeated down a cliff. */
  const c: RGB = [0.22, 0.42, 0.18];
  for (const s0 of [2, 7, 12]) {
    const sx = s0 + Math.round(Math.sin((y + s0 * 3) * 0.785) * 1.2);
    if (x === sx) return [...scale(c, 0.85), 1];
    if (Math.abs(x - sx) === 1 && hash(x, y, 231 + s0) < 0.55) return [...scale(c, 0.95 + hash(x, y, 232) * 0.25), 1];
  }
  return clear(c);
};

const root: Painter = (x, y) => {
  // Thin tangled roots, also seamless top to bottom.
  const c: RGB = [0.38, 0.27, 0.17];
  for (const s0 of [3, 8, 12]) {
    const sx = s0 + Math.round(Math.sin((y * 0.39 + s0) * 1.7) * 1.4);
    if (x === sx) return [...scale(c, 0.85 + hash(x, y, 241) * 0.2), 1];
  }
  return clear(c);
};

/* The board over the portal: the name in a three-by-five pixel letter, light
   on dark planks, across four tiles. Pixel lettering is not a font file: the
   glyphs are written out here, one row of three bits per line. */
const GLYPHS: Record<string, number[]> = {
  S: [7, 4, 7, 1, 7],
  O: [7, 5, 5, 5, 7],
  L: [4, 4, 4, 4, 7],
  U: [5, 5, 5, 5, 7],
  T: [7, 2, 2, 2, 2],
  I: [7, 2, 2, 2, 7],
  N: [6, 5, 5, 5, 5],
  M: [5, 7, 7, 5, 5],
  E: [7, 4, 6, 4, 7],
  " ": [0, 0, 0, 0, 0],
};
const SIGN_TEXT = "SOLUTION MINES";
const signTile = (k: number): Painter => (x, y) => {
  const gx = k * 16 + x;
  const base = scale(PALETTE.planks, 0.5 + hash(gx, y >> 2, 251) * 0.08);
  if (y === 0 || y === 15) return scale(PALETTE.planks, 0.34);
  // Fourteen glyphs of four columns each is fifty-six; centred on sixty-four.
  const col = gx - 4;
  const ch = Math.floor(col / 4);
  const cx = col % 4;
  const row = y - 5;
  if (col < 0 || ch >= SIGN_TEXT.length || cx === 3 || row < 0 || row > 4) return base;
  const bits = GLYPHS[SIGN_TEXT[ch]] ?? GLYPHS[" "];
  return (bits[row] >> (2 - cx)) & 1 ? [0.93, 0.86, 0.66] : base;
};

/* The ten stages of a block giving way, as the game this is built on draws
   them: fractures out from where the blows land, each stage everything the
   one before had and more. Worked out once as the stage at which each texel
   splits, then drawn ten times. */
const CRACK_AT: Uint8Array = (() => {
  const at = new Uint8Array(TILE * TILE).fill(255);
  const mark = (x: number, y: number, s: number) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = y * TILE + x;
    if (s < at[i]) at[i] = s;
  };
  // The bruise where the pick lands.
  for (const [x, y] of [[7, 7], [8, 8], [7, 8], [8, 7]]) mark(x, y, 0);
  // Seven fractures out from it: three at once, the rest as the stone gives.
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + hash(b, 0, 301) * 0.6;
    const start = b < 3 ? 0 : b < 5 ? 2 : 4;
    let x = 7.5;
    let y = 7.5;
    for (let step = 0; step < 11; step++) {
      const j = (hash(b, step, 302) - 0.5) * 0.9;
      x += Math.cos(a + j);
      y += Math.sin(a + j);
      const s = Math.min(9, start + Math.floor(step * 0.75));
      mark(Math.round(x), Math.round(y), s);
      // Now and then a short branch off it, a stage behind.
      if (step > 2 && hash(b, step, 303) < 0.22) {
        const ba = a + (hash(b, step, 304) < 0.5 ? 1 : -1) * 0.9;
        let bx = x;
        let by = y;
        for (let k = 0; k < 3; k++) {
          bx += Math.cos(ba);
          by += Math.sin(ba);
          mark(Math.round(bx), Math.round(by), Math.min(9, s + 1 + k));
        }
      }
    }
  }
  return at;
})();
const crackStage = (k: number): Painter => (x, y) =>
  CRACK_AT[y * TILE + x] <= k ? [0.05, 0.04, 0.04, 1] : [0, 0, 0, 0];

/* --- items -----------------------------------------------------------------
   Five things drawn the way the game this is built on draws what you carry:
   a flat sixteen-pixel picture with a dark outline, lit from the top left.
   They never appear in the world -- the page's hotbar is made from them --
   but they are painted here so the whole site's pixel art comes from one
   place, at one density, in one palette. Each is a picture as rows of
   letters, one letter a colour, so it can be read and corrected by eye. */
function pixelItem(rows: string[], ink: Record<string, RGB>): Painter {
  return (x, y) => {
    const c = rows[y]?.[x] ?? ".";
    const rgb = ink[c];
    return rgb ? [...rgb, 1] : [0, 0, 0, 0];
  };
}
const OUTLINE: RGB = [0.1, 0.09, 0.1];
const itemMap = pixelItem(
  [
    "................",
    "..oooooooooooo..",
    "..oppppppppppo..",
    "..opggppwwwppo..",
    "..opgggpwwwwpo..",
    "..oppggppwwppo..",
    "..opppgpppwwpo..",
    "..opgppprpwppo..",
    "..opggprrrpppo..",
    "..opgggprpggpo..",
    "..oppggppgggpo..",
    "..oppwwppggppo..",
    "..opwwwpppgppo..",
    "..oppppppppppo..",
    "..oooooooooooo..",
    "................",
  ],
  { o: [0.32, 0.22, 0.12], p: [0.86, 0.77, 0.56], g: [0.42, 0.6, 0.3], w: [0.3, 0.52, 0.76], r: [0.82, 0.18, 0.14] },
);
const itemPick = pixelItem(
  [
    "................",
    "....oooooo......",
    "...oiiiiiioo....",
    "..oiIIIIIiiio...",
    "...oooooo2iio...",
    ".........ow2io..",
    "........owo2io..",
    ".......owo.oio..",
    "......owo..oio..",
    ".....owo....oo..",
    "....owo.........",
    "...owo..........",
    "..owo...........",
    ".owo............",
    ".oo.............",
    "................",
  ],
  { o: OUTLINE, i: [0.66, 0.69, 0.74], I: [0.86, 0.88, 0.92], "2": [0.44, 0.46, 0.52], w: [0.52, 0.36, 0.2] },
);
const itemIngot = pixelItem(
  [
    "................",
    "................",
    "................",
    "................",
    ".....oooooooo...",
    "....oHHHHHHHyo..",
    "...oHhhhhhhhyo..",
    "..oyyyyyyyyyyo..",
    "..oYYYYYYYYYdo..",
    "..oYYYYYYYYYdo..",
    "..odddddddddoo..",
    "..ooooooooooo...",
    "................",
    "................",
    "................",
    "................",
  ],
  { o: [0.32, 0.22, 0.04], H: [1.0, 0.95, 0.7], h: [1.0, 0.86, 0.42], y: [0.96, 0.76, 0.24], Y: [0.88, 0.66, 0.16], d: [0.62, 0.42, 0.08] },
);
const itemCart = pixelItem(
  [
    "................",
    "................",
    "................",
    "................",
    "................",
    ".oooooooooooooo.",
    ".oIIIIIIIIIIIio.",
    ".oikkkkkkkkkkio.",
    ".oikkkkkkkkkkio.",
    ".oiiiiiiiiiiiio.",
    ".oIiiiiiiiiiiio.",
    "..oooooooooooo..",
    "..obbo....obbo..",
    "..obbo....obbo..",
    "...oo......oo...",
    "................",
  ],
  { o: OUTLINE, I: [0.78, 0.8, 0.84], i: [0.55, 0.58, 0.63], k: [0.2, 0.21, 0.24], b: [0.3, 0.3, 0.33] },
);
const itemBeacon = pixelItem(
  [
    "......oBBo......",
    "......oBBo......",
    "......oBBo......",
    ".....ooBBoo.....",
    "....oggggggo....",
    "...oggcCCcggo...",
    "...ogcCWWCcgo...",
    "...ogcCWWCcgo...",
    "...oggcCCcggo...",
    "...oggggggggo...",
    "..oddddddddddo..",
    "..odDDDDDDDDdo..",
    "..odDDDDDDDDdo..",
    "..oddddddddddo..",
    "...oooooooooo...",
    "................",
  ],
  { o: OUTLINE, B: [0.62, 0.95, 1.0], g: [0.72, 0.86, 0.9], c: [0.24, 0.66, 0.78], C: [0.42, 0.86, 0.96], W: [0.92, 1.0, 1.0], d: [0.18, 0.15, 0.24], D: [0.26, 0.22, 0.34] },
);

const PAINTERS: Array<[number, Painter]> = [
  [T.grassTop, grassTop],
  [T.grassSide, grassSide],
  [T.dirt, dirt],
  [T.stone, stone],
  [T.granite, granite],
  [T.deepslate, deepslate],
  [T.logSide, logSide],
  [T.logTop, logTop],
  [T.leaves, leaves],
  [T.planks, planks],
  [T.oreCopper, ore(PALETTE.copper)],
  [T.oreGold, ore(PALETTE.gold)],
  [T.crystal, crystal],
  [T.iron, iron],
  [T.crate, crate],
  [T.water, water],
  [T.fall, fall],
  [T.gravel, gravel],
  [T.birchSide, birchSide],
  [T.birchTop, birchTop],
  [T.birchLeaves, birchLeaves],
  [T.tuft, tuft],
  [T.fern, fern],
  [T.flowerRed, flower([0.86, 0.2, 0.18])],
  [T.flowerYellow, flower([0.96, 0.8, 0.22])],
  [T.flowerBlue, flower([0.36, 0.5, 0.92])],
  [T.vine, vine],
  [T.root, root],
  [T.sign, signTile(0)],
  [T.sign + 1, signTile(1)],
  [T.sign + 2, signTile(2)],
  [T.sign + 3, signTile(3)],
  // Coal and iron are dull; the red ore and the green glow a little.
  [T.oreCoal, ore([0.13, 0.12, 0.12], 0)],
  [T.oreIron, ore([0.78, 0.62, 0.5], 0.15)],
  [T.oreRed, ore([0.86, 0.16, 0.12], 1)],
  [T.oreGreen, ore([0.24, 0.78, 0.42], 0.9)],
  [T.lava, lava],
  ...Array.from({ length: 10 }, (_, k): [number, Painter] => [T.crack + k, crackStage(k)]),
  [T.itemMap, itemMap],
  [T.itemPick, itemPick],
  [T.itemIngot, itemIngot],
  [T.itemCart, itemCart],
  [T.itemBeacon, itemBeacon],
];

/* --- skins ------------------------------------------------------------------
   Each box is filled with its base colour first, then the few pixels that
   make it a person are placed: hairline, brows, eyes, nose, mouth, vest
   panels and reflective band, belt and buckle, cuffs, gloves, boots.

   Pixel orientation inside each face matches the shader's fold: column 0 of
   the front face is the figure's RIGHT side, as a viewer facing him sees it;
   on the right side face column 0 is the front edge; row 0 is always the
   top. */
type Face = "top" | "bottom" | "right" | "front" | "left" | "back";

function faceRect(net: readonly number[], f: Face) {
  const [u, v, w, h, d] = net;
  switch (f) {
    case "top":
      return { x: u + d, y: v, w, h: d };
    case "bottom":
      return { x: u + d + w, y: v, w, h: d };
    case "right":
      return { x: u, y: v + d, w: d, h };
    case "front":
      return { x: u + d, y: v + d, w, h };
    case "left":
      return { x: u + d + w, y: v + d, w: d, h };
    case "back":
      return { x: u + 2 * d + w, y: v + d, w, h };
  }
}

const FACES: Face[] = ["top", "bottom", "right", "front", "left", "back"];

function paintSkin(set: (x: number, y: number, c: RGB | RGBE) => void, ox: number, oy: number, look: Look) {
  const put = (net: readonly number[], f: Face, fn: (x: number, y: number, w: number, h: number) => RGB | RGBE | null) => {
    const r = faceRect(net, f);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const c = fn(x, y, r.w, r.h);
        if (c) set(ox + r.x + x, oy + r.y + y, c);
      }
    }
  };
  const fill = (net: readonly number[], c: RGB | ((x: number, y: number) => RGB)) => {
    for (const f of FACES) put(net, f, (x, y) => (typeof c === "function" ? c(x, y) : c));
  };
  // A little fabric noise so no panel is one flat colour.
  const cloth = (c: RGB, salt: number) => (x: number, y: number) => scale(c, 0.93 + hash(x, y, salt) * 0.1);

  const { skin, hair, shirt, trousers, boots, eyes } = look;
  const vest = PALETTE.hivis;
  const band: RGB = [0.86, 0.88, 0.9];
  const gloves: RGB = [0.24, 0.23, 0.22];
  const belt: RGB = [0.24, 0.16, 0.1];
  const lips: RGB = mixC(skin, [0.48, 0.2, 0.18], 0.45);

  /* HEAD, sixteen texels a side. The hat's brim covers the top row or two,
     so the face is laid out below it -- see FACE. */
  const shade = scale(skin, 0.82);
  const cheek = mixC(skin, [0.86, 0.42, 0.38], 0.22);
  const brow = scale(hair, 0.85);
  const mouth: RGB = mixC(skin, [0.3, 0.1, 0.09], 0.62);
  fill(NET.head, skin);
  put(NET.head, "top", () => hair);
  put(NET.head, "bottom", () => shade);
  put(NET.head, "back", (x, y) => (y < 11 || (y === 11 && x % 3 !== 1) ? hair : y === 15 ? shade : skin));
  /* The sides: hair over the back half, an ear in the middle, sideburns,
     and the beard carried round the jaw. Column 0 of the right side is the
     front edge and of the left side the back, so the left is the right
     read backwards. */
  const side = (f: number, y: number): RGB | RGBE => {
    if (y < 4) return hair;
    if (f >= 9 && y <= 10) return hair;
    if (f === 8 && y <= 8) return hair;
    if (f >= 5 && f <= 7 && y >= 6 && y <= 9) return f === 6 && (y === 7 || y === 8) ? scale(skin, 0.7) : shade;
    if (look.beard && y >= 10 && f <= 8) return hair;
    return y === 15 ? shade : skin;
  };
  put(NET.head, "right", (x, y) => side(x, y));
  put(NET.head, "left", (x, y, w) => side(w - 1 - x, y));
  put(NET.head, "front", (x, y) => {
    const ch = FACE[y][x];
    // A beard covers the jaw and chin, round the mouth.
    if (look.beard && y >= 11 && ch !== "m" && ch !== "t") return hair;
    switch (ch) {
      case "h": return hair;
      case "d": return shade;
      case "c": return cheek;
      case "b": return brow;
      case "w": return [0.93, 0.93, 0.9];
      // A catch of light in each eye. A little of it is its own light, so in
      // a dark drift the eyes still have life in them.
      case "g": return [1, 1, 1, 0.35];
      case "i": return eyes;
      case "k": return [0.05, 0.045, 0.045];
      case "m": return mouth;
      case "t": return lips;
      default: return skin;
    }
  });

  /* BODY. An open vest over the shirt: orange panels either side of a strip
     of shirt, one reflective band, a belt with a buckle. */
  fill(NET.body, cloth(shirt, 201));
  put(NET.body, "top", () => vest);
  put(NET.body, "bottom", () => trousers);
  put(NET.body, "front", (x, y) => {
    if (y >= 10) return y === 10 && (x === 3 || x === 4) ? [0.86, 0.72, 0.32] : belt;
    if (y === 9) return scale(vest, 0.86);
    if (x === 3 || x === 4) return cloth(shirt, 202)(x, y);
    if (y === 5) return band;
    return cloth(vest, 203)(x, y);
  });
  put(NET.body, "back", (x, y) => {
    if (y >= 10) return belt;
    if (y === 5 || y === 2) return band;
    return cloth(vest, 204)(x, y);
  });
  for (const side of ["right", "left"] as const) {
    put(NET.body, side, (x, y) => (y >= 10 ? belt : y === 5 ? band : cloth(vest, 205)(x, y)));
  }

  /* ARMS. Sleeves, a darker cuff, work gloves. */
  for (const arm of [NET.armR, NET.armL]) {
    fill(arm, (x, y) => (y >= 9 ? gloves : y === 8 ? scale(shirt, 0.74) : cloth(shirt, 211)(x, y)));
    put(arm, "top", () => shirt);
    put(arm, "bottom", () => gloves);
  }

  /* LEGS. Trousers with a worn knee, boots with a lighter toe cap. */
  for (const leg of [NET.legR, NET.legL]) {
    fill(leg, (x, y) => (y >= 9 ? boots : y === 5 ? scale(trousers, 0.88) : cloth(trousers, 221)(x, y)));
    put(leg, "front", (x, y) => (y >= 9 ? (y === 10 ? scale(boots, 1.5) : boots) : y === 5 ? scale(trousers, 0.88) : cloth(trousers, 222)(x, y)));
    put(leg, "top", () => trousers);
    put(leg, "bottom", () => [0.1, 0.08, 0.07]);
  }
}

/* --- assembly ---------------------------------------------------------------*/

/** One block tile alone, as sRGB bytes with full alpha, darkened by `shade`:
    for a picture needed before the atlas exists. */
export function paintTile(slot: number, shade = 1): Uint8ClampedArray {
  const paint = PAINTERS.find(([s]) => s === slot)?.[1];
  const out = new Uint8ClampedArray(TILE * TILE * 4);
  if (!paint) return out;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const c = paint(x, y);
      const i = (y * TILE + x) * 4;
      for (let k = 0; k < 3; k++) {
        out[i + k] = Math.round(toSrgb(toLin(Math.min(1, Math.max(0, c[k]))) * shade) * 255);
      }
      out[i + 3] = 255;
    }
  }
  return out;
}

export type Atlas = {
  width: number;
  height: number;
  /** RGB sRGB-encoded with emission in A, one array per mip level, level 0
      first. */
  levels: Uint8Array[];
};

export function buildAtlas(): Atlas {
  const W = ATLAS_W;
  const H = ATLAS_H;
  // Painted in linear float so the mip chain can be averaged correctly.
  const lin = new Float32Array(W * H * 4);
  const set = (x: number, y: number, c: RGB | RGBE) => {
    const i = (y * W + x) * 4;
    lin[i] = toLin(Math.min(1, Math.max(0, c[0])));
    lin[i + 1] = toLin(Math.min(1, Math.max(0, c[1])));
    lin[i + 2] = toLin(Math.min(1, Math.max(0, c[2])));
    lin[i + 3] = Math.min(1, Math.max(0, c[3] ?? 0));
  };

  for (const [slot, paint] of PAINTERS) {
    const ox = (slot % 16) * TILE;
    const oy = Math.floor(slot / 16) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) set(ox + x, oy + y, paint(x, y));
    }
    /* A one-texel bevel on the cut stone: lit along the top and left, in
       shade along the bottom and right. Enough to read each block as a block
       inside a wall of them when the light is flat, and too small to see
       once it is not. */
    if (BEVELLED.has(slot)) {
      for (let k = 0; k < TILE; k++) {
        for (const [x, y, f] of [
          [k, 0, 1.12],
          [0, k, 1.06],
          [k, TILE - 1, 0.8],
          [TILE - 1, k, 0.88],
        ]) {
          const i = ((oy + y) * W + ox + x) * 4;
          lin[i] *= f;
          lin[i + 1] *= f;
          lin[i + 2] *= f;
        }
      }
    }
  }
  LOOKS.forEach((look, i) => {
    const [ox, oy] = skinOrigin(i);
    paintSkin(set, ox, oy, look);
  });

  /* The mip chain, each level the 2x2 average of the one above in linear
     light. Averaging the encoded bytes instead -- which is what the GPU's own
     generateMipmap does on an RGBA8 texture -- darkens every texture as it
     recedes, by as much as a fifth on high-contrast tiles. */
  const levels: Uint8Array[] = [];
  let cur = lin;
  let cw = W;
  let ch = H;
  for (let level = 0; level < ATLAS_LEVELS; level++) {
    const bytes = new Uint8Array(cw * ch * 4);
    for (let i = 0, j = 0; i < cw * ch; i++, j += 4) {
      bytes[i * 4] = Math.round(toSrgb(cur[j]) * 255);
      bytes[i * 4 + 1] = Math.round(toSrgb(cur[j + 1]) * 255);
      bytes[i * 4 + 2] = Math.round(toSrgb(cur[j + 2]) * 255);
      // Emission is a plain fraction, not a colour: stored as is.
      bytes[i * 4 + 3] = Math.round(cur[j + 3] * 255);
    }
    levels.push(bytes);
    if (level === ATLAS_LEVELS - 1) break;
    const nw = cw >> 1;
    const nh = ch >> 1;
    const next = new Float32Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        for (let c = 0; c < 4; c++) {
          const a = cur[((y * 2) * cw + x * 2) * 4 + c];
          const b = cur[((y * 2) * cw + x * 2 + 1) * 4 + c];
          const d = cur[((y * 2 + 1) * cw + x * 2) * 4 + c];
          const e = cur[((y * 2 + 1) * cw + x * 2 + 1) * 4 + c];
          next[(y * nw + x) * 4 + c] = (a + b + d + e) / 4;
        }
      }
    }
    cur = next;
    cw = nw;
    ch = nh;
  }

  return { width: W, height: H, levels };
}
