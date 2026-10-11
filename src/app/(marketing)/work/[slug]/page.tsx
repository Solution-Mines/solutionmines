import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Prose } from "@/components/Prose";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode, articleNode } from "@/lib/seo/structured-data";
import {
  getCaseStudyBySlug,
  getCaseStudySlugs,
  getCaseStudies,
  getServiceBySlug,
  clientLabel,
} from "@/lib/content";

export function generateStaticParams() {
  return getCaseStudySlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const study = getCaseStudyBySlug(slug);
  if (!study) return {};
  const { data } = study;
  return buildMetadata({
    title: data.seo?.title ?? data.title,
    description: data.seo?.description ?? data.summary,
    path: `/work/${data.slug}`,
    noindex: data.seo?.noindex,
    type: "article",
    publishedTime: data.publishedAt,
    modifiedTime: data.updatedAt,
  });
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const study = getCaseStudyBySlug(slug);
  if (!study) notFound();

  const { data, Body } = study;
  const all = getCaseStudies();
  const idx = all.findIndex((c) => c.data.slug === slug);
  const next = all[(idx + 1) % all.length];
  const services = data.services
    .map((s) => getServiceBySlug(s))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const crumbs = [
    { href: "/", label: "Home" },
    { href: "/work", label: "Work" },
    { href: `/work/${data.slug}`, label: data.title },
  ];

  return (
    <>
      <StructuredData data={graph([breadcrumbNode(crumbs), articleNode(data)])} />

      <PageHeader
        eyebrow={data.kind === "case-study" ? "Case study" : data.kind.replace("-", " ")}
        title={data.title}
        lede={data.summary}
        crumbs={crumbs}
        meta={[
          { label: "Client", value: clientLabel(data.client) },
          { label: "Sector", value: data.client.industry },
          ...(data.duration ? [{ label: "Duration", value: data.duration }] : []),
          { label: "Stack", value: data.technologies.join(", ") },
        ]}
      />

      {data.client.anonymised && (
        <div className="shell">
          <p className="notice" role="note">
            Published with the client&rsquo;s permission. Their name, product
            names and any identifying figures have been removed or generalised.
          </p>
        </div>
      )}

      {/* the narrative: situation, approach, outcome */}
      <section className="section" aria-labelledby="narrative-heading">
        <div className="shell">
          <h2 id="narrative-heading" className="u-sr-only">The engagement</h2>
          <div className="narrative">
            <div data-reveal>
              <h3 className="u-eyebrow" style={{ color: "var(--color-accent)" }}>The situation</h3>
              <p>{data.challenge}</p>
            </div>
            <div data-reveal data-reveal-delay={70}>
              <h3 className="u-eyebrow" style={{ color: "var(--color-accent)" }}>What we did</h3>
              <p>{data.approach}</p>
            </div>
            <div data-reveal data-reveal-delay={140}>
              <h3 className="u-eyebrow" style={{ color: "var(--color-accent)" }}>The outcome</h3>
              <p>{data.outcome}</p>
            </div>
          </div>

          {data.metrics.length > 0 && (
            <dl className="metrics" data-reveal>
              {data.metrics.map((m) => (
                <div key={m.label}>
                  <dt className="u-eyebrow">{m.label}</dt>
                  <dd className="metrics__value">{m.value}</dd>
                  {m.context && <dd className="metrics__context">{m.context}</dd>}
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* THE DECISIONS — the core of the page.
          Reasoning is verifiable from the text itself; outcomes are not. For a
          firm without a reputation, showing how you think is more persuasive
          than any number you could quote. */}
      {data.decisions.length > 0 && (
        <section className="section" data-surface="dark" aria-labelledby="decisions-heading">
          <div className="shell">
            <div className="section-head">
              <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>Decisions</span>
              <span className="u-eyebrow">What we chose, and what it cost</span>
            </div>
            <h2 id="decisions-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "3rem" }}>
              Every choice traded something away.
            </h2>
            <div className="decisions">
              {data.decisions.map((d, i) => (
                <article key={d.title} className="decision" data-reveal data-reveal-delay={i * 70}>
                  <span className="u-eyebrow decision__n" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="t-title-lg">{d.title}</h3>
                    <p className="decision__chose">{d.chose}</p>
                    <p className="decision__tradeoff">
                      <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>Trade-off</span>{" "}
                      {d.tradeoff}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* authored body */}
      <section className="section" aria-labelledby="detail-heading">
        <div className="shell">
          <h2 id="detail-heading" className="u-sr-only">Detail</h2>
          <Prose>
            <Body />
          </Prose>
        </div>
      </section>

      {/* Never blocked by an NDA, costs nothing, and almost nobody publishes
          it — which is exactly why it reads as honest. */}
      {data.retrospective && (
        <section className="section" style={{ paddingTop: 0 }} aria-labelledby="retro-heading">
          <div className="shell">
            <div className="retro" data-reveal>
              <h2 id="retro-heading" className="u-eyebrow" style={{ color: "var(--color-accent)", marginBottom: "1rem" }}>
                What we would do differently
              </h2>
              <p>{data.retrospective}</p>
            </div>
          </div>
        </section>
      )}

      <section className="section" style={{ paddingTop: 0 }} aria-labelledby="cs-links-heading">
        <div className="shell">
          <h2 id="cs-links-heading" className="u-sr-only">Related</h2>
          <div className="cs-links">
            <div>
              <p className="u-eyebrow" style={{ marginBottom: "0.75rem" }}>Related service</p>
              <ul style={{ display: "grid", gap: "0.5rem" }}>
                {services.map(({ data: s }) => (
                  <li key={s.slug}>
                    <Link href={`/services/${s.slug}`} className="link-quiet t-title-md">
                      {s.title} &rarr;
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {next && next.data.slug !== data.slug && (
              <div>
                <p className="u-eyebrow" style={{ marginBottom: "0.75rem" }}>Next</p>
                <Link href={`/work/${next.data.slug}`} className="link-quiet t-title-md">
                  {next.data.title} &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <ContactCTA
        index="—"
        eyebrow="Start a project"
        heading="Start a project like this."
        lede="If something here resembles your situation, describe yours. We will tell you how close it actually is."
      />
    </>
  );
}
