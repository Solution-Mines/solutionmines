import { buildAtlas, paintTile, T, ATLAS_W, TILE, type Atlas } from "./atlas";

/* ----------------------------------------------------------------------------
   THE PAGE'S PIXEL ART

   The hotbar's eight icons, cut from the same atlas the world is painted
   from, so the page and the island are one set of pictures rather than a 3D
   scene with a different illustrator's buttons laid over it.

   Blocks are drawn the way the game this is built on draws them in an
   inventory: a small cube seen from above at an angle, its top face in full
   light and its two sides in shade. Items are their flat picture, doubled.
   Everything is drawn into a canvas once, without smoothing, and handed to
   the page as images -- nothing here runs per frame.

   Browser only: it needs a canvas.
-------------------------------------------------------------------------------*/

export type IconSet = {
  /** One per act, in order: the hotbar's slots. */
  acts: string[];
  /** A dark tile of earth for the loading screen's ground. */
  dirt: string;
};

let cached: IconSet | null = null;

/** A tile's level-0 texels as a 16x16 canvas, with alpha either kept (items,
    whose alpha is coverage) or forced opaque (blocks, whose alpha is the
    light they give off). */
function tileCanvas(atlas: Atlas, slot: number, opaque: boolean, shade = 1) {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(TILE, TILE);
  const src = atlas.levels[0];
  const ox = (slot % 16) * TILE;
  const oy = Math.floor(slot / 16) * TILE;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = ((oy + y) * ATLAS_W + ox + x) * 4;
      const o = (y * TILE + x) * 4;
      img.data[o] = src[i] * shade;
      img.data[o + 1] = src[i + 1] * shade;
      img.data[o + 2] = src[i + 2] * shade;
      img.data[o + 3] = opaque ? 255 : src[i + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** An inventory cube: top face as a diamond, two sides falling away from it,
    on a 32x32 canvas. */
function blockIcon(atlas: Atlas, top: number, side: number) {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  // Top: (u, v) -> (16 + u - v, (u + v) / 2).
  ctx.setTransform(1, 0.5, -1, 0.5, 16, 0);
  ctx.drawImage(tileCanvas(atlas, top, true), 0, 0);
  // Left side, in some shade: (u, v) -> (u, 8 + u / 2 + v).
  ctx.setTransform(1, 0.5, 0, 1, 0, 8);
  ctx.drawImage(tileCanvas(atlas, side, true, 0.78), 0, 0);
  // Right side, in more: (u, v) -> (16 + u, 16 - u / 2 + v).
  ctx.setTransform(1, -0.5, 0, 1, 16, 16);
  ctx.drawImage(tileCanvas(atlas, side, true, 0.6), 0, 0);
  return c.toDataURL("image/png");
}

/** A flat item picture, doubled to 32x32. */
function itemIcon(atlas: Atlas, slot: number) {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tileCanvas(atlas, slot, false), 0, 0, 32, 32);
  return c.toDataURL("image/png");
}

/** The loading screen's ground: one tile, painted on its own. It is needed
    before the world -- and the atlas that comes with it -- exists. */
export function dirtTile(): string {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(TILE, TILE);
  img.data.set(paintTile(T.dirt, 0.42));
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

/** The hotbar's icons, from the atlas the world was built with -- painted in
    the worker and handed over with the world -- or painted here if there is
    none. */
export function buildIcons(given?: Atlas | null): IconSet {
  if (cached) return cached;
  const atlas = given ?? buildAtlas();
  cached = {
    /* In the order of the acts: the island, the brief, the way in, the
       face, the find, what the forge makes, the ride out, the signal. */
    acts: [
      blockIcon(atlas, T.grassTop, T.grassSide),
      itemIcon(atlas, T.itemMap),
      itemIcon(atlas, T.itemPick),
      blockIcon(atlas, T.oreGold, T.oreGold),
      blockIcon(atlas, T.crystal, T.crystal),
      itemIcon(atlas, T.itemIngot),
      itemIcon(atlas, T.itemCart),
      itemIcon(atlas, T.itemBeacon),
    ],
    dirt: tileCanvas(atlas, T.dirt, true, 0.42).toDataURL("image/png"),
  };
  return cached;
}
