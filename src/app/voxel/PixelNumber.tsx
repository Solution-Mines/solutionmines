/* ----------------------------------------------------------------------------
   PIXEL DIGITS

   The hotbar's slot numbers, the level over the XP bar and the count on a
   stack, in a three-by-five bitmap written out here rather than a font file:
   pixel lettering is a handful of rectangles, and a font dependency for ten
   digits would be the wrong trade. Each digit gets the hard, one-pixel drop
   shadow the genre puts under every number it draws, so it reads over any
   picture. Decorative -- whatever it says is said in text alongside it.
-------------------------------------------------------------------------------*/

const DIGITS: Record<string, number[]> = {
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [7, 1, 7, 4, 7],
  "3": [7, 1, 7, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 7, 1, 7],
  "6": [7, 4, 7, 5, 7],
  "7": [7, 1, 1, 1, 1],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7],
};

export function PixelNumber({
  value,
  className,
  color = "#f2efe8",
  shadow = "#1a1410",
}: {
  value: number | string;
  className?: string;
  color?: string;
  shadow?: string;
}) {
  const text = String(value);
  const cells: Array<[number, number]> = [];
  [...text].forEach((ch, k) => {
    const rows = DIGITS[ch];
    if (!rows) return;
    rows.forEach((bits, y) => {
      for (let x = 0; x < 3; x++) if ((bits >> (2 - x)) & 1) cells.push([k * 4 + x, y]);
    });
  });
  // Four columns a digit (three and a gap), plus a column and a row of shadow.
  const w = text.length * 4;
  const h = 6;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells.map(([x, y]) => (
        <rect key={`s${x}-${y}`} x={x + 1} y={y + 1} width={1} height={1} fill={shadow} />
      ))}
      {cells.map(([x, y]) => (
        <rect key={`d${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}
