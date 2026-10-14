import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode } from "@/lib/seo/structured-data";
import { getServices } from "@/lib/content";

export const metadata = buildMetadata({
  title: "What we do",
  description:
    "Four capability areas: product engineering, systems integration, automation and data workflows, and modernization with ongoing care.",
  path: "/services",
});

const CRUMBS = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
];

export default function ServicesIndex() {
  const services = getServices();

  return (
    <>
      <StructuredData data={graph([breadcrumbNode(CRUMBS)])} />

      <PageHeader
        eyebrow="Services"
        title="Four things, done to a standard we will put in writing."
        lede="We consolidated deliberately. A longer list would suggest we do everything equally well, which no firm of any size does."
        crumbs={CRUMBS}
      />

      <section className="section" aria-labelledby="capabilities-heading">
        <div className="shell">
          <h2 id="capabilities-heading" className="u-sr-only">Capabilities</h2>
          <div>
            {services.map(({ data }) => (
              <article key={data.slug} className="svc" data-reveal>
                <span className="svc__index" aria-hidden="true">
                  {String(data.order).padStart(2, "0")}
                </span>
                <div className="svc__main">
                  <div className="svc__left">
                  <h3 className="svc__title">
                    <Link href={`/services/${data.slug}`} className="stretch link-quiet">
                      {data.title}
                    </Link>
                    <span className="svc__arrow" aria-hidden="true">&rarr;</span>
                  </h3>
                  <p className="svc__body">{data.summary}</p>

                  </div>
                  <ul className="svc__outcomes">
                    {data.outcomes.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>

                  <p className="u-eyebrow svc__engagement">
                    {data.engagement.duration} &middot; {data.engagement.model}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="exclusions" data-reveal>
            <h2 className="u-eyebrow" style={{ color: "var(--color-accent)", marginBottom: "1rem" }}>
              What we do not do
            </h2>
            <p style={{ color: "var(--color-text-muted)", maxWidth: "58ch" }}>
              Machine-learning research, native game development, and staff
              augmentation at scale. Saying so filters out work we would do
              badly, and it is the fastest way to make the rest of this page
              believable.{" "}
              <span style={{ color: "var(--color-text-subtle)" }}>
                (PLACEHOLDER — confirm the real exclusion list.)
              </span>
            </p>
          </div>
        </div>
      </section>

      <ContactCTA
        index="—"
        eyebrow="Not sure which?"
        heading="Describe the problem, not the service."
        lede="If you are not sure which of these you need, that is normal and it is our job to work out. Tell us what is happening."
      />
    </>
  );
}
