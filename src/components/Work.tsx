import { work } from "@/content/site";

/* Proof of work.

   Note the framing line. It does a lot of work: it pre-empts the "why so
   little?" question, converts an NDA constraint into evidence of discretion,
   and implies a professional relationship with past clients.

   The mixed item types (case study / open source / teardown) are deliberate.
   A heterogeneous set reads as "a selection"; four identical case-study cards
   read as "all we have".

   Every plate below is a PLACEHOLDER. For NDA-bound work these become
   redacted architecture diagrams rather than UI screenshots — which is both
   honest and, for a technical buyer, more interesting.                       */

export function Work() {
  return (
    <section className="section" id="work" aria-labelledby="work-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>05</span>
          <span className="u-eyebrow">Selected work</span>
        </div>

        <div className="mb-12 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
          <h2
            id="work-heading"
            className="t-display-lg"
            data-reveal
            style={{ maxWidth: "16ch" }}
          >
            What we can show you.
          </h2>
          <p data-reveal data-reveal-delay={80} style={{ color: "var(--color-text-muted)", maxWidth: "46ch" }}>
            Most of what we build belongs to the people who paid for it. Below
            is what we can show: engagements published with permission,
            systems we built for ourselves, and work we have released openly.
          </p>
        </div>

        <div className="work-grid">
          {work.map((item, i) => (
            <article
              key={item.title}
              className={`work-card${item.featured ? " work-card--featured" : ""}`}
              data-reveal="scale"
              data-reveal-delay={i * 70}
            >
              <span className="u-eyebrow work-card__kind">
                <span aria-hidden="true" style={{ width: 14, height: 1, background: "currentColor" }} />
                {item.kind}
              </span>

              <h3 className="work-card__title">
                <a href="#contact" className="stretch link-quiet">{item.title}</a>
              </h3>

              {item.featured && (
                <div className="work-card__plate" aria-hidden="true">
                  <span>Architecture diagram — placeholder</span>
                </div>
              )}

              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)", maxWidth: "48ch" }}>
                {item.outcome}
              </p>

              <div className="work-card__foot">
                <ul className="svc__tags" style={{ marginTop: 0 }}>
                  {item.stack.map((t) => (
                    <li key={t} className="tag">{t}</li>
                  ))}
                </ul>
                <span className="u-eyebrow" style={{ color: "var(--color-text-subtle)" }}>
                  {item.client}
                </span>
              </div>
            </article>
          ))}
        </div>

        <p
          data-reveal
          className="u-eyebrow"
          style={{ marginTop: "2rem", color: "var(--color-text-subtle)", maxWidth: "60ch", lineHeight: 1.8 }}
        >
          The rest is under NDA. We can walk you through confidential work on a
          call, and in some cases arrange a reference conversation.
        </p>
      </div>
    </section>
  );
}
