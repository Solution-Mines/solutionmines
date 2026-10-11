import { PageHeader } from "@/components/PageHeader";
import { ContactCTA } from "@/components/ContactCTA";
import { Faq } from "@/components/Faq";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode, faqNode } from "@/lib/seo/structured-data";
import { stages, commitments } from "@/content/site";

export const metadata = buildMetadata({
  title: "How we work — process, engagement models and terms",
  description:
    "Our delivery process, what you receive at each stage, how we price work, and what happens to your code and accounts when an engagement ends.",
  path: "/how-we-work",
});

const CRUMBS = [
  { href: "/", label: "Home" },
  { href: "/how-we-work", label: "How we work" },
];

const MODELS = [
  {
    name: "Fixed-scope build",
    bestFor: "A defined piece of work with a clear finish line.",
    priced: "Fixed quote, after a paid discovery.",
    duration: "PLACEHOLDER — typical range",
    needs: "A decision-maker available weekly, and access to the systems involved.",
  },
  {
    name: "Embedded engineer",
    bestFor: "You have a team and need senior capacity on one area.",
    priced: "Monthly rate for an agreed number of days.",
    duration: "PLACEHOLDER — minimum commitment",
    needs: "An existing backlog and someone to prioritise it.",
  },
  {
    name: "Ongoing care",
    bestFor: "A system that must keep running and keep changing.",
    priced: "Monthly retainer, scaled to the system.",
    duration: "Rolling, cancellable with notice.",
    needs: "Agreed response expectations and access to monitoring.",
  },
  {
    name: "Assessment",
    bestFor: "You inherited something and need to know what you have.",
    priced: "Fixed price. You keep the report either way.",
    duration: "PLACEHOLDER — typical range",
    needs: "Read access to the code and a conversation with whoever knows it.",
  },
];

const FAQS = [
  {
    question: "What if we want to stop mid-engagement?",
    answer:
      "You can, with notice. Work is invoiced to the point of stopping, you keep everything produced so far, and we will write a handover note covering where things stand.",
  },
  {
    question: "Who owns the code?",
    answer:
      "You do, from the first commit. Repositories and infrastructure accounts are created in your name, not ours, so there is nothing to transfer at the end.",
  },
  {
    question: "What if the estimate turns out to be wrong?",
    answer:
      "We re-quote the changed part and tell you as soon as we know, rather than absorbing it silently or stopping. Discovery exists to make this rare, not to pretend it cannot happen.",
  },
  {
    question: "Do you work with our existing developers?",
    answer:
      "Often, yes. We are usually either leading the architecture or taking one well-defined part end to end, and both work alongside an internal team.",
  },
];

export default function HowWeWorkPage() {
  return (
    <>
      <StructuredData data={graph([breadcrumbNode(CRUMBS), faqNode(FAQS)])} />

      <PageHeader
        eyebrow="How we work"
        title="Our process, our models, and our exit terms."
        lede="Published here because the thing that stops people hiring an unfamiliar firm is not price — it is not knowing what they are agreeing to."
        crumbs={CRUMBS}
      />

      {/* stages with artifacts */}
      <section className="section" aria-labelledby="stages-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>01</span>
            <span className="u-eyebrow">Delivery</span>
          </div>
          <h2 id="stages-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "3rem" }}>
            Every stage hands you something.
          </h2>
          <div className="cap-list">
            {stages.map((s) => (
              <article key={s.index} className="cap-item" data-reveal>
                <span className="u-eyebrow cap-item__n" aria-hidden="true">{s.index}</span>
                <div>
                  <h3 className="t-title-lg">{s.name}</h3>
                  <p style={{ marginTop: "0.6rem", color: "var(--color-text-muted)", maxWidth: "54ch" }}>
                    {s.body}
                  </p>
                  <p className="artifact-line">
                    <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>You get</span>{" "}
                    {s.artifact}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* engagement models */}
      <section className="section" data-surface="dark" aria-labelledby="models-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>02</span>
            <span className="u-eyebrow">Engagement models</span>
          </div>
          <h2 id="models-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "2.5rem" }}>
            Four shapes of working together.
          </h2>

          {/* A real table at md+, stacked definition blocks below — never a
              horizontally scrolling table on a phone. */}
          <div className="models">
            {MODELS.map((m) => (
              <article key={m.name} className="model" data-reveal>
                <h3 className="t-title-lg">{m.name}</h3>
                <dl>
                  <div><dt className="u-eyebrow">Best for</dt><dd>{m.bestFor}</dd></div>
                  <div><dt className="u-eyebrow">How it is priced</dt><dd>{m.priced}</dd></div>
                  <div><dt className="u-eyebrow">Typical length</dt><dd>{m.duration}</dd></div>
                  <div><dt className="u-eyebrow">What we need from you</dt><dd>{m.needs}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* commitments */}
      <section className="section" aria-labelledby="terms-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>03</span>
            <span className="u-eyebrow">Ownership and exit</span>
          </div>
          <h2 id="terms-heading" className="t-display-md" data-reveal style={{ maxWidth: "22ch", marginBottom: "2.5rem" }}>
            What you can hold us to.
          </h2>
          <ul className="grid gap-px md:grid-cols-2 lg:grid-cols-4" style={{ backgroundColor: "var(--color-hairline)" }}>
            {commitments.map((c, i) => (
              <li key={c.title} data-reveal data-reveal-delay={i * 60} style={{ backgroundColor: "var(--color-surface)", padding: "2rem 1.75rem 2.5rem" }}>
                <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="t-title-lg" style={{ margin: "1rem 0 0.75rem" }}>{c.title}</h3>
                <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>{c.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Faq items={FAQS} heading="What people ask before signing" />
      <ContactCTA index="—" />
    </>
  );
}
