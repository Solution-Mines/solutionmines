import Link from "next/link";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode, serviceNode, faqNode } from "@/lib/seo/structured-data";
import { getServiceBySlug, getServiceSlugs, getRelatedServices } from "@/lib/content";
import { siteConfig } from "@/config/site";

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

/** Engagement fields are marked PLACEHOLDER in the frontmatter until a real
 *  duration/band is confirmed. Rather than invent a number, or show the
 *  literal word "PLACEHOLDER" to a visitor, the field is simply omitted from
 *  the page until it is filled in with something real. */
const realValue = (v?: string) =>
  v && !v.startsWith("PLACEHOLDER") ? v : undefined;

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

  const crumbs = [
    { href: "/", label: "Home" },
    { href: `/services/${data.slug}`, label: data.shortTitle ?? data.title },
  ];

  const meta = [
    { label: "Engagement", value: data.engagement.model },
    ...(realValue(data.engagement.duration)
      ? [{ label: "Typical duration", value: realValue(data.engagement.duration)! }]
      : []),
    ...(realValue(data.engagement.band)
      ? [{ label: "Indicative", value: realValue(data.engagement.band)! }]
      : []),
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

      <main id="main" className="min-h-screen bg-surface">
        <div className="mx-auto max-w-content px-6 py-16 sm:py-20 lg:py-24">
          <nav aria-label="Breadcrumb" className="mb-10">
            <ol className="flex flex-wrap items-center gap-2 font-mono text-mono-label tracking-wide text-text-subtle uppercase">
              {crumbs.map((c, i) => (
                <li key={c.href} className="flex items-center gap-2">
                  {i < crumbs.length - 1 ? (
                    <Link href={c.href} className="hover:text-accent">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                  {i < crumbs.length - 1 && <span aria-hidden="true">/</span>}
                </li>
              ))}
            </ol>
          </nav>

          <header className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div>
              <p className="font-mono text-mono-label tracking-wide text-accent uppercase">
                Service {String(data.order).padStart(2, "0")}
              </p>
              <h1 className="mt-3 font-display text-display-lg font-semibold tracking-[-0.03em] text-text-primary">
                {data.title}
              </h1>
            </div>
            <div className="flex flex-col gap-6">
              <p className="text-body-lg text-text-muted">{data.summary}</p>
              {meta.length > 0 && (
                <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-5">
                  {meta.map((m) => (
                    <div key={m.label}>
                      <dt className="font-mono text-mono-label tracking-wide text-text-subtle uppercase">
                        {m.label}
                      </dt>
                      <dd className="mt-1 text-text-primary">{m.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </header>

          {/* symptoms — the "you're probably here because" moment */}
          <section
            aria-labelledby="symptoms-heading"
            className="mt-16 border-t border-hairline pt-12"
          >
            <h2
              id="symptoms-heading"
              className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
            >
              You are probably here because
            </h2>
            <ul className="mt-6 space-y-4">
              {data.symptoms.map((s) => (
                <li
                  key={s}
                  className="font-display text-title-lg text-text-primary"
                >
                  &ldquo;{s}&rdquo;
                </li>
              ))}
            </ul>
          </section>

          {/* capabilities — paragraphs, not bullets */}
          <section
            aria-labelledby="capability-heading"
            className="mt-16 border-t border-hairline pt-12"
          >
            <h2
              id="capability-heading"
              className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
            >
              What we actually do
            </h2>
            <div className="mt-8 grid gap-8 sm:grid-cols-2">
              {data.subCapabilities.map((c, i) => (
                <article key={c.title}>
                  <span className="font-mono text-mono-label text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-2 text-title-md font-semibold text-text-primary">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-text-muted">{c.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* the authored body — the credibility and ranking core */}
          <section
            aria-labelledby="approach-heading"
            className="mt-16 border-t border-hairline pt-12"
          >
            <h2
              id="approach-heading"
              className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
            >
              Our approach
            </h2>
            <div className="prose-service mt-8 max-w-prose">
              <Body />
            </div>
          </section>

          {/* technology, with rationale — never a logo wall */}
          {data.technologies && data.technologies.length > 0 && (
            <section
              aria-labelledby="tech-heading"
              className="mt-16 border-t border-hairline pt-12"
            >
              <h2
                id="tech-heading"
                className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
              >
                Technology, and why
              </h2>
              <dl className="mt-8 grid gap-6 sm:grid-cols-2">
                {data.technologies.map((t) => (
                  <div key={t.name}>
                    <dt className="text-title-md font-semibold text-text-primary">
                      {t.name}
                    </dt>
                    <dd className="mt-1 text-body-sm text-text-muted">
                      {t.rationale}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {data.faqs.length > 0 && (
            <section
              aria-labelledby="faq-heading"
              className="mt-16 border-t border-hairline pt-12"
            >
              <h2
                id="faq-heading"
                className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
              >
                Questions we get
              </h2>
              <div className="mt-8 divide-y divide-hairline">
                {data.faqs.map((f) => (
                  <details key={f.question} className="group py-4">
                    <summary className="cursor-pointer text-title-md font-medium text-text-primary marker:content-none">
                      {f.question}
                    </summary>
                    <p className="mt-3 text-text-muted">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {related.length > 0 && (
            <nav
              aria-labelledby="related-heading"
              className="mt-16 border-t border-hairline pt-12"
            >
              <h2
                id="related-heading"
                className="font-mono text-mono-label tracking-wide text-text-subtle uppercase"
              >
                Often paired with
              </h2>
              <ul className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                {related.map((r) => (
                  <li key={r.data.slug}>
                    <Link
                      href={`/services/${r.data.slug}`}
                      className="text-title-md text-accent hover:underline"
                    >
                      {r.data.title} &rarr;
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <section
            aria-labelledby="cta-heading"
            className="mt-16 border-t border-hairline pt-12"
          >
            <h2
              id="cta-heading"
              className="font-display text-display-md font-semibold tracking-[-0.02em] text-text-primary"
            >
              Discuss a {(data.shortTitle ?? data.title).toLowerCase()} project.
            </h2>
            <p className="mt-3 max-w-[48ch] text-text-muted">
              Tell us what is happening. We will reply with{" "}
              {siteConfig.responseCommitment}.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-6">
              <a
                href={`mailto:${siteConfig.email}`}
                className="inline-flex items-center gap-2 rounded-sm bg-accent px-5 py-3 font-medium text-on-accent hover:bg-accent-hover"
              >
                Email {siteConfig.email}
              </a>
              <Link href="/" className="text-text-muted hover:text-accent">
                &larr; Back to SolutionMines
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
