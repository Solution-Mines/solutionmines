import { commitments } from "@/content/site";

/* THE DARK INTERLUDE.

   This is where testimonials would normally sit. We have none, and inventing
   them is forbidden — so this section does the same job with material that is
   actually verifiable.

   Every commitment is FALSIFIABLE. "We reply within one business day" is a
   promise the visitor can test immediately by using the form; the reply then
   either confirms or destroys it. A promise that cannot be broken is not a
   commitment, and a technical buyer can tell the difference instantly.

   Visually this is the art-directed inversion: the one near-black band on an
   otherwise warm-paper page. Note it sets data-surface="dark" and nothing
   inside it knows — every child re-skins from the semantic tokens alone.

   Deliberately static. Credibility is earned here by restraint; animation
   would read as salesmanship.                                                */

export function Commitments() {
  return (
    <section
      className="section"
      data-surface="dark"
      aria-labelledby="commitments-heading"
    >
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>02</span>
          <span className="u-eyebrow">What you can hold us to</span>
        </div>

        <h2
          id="commitments-heading"
          className="t-display-lg"
          data-reveal
          style={{ maxWidth: "16ch", marginBottom: "clamp(3rem, 2rem + 3vw, 5rem)" }}
        >
          Four promises you can test before you pay us anything.
        </h2>

        <ul className="grid gap-px md:grid-cols-2 lg:grid-cols-4" style={{ backgroundColor: "var(--color-hairline)" }}>
          {commitments.map((c, i) => (
            <li
              key={c.title}
              data-reveal
              data-reveal-delay={i * 60}
              style={{
                backgroundColor: "var(--color-surface)",
                padding: "2rem 1.75rem 2.5rem",
              }}
            >
              <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3
                className="t-title-lg"
                style={{ margin: "1rem 0 0.75rem" }}
              >
                {c.title}
              </h3>
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
