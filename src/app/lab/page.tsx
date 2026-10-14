import Link from "next/link";
import { prototypes } from "./prototypes";

export default function LabIndex() {
  return (
    <div className="labindex">
      <p className="t-eyebrow">Design lab — four directions</p>
      <h1 className="t-display-lg">
        Four ways this site could stop looking like every other one.
      </h1>
      <p className="labindex__lede">
        Each is a working hero plus one real section, built with the same
        content. The live site is untouched. Open them in turn, use them — the
        difference between these is interaction, which a screenshot cannot
        carry. Pick one, or pick parts of several.
      </p>

      <ul className="labindex__grid">
        {prototypes.map((p) => (
          <li key={p.slug} style={{ display: "contents" }}>
            <Link href={`/lab/${p.slug}`} className="labcard">
              <span className="labcard__no">{p.no}</span>
              <span className="labcard__title">{p.name}</span>
              <span
                className="labcard__swatch"
                aria-hidden="true"
                style={{
                  background: `linear-gradient(90deg, ${p.swatch[0]} 0 55%, ${p.swatch[1]} 55% 85%, ${p.swatch[2]} 85% 100%)`,
                }}
              />
              <span className="labcard__body">{p.body}</span>
              <span className="labcard__meta">
                <span>{p.tech.join(" · ")}</span>
                <span>{p.cost}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
