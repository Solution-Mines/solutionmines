import Link from "next/link";
import type { CaseStudyEntry } from "@/lib/content";
import { clientLabel } from "@/lib/content";

const KIND_LABEL: Record<string, string> = {
  "case-study": "Case study",
  build: "Internal build",
  "open-source": "Open source",
  teardown: "Teardown",
};

/* Proof of work.

   The framing line does a lot of work: it pre-empts the "why so little?"
   question, converts an NDA constraint into evidence of discretion, and
   implies a professional relationship with past clients.

   Mixed item types are deliberate. A heterogeneous set reads as "a
   selection"; four identical case-study cards read as "all we have". */
export function Work({ items }: { items: CaseStudyEntry[] }) {
  return (
    <section className="section" id="work" aria-labelledby="work-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>05</span>
          <span className="u-eyebrow">Selected work</span>
        </div>

        <div className="mb-12 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
          <h2 id="work-heading" className="t-display-lg" data-reveal style={{ maxWidth: "16ch" }}>
            What we can show you.
          </h2>
          <p data-reveal data-reveal-delay={80} style={{ color: "var(--color-text-muted)", maxWidth: "46ch" }}>
            Most of what we build belongs to the people who paid for it. Below
            is what we can show: engagements published with permission, systems
            we built for ourselves, and work we have released openly.
          </p>
        </div>

        <div className="work-grid">
          {items.map(({ data }, i) => (
            <article
              key={data.slug}
              className={`work-card${data.featured ? " work-card--featured" : ""}`}
              data-reveal="scale"
              data-reveal-delay={i * 70}
            >
              <span className="u-eyebrow work-card__kind">
                <span aria-hidden="true" style={{ width: 14, height: 1, background: "currentColor" }} />
                {KIND_LABEL[data.kind] ?? data.kind}
              </span>

              <h3 className="work-card__title">
                <Link href={`/work/${data.slug}`} className="stretch link-quiet">
                  {data.title}
                </Link>
              </h3>

              {data.featured && (
                <div className="work-card__plate" aria-hidden="true">
                  <span>Architecture diagram — placeholder</span>
                </div>
              )}

              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)", maxWidth: "48ch" }}>
                {data.summary}
              </p>

              <div className="work-card__foot">
                <ul className="svc__tags" style={{ marginTop: 0 }}>
                  {data.technologies.slice(0, 3).map((t) => (
                    <li key={t} className="tag">{t}</li>
                  ))}
                </ul>
                <span className="u-eyebrow" style={{ color: "var(--color-text-subtle)" }}>
                  {clientLabel(data.client)}
                </span>
              </div>
            </article>
          ))}
        </div>

        <p style={{ marginTop: "2rem" }}>
          <Link href="/work" className="link-quiet u-eyebrow">
            All work &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}
