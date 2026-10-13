/* Continuous capability ticker.

   Two jobs: it fills what was dead space under the hero, and it adds the
   only continuous motion on the page so the composition reads as alive.

   The track is duplicated and the copy is aria-hidden — a screen reader
   hears the list once, not twice. The real list is a plain <ul>, so the
   content is available even if the animation never runs. */

const ITEMS = [
  "Product engineering",
  "API & systems integration",
  "Automation & data workflows",
  "Modernization",
  "Codebase takeover",
  "Payment integrations",
  "Observability",
  "Deployment pipelines",
  "Technical discovery",
  "Ongoing care",
];

export function Ticker() {
  return (
    <div className="ticker">
      <div className="ticker__track">
        <ul className="flex" aria-label="What we work on">
          {ITEMS.map((t) => (
            <li key={t} className="ticker__item">{t}</li>
          ))}
        </ul>
        <ul className="flex" aria-hidden="true">
          {ITEMS.map((t) => (
            <li key={`dup-${t}`} className="ticker__item">{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
