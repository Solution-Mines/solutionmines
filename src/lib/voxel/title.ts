import { T as TILES, PALETTE } from "./atlas";
import { BONE, type Part } from "./crew";

/* ----------------------------------------------------------------------------
   THE TITLE

   SOLUTION MINES in blocks, floating over the island in the opening shot, in
   the spirit of a game's title screen: stone letters with an orange edge
   behind them. Decoration only -- the page's real heading is in the DOM,
   where it can be read, searched and translated.

   A five-by-seven block letter, written out here one row of five per line.
   Not a font file and not anyone's lettering: nine capitals, drawn for this.
-------------------------------------------------------------------------------*/

const GLYPHS: Record<string, string[]> = {
  S: [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
};

const LINES = ["SOLUTION", "MINES"];
/** World units per letter pixel. */
const PIXEL = 1;
const GAP = 2;

/** The title's boxes, in its own frame: reading along +x, up +y, facing +z,
    centred on its middle. */
export function titleParts(): Part[] {
  const out: Part[] = [];
  const rows = 7;
  const height = LINES.length * rows + (LINES.length - 1) * GAP;
  LINES.forEach((line, li) => {
    const width = line.length * 6 - 1;
    const top = height / 2 - li * (rows + GAP);
    [...line].forEach((ch, ci) => {
      const glyph = GLYPHS[ch];
      if (!glyph) return;
      glyph.forEach((row, ry) => {
        [...row].forEach((bit, rx) => {
          if (bit !== "#") return;
          const x = (ci * 6 + rx - width / 2 + 0.5) * PIXEL;
          const y = (top - ry - 0.5) * PIXEL;
          // The stone face...
          out.push({
            bone: BONE.root,
            at: [x, y, 0],
            size: [PIXEL, PIXEL, PIXEL * 1.2],
            pivot: [0, 0, 0],
            /* The dark stone: pale stone against a pale sky had no edge at
               all, and the letters washed into the haze. */
            color: PALETTE.deep,
            ao: 0.95,
            tex: 2,
            u: TILES.deepslate,
          });
          /* ...and the orange edge behind it, down and to the right, lit a
             little from within. Pale stone on a pale sky disappears; the edge
             is what draws the letters, the way the outline does on a game's
             title screen. */
          out.push({
            bone: BONE.root,
            at: [x + PIXEL * 0.3, y - PIXEL * 0.3, -PIXEL * 0.6],
            size: [PIXEL, PIXEL, PIXEL],
            pivot: [0, 0, 0],
            color: PALETTE.hivis,
            ao: 0.9,
            emit: 0.22,
          });
        });
      });
    });
  });
  return out;
}
