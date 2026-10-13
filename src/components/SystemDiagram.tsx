/* ----------------------------------------------------------------------------
   SYSTEM DIAGRAM

   Replaces the empty "ARCHITECTURE DIAGRAM — PLACEHOLDER" rectangle on work
   cards with an actual drawn diagram built from the case study's own data.

   This is the honest way to illustrate NDA-bound work. A redacted system
   diagram tells a technical buyer more than a cropped screenshot of a UI
   would, it cannot leak a client's branding or interface, and it does not
   fabricate anything — the boxes are the systems named in the case study.

   Pure SVG, server-rendered, no images to load, scales to any width.
-------------------------------------------------------------------------------*/

type Props = {
  /** Left-hand sources, e.g. the systems data arrives from. */
  sources: string[];
  /** The thing we built. */
  core: string;
  /** Right-hand outputs. */
  outputs: string[];
};

const W = 520;
const H = 200;

export function SystemDiagram({ sources, core, outputs }: Props) {
  const boxW = 104;
  const boxH = 30;
  const coreW = 126;
  const coreH = 44;

  const colX = { left: 10, core: W / 2 - coreW / 2, right: W - boxW - 10 };
  const spread = (n: number, i: number, height: number) => {
    const gap = (H - 40) / Math.max(n, 1);
    return 20 + gap * i + gap / 2 - height / 2;
  };

  const coreY = H / 2 - coreH / 2;

  return (
    <svg
      className="sysdiag"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Simplified architecture: ${sources.join(", ")} feeding ${core}, producing ${outputs.join(", ")}`}
    >
      <defs>
        <marker
          id="sd-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L7 4 L0 7 z" className="sysdiag__head" />
        </marker>
      </defs>

      {/* edges in first so boxes sit above them */}
      {sources.map((_, i) => {
        const y = spread(sources.length, i, boxH) + boxH / 2;
        const midX = (colX.left + boxW + colX.core) / 2;
        return (
          <path
            key={`in-${i}`}
            className="sysdiag__edge"
            markerEnd="url(#sd-arrow)"
            d={`M${colX.left + boxW} ${y} H${midX} V${coreY + coreH / 2} H${colX.core - 4}`}
          />
        );
      })}

      {outputs.map((_, i) => {
        const y = spread(outputs.length, i, boxH) + boxH / 2;
        const midX = (colX.core + coreW + colX.right) / 2;
        return (
          <path
            key={`out-${i}`}
            className="sysdiag__edge"
            markerEnd="url(#sd-arrow)"
            d={`M${colX.core + coreW} ${coreY + coreH / 2} H${midX} V${y} H${colX.right - 4}`}
          />
        );
      })}

      {sources.map((s, i) => {
        const y = spread(sources.length, i, boxH);
        return (
          <g key={`s-${s}`}>
            <rect className="sysdiag__box" x={colX.left} y={y} width={boxW} height={boxH} rx="3" />
            <text className="sysdiag__text" x={colX.left + boxW / 2} y={y + boxH / 2} textAnchor="middle" dominantBaseline="middle">
              {s}
            </text>
          </g>
        );
      })}

      <g>
        <rect
          className="sysdiag__box sysdiag__box--core"
          x={colX.core}
          y={coreY}
          width={coreW}
          height={coreH}
          rx="3"
        />
        <text
          className="sysdiag__text sysdiag__text--core"
          x={colX.core + coreW / 2}
          y={coreY + coreH / 2}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {core}
        </text>
      </g>

      {outputs.map((o, i) => {
        const y = spread(outputs.length, i, boxH);
        return (
          <g key={`o-${o}`}>
            <rect className="sysdiag__box" x={colX.right} y={y} width={boxW} height={boxH} rx="3" />
            <text className="sysdiag__text" x={colX.right + boxW / 2} y={y + boxH / 2} textAnchor="middle" dominantBaseline="middle">
              {o}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
