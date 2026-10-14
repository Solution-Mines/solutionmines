import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode } from "@/lib/seo/structured-data";
import { getCaseStudies, clientLabel } from "@/lib/content";
import { SystemDiagram } from "@/components/SystemDiagram";

export const metadata = buildMetadata({
  title: "Our work",
  description:
    "Engagements published with permission and identifying details removed, systems we built for ourselves, and engineering notes we have released openly.",
  path: "/work",
});

const CRUMBS = [
  { href: "/", label: "Home" },
  { href: "/work", label: "Work" },
];

const KIND_LABEL: Record<string, string> = {
  "case-study": "Case study",
  build: "Internal build",
  "open-source": "Open source",
  teardown: "Teardown",
};

export default function WorkIndex() {
  const items = getCaseStudies();

  return (
    <>
      <StructuredData data={graph([breadcrumbNode(CRUMBS)])} />

      <PageHeader
        eyebrow="Work"
        title="What we can show you."
        lede="Most of what we build belongs to the people who paid for it. What follows is what we can show: engagements published with permission and identities removed, systems we built for ourselves, and work we have released openly."
        crumbs={CRUMBS}
      />

      <section className="section" aria-labelledby="work-list-heading">
        <div className="shell">
          <h2 id="work-list-heading" className="u-sr-only">Selected work</h2>

          <div className="work-grid">
            {items.map(({ data }) => (
              <article
                key={data.slug}
                className={`work-card${data.featured ? " work-card--featured" : ""}`}
                data-reveal="scale"
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

                {data.diagram && (
                  <div className="work-card__plate">
                    <SystemDiagram
                      sources={[...data.diagram.sources]}
                      core={data.diagram.core}
                      outputs={[...data.diagram.outputs]}
                    />
                    <p className="work-card__plate-cap">
                      <span>Simplified architecture</span>
                      <span>Identifying detail removed</span>
                    </p>
                  </div>
                )}

                <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)", maxWidth: "52ch" }}>
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

          <div className="exclusions" data-reveal>
            <h2 className="u-eyebrow" style={{ color: "var(--color-accent)", marginBottom: "1rem" }}>
              The rest is under NDA
            </h2>
            <p style={{ color: "var(--color-text-muted)", maxWidth: "58ch" }}>
              We can walk you through confidential work on a call, and in some
              cases arrange a reference conversation with a past client.
            </p>
            <p style={{ marginTop: "1.25rem" }}>
              <Link href="/contact" className="link-quiet u-eyebrow">
                Ask about work we cannot publish &rarr;
              </Link>
            </p>
          </div>
        </div>
      </section>

      <ContactCTA index="—" />
    </>
  );
}
