import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Prose } from "@/components/Prose";
import { Faq } from "@/components/Faq";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode, serviceNode, faqNode } from "@/lib/seo/structured-data";
import {
  getServiceBySlug,
  getServiceSlugs,
  getRelatedServices,
  getCaseStudiesForService,
  clientLabel,
} from "@/lib/content";

/* Fully enumerable at build time, so every service page is static. */
export function generateStaticParams() {
  return getServiceSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) return {};
  const { data } = service;
  return buildMetadata({
    title: data.seo?.title ?? data.title,
    description: data.seo?.description ?? data.summary,
    path: `/services/${data.slug}`,
    noindex: data.seo?.noindex,
    modifiedTime: data.updatedAt,
  });
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const service = getServiceBySlug(slug);
  if (!service) notFound();

  const { data, Body } = service;
  const related = getRelatedServices(slug);
  const proof = getCaseStudiesForService(slug);

  const crumbs = [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
    { href: `/services/${data.slug}`, label: data.shortTitle ?? data.title },
  ];

  return (
    <>
      <StructuredData
        data={graph([
          breadcrumbNode(crumbs),
          serviceNode(data),
          ...(data.faqs.length > 0 ? [faqNode(data.faqs)] : []),
        ])}
      />

      <PageHeader
        eyebrow={`Service ${String(data.order).padStart(2, "0")}`}
        title={data.title}
        lede={data.summary}
        crumbs={crumbs}
        meta={[
          { label: "Typical duration", value: data.engagement.duration },
          { label: "Engagement", value: data.engagement.model },
          ...(data.engagement.band
            ? [{ label: "Indicative", value: data.engagement.band }]
            : []),
        ]}
      />

      {/* symptoms — the "you're probably here because" moment */}
      <section className="section" aria-labelledby="symptoms-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>01</span>
            <span className="u-eyebrow">You are probably here because</span>
          </div>
          <h2 id="symptoms-heading" className="u-sr-only">Symptoms</h2>
          <ul className="symptoms">
            {data.symptoms.map((s) => (
              <li key={s} data-reveal className="t-title-lg">
                &ldquo;{s}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* capabilities — paragraphs, not bullets */}
      <section className="section" aria-labelledby="capability-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>02</span>
            <span className="u-eyebrow">What we actually do</span>
          </div>
          <h2 id="capability-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "3rem" }}>
            The work, described properly.
          </h2>
          <div className="cap-list">
            {data.subCapabilities.map((c, i) => (
              <article key={c.title} className="cap-item" data-reveal data-reveal-delay={i * 60}>
                <span className="u-eyebrow cap-item__n" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="t-title-lg">{c.title}</h3>
                  <p style={{ marginTop: "0.6rem", color: "var(--color-text-muted)", maxWidth: "58ch" }}>
                    {c.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* the authored body — the credibility and ranking core */}
      <section className="section" data-surface="dark" aria-labelledby="approach-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>03</span>
            <span className="u-eyebrow">Our approach</span>
          </div>
          <h2 id="approach-heading" className="u-sr-only">How we approach it</h2>
          <Prose>
            <Body />
          </Prose>
        </div>
      </section>

      {/* technology, with rationale — never a logo wall */}
      {data.technologies && data.technologies.length > 0 && (
        <section className="section" aria-labelledby="tech-heading">
          <div className="shell">
            <div className="section-head">
              <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>04</span>
              <span className="u-eyebrow">Technology, and why</span>
            </div>
            <h2 id="tech-heading" className="t-display-md" data-reveal style={{ maxWidth: "22ch", marginBottom: "2.5rem" }}>
              Defaults, not dogma.
            </h2>
            <dl className="tech-list">
              {data.technologies.map((t) => (
                <div key={t.name} data-reveal>
                  <dt className="t-title-md">{t.name}</dt>
                  <dd style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>
                    {t.rationale}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {/* reciprocal proof links — the internal linking loop */}
      {proof.length > 0 && (
        <section className="section" aria-labelledby="proof-heading">
          <div className="shell">
            <div className="section-head">
              <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>05</span>
              <span className="u-eyebrow">Related work</span>
            </div>
            <h2 id="proof-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "2.5rem" }}>
              Where we have done this.
            </h2>
            <div className="work-grid">
              {proof.map(({ data: cs }) => (
                <article key={cs.slug} className="work-card" data-reveal>
                  <span className="u-eyebrow work-card__kind">
                    <span aria-hidden="true" style={{ width: 14, height: 1, background: "currentColor" }} />
                    {clientLabel(cs.client)}
                  </span>
                  <h3 className="work-card__title">
                    <Link href={`/work/${cs.slug}`} className="stretch link-quiet">{cs.title}</Link>
                  </h3>
                  <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>
                    {cs.summary}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <Faq items={data.faqs} />

      {related.length > 0 && (
        <section className="section" style={{ paddingTop: 0 }} aria-labelledby="related-heading">
          <div className="shell">
            <h2 id="related-heading" className="u-eyebrow" style={{ marginBottom: "1rem" }}>
              Often paired with
            </h2>
            <ul style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
              {related.map(({ data: r }) => (
                <li key={r.slug}>
                  <Link href={`/services/${r.slug}`} className="link-quiet t-title-md">
                    {r.title} &rarr;
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ContactCTA
        index="—"
        eyebrow={data.title}
        heading={`Discuss a ${(data.shortTitle ?? data.title).toLowerCase()} project.`}
        lede="Tell us what is happening. We will reply with a real technical question, not a calendar link."
      />
    </>
  );
}
