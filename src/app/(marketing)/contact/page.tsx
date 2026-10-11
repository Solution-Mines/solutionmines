import { PageHeader } from "@/components/PageHeader";
import { ContactForm } from "@/components/ContactForm";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode } from "@/lib/seo/structured-data";
import { siteConfig } from "@/config/site";

export const metadata = buildMetadata({
  title: "Start a project",
  description:
    "Tell us what you are building or what is broken. We reply within one business day, from an engineer, with a real technical observation.",
  path: "/contact",
});

const CRUMBS = [
  { href: "/", label: "Home" },
  { href: "/contact", label: "Start a project" },
];

const STEPS = [
  { n: "01", t: "Send a short brief", d: "Five minutes. What you are building, or what is broken." },
  { n: "02", t: "We reply within one business day", d: "From an engineer, with a real question or observation — not a calendar link." },
  { n: "03", t: "A 30-minute technical call", d: "Free, no deck, no obligation." },
];

export default function ContactPage() {
  return (
    <>
      <StructuredData data={graph([breadcrumbNode(CRUMBS)])} />

      <PageHeader
        eyebrow="Start a project"
        title="Tell us what is broken."
        lede="We will tell you what we would do about it — before you have paid us anything."
        crumbs={CRUMBS}
      />

      <section className="section" aria-labelledby="form-heading">
        <div className="shell">
          <div className="contact-layout">
            <div>
              <h2 id="form-heading" className="u-eyebrow" style={{ marginBottom: "2rem" }}>
                Send a brief
              </h2>
              <ContactForm />
            </div>

            <aside className="contact-aside">
              <h2 className="u-eyebrow" style={{ marginBottom: "1.5rem" }}>
                What happens next
              </h2>
              <ol className="contact-steps">
                {STEPS.map((s) => (
                  <li key={s.n}>
                    <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>{s.n}</span>
                    <h3 className="t-title-md" style={{ margin: "0.5rem 0 0.4rem" }}>{s.t}</h3>
                    <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>{s.d}</p>
                  </li>
                ))}
              </ol>

              <div style={{ marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-hairline)" }}>
                <p className="u-eyebrow" style={{ marginBottom: "0.75rem" }}>Prefer email?</p>
                <a
                  href={`mailto:${siteConfig.email}`}
                  className="link-quiet"
                  style={{ textDecoration: "underline", textUnderlineOffset: "0.2em" }}
                >
                  {siteConfig.email}
                </a>
                <p style={{ marginTop: "0.75rem", color: "var(--color-text-subtle)", fontSize: "var(--text-body-sm)" }}>
                  It goes to a person, not a ticket queue.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
