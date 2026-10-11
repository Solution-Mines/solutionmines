import { situations } from "@/content/site";

/* Problem recognition, placed second on the page.

   Recognition buys the attention that claims cannot. A buyer who sees their
   own situation described accurately reads on; one who sees "innovative
   solutions" leaves.

   Deliberately rules-and-type, NOT cards. Cards signal "marketing feature
   grid"; hairline rules and an editorial split signal a serious publication. */

export function Situations() {
  return (
    <section className="section" id="situations" aria-labelledby="situations-heading">
      <div className="shell">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <div className="section-head" style={{ marginBottom: "1.5rem" }}>
              <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>01</span>
              <span className="u-eyebrow">Where we come in</span>
            </div>
            <h2
              id="situations-heading"
              className="t-display-md"
              data-reveal
            >
              You are probably here because something is already broken.
            </h2>
          </div>

          <ul>
            {situations.map((s, i) => (
              <li
                key={s.quote}
                data-reveal
                data-reveal-delay={i * 70}
                className="situation"
              >
                <p className="u-display situation__quote">&ldquo;{s.quote}&rdquo;</p>
                <div className="situation__meta">
                  <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>
                    {s.reframe}
                  </p>
                  <span className="u-eyebrow situation__service">{s.service}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
