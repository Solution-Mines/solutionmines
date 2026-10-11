import Link from "next/link";
import type { ServiceEntry } from "@/lib/content";

/* Services as an editorial INDEX, not a card grid.

   A 2x2 grid of icon cards is the single most commoditising layout in this
   category. Large type in a ruled list reads as a publication's contents page
   — and practically, it lets four services carry the visual weight twelve
   cards would, which matters for a young firm.

   Each row is a stretched link: one tab stop, accessible name is the title,
   and :focus-within produces the same visual as hover so nothing is
   mouse-only. */
export function Services({ services }: { services: ServiceEntry[] }) {
  return (
    <section className="section" id="services" aria-labelledby="services-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>03</span>
          <span className="u-eyebrow">What we do</span>
        </div>

        <div className="mb-12 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-20">
          <h2 id="services-heading" className="t-display-lg" data-reveal style={{ maxWidth: "18ch" }}>
            Four things, done to a standard we will put in writing.
          </h2>
          <p data-reveal data-reveal-delay={80} style={{ color: "var(--color-text-muted)", maxWidth: "46ch" }}>
            We deliberately do not do machine-learning research, native game
            development, or staff augmentation at scale.{" "}
            <span style={{ color: "var(--color-text-subtle)" }}>
              (PLACEHOLDER — confirm the real exclusion list.)
            </span>
          </p>
        </div>

        <div>
          {services.map(({ data }, i) => (
            <article key={data.slug} className="svc" data-reveal data-reveal-delay={i * 60}>
              <span className="svc__index" aria-hidden="true">
                {String(data.order).padStart(2, "0")}
              </span>
              <div>
                <h3 className="svc__title">
                  <Link href={`/services/${data.slug}`} className="stretch link-quiet">
                    {data.title}
                  </Link>
                  <span className="svc__arrow" aria-hidden="true">&rarr;</span>
                </h3>
                <p className="svc__body">{data.summary}</p>
                <ul className="svc__tags">
                  {data.outcomes.slice(0, 3).map((o) => (
                    <li key={o} className="tag">{o}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>

        <p style={{ marginTop: "2.5rem" }}>
          <Link href="/services" className="link-quiet u-eyebrow">
            All services &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}
