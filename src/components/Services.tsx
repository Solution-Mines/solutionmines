import { services } from "@/content/site";

/* Services as an editorial INDEX, not a card grid.

   A 2x2 grid of icon cards is the single most commoditising layout in this
   category. Large type in a ruled list reads as a publication's contents
   page — and, practically, it lets four services occupy the visual weight
   that twelve cards would, which matters for a young firm.

   Each row is a stretched link: one tab stop, accessible name is the title,
   and focus-within produces the same visual as hover so nothing is
   mouse-only.                                                                */

export function Services() {
  return (
    <section className="section" id="services" aria-labelledby="services-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>03</span>
          <span className="u-eyebrow">What we do</span>
        </div>

        <div className="mb-12 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
          <h2
            id="services-heading"
            className="t-display-lg"
            data-reveal
            style={{ maxWidth: "18ch" }}
          >
            Four things, done to a standard we will put in writing.
          </h2>
          <p
            data-reveal
            data-reveal-delay={80}
            style={{ color: "var(--color-text-muted)", maxWidth: "46ch" }}
          >
            We deliberately do not do machine-learning research, native game
            development, or staff augmentation at scale.{" "}
            <span style={{ color: "var(--color-text-subtle)" }}>
              (PLACEHOLDER — confirm the real exclusion list.)
            </span>
          </p>
        </div>

        <div>
          {services.map((s, i) => (
            <article
              key={s.title}
              className="svc"
              data-reveal
              data-reveal-delay={i * 60}
            >
              <span className="svc__index" aria-hidden="true">{s.index}</span>
              <div>
                <h3 className="svc__title">
                  <a href="#contact" className="stretch link-quiet">
                    {s.title}
                  </a>
                  <span className="svc__arrow" aria-hidden="true">&rarr;</span>
                </h3>
                <p className="svc__body">{s.outcome}</p>
                <p
                  className="svc__body"
                  style={{ fontSize: "var(--text-body-sm)", color: "var(--color-text-subtle)" }}
                >
                  {s.detail}
                </p>
                <ul className="svc__tags">
                  {s.absorbs.map((a) => (
                    <li key={a} className="tag">{a}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
