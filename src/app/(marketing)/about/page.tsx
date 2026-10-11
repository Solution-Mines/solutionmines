import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { buildMetadata } from "@/lib/seo/metadata";
import { graph, breadcrumbNode } from "@/lib/seo/structured-data";

export const metadata = buildMetadata({
  title: "About",
  description:
    "A small engineering firm. The people who scope the work are the people who build it, and they are still there when something breaks.",
  path: "/about",
});

const CRUMBS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
];

/* Operating principles are written as beliefs WITH CONSEQUENCES. "We value
   quality" is unfalsifiable and therefore worthless; "we will argue against
   your rewrite" is a position someone can disagree with, which is what makes
   it informative. */
const PRINCIPLES = [
  {
    title: "We do not start building until we can explain it back to you",
    body: "If we cannot describe your system in our own words, we do not understand it well enough to change it. That is what discovery is for, and it is why we quote fixed afterwards rather than before.",
  },
  {
    title: "We build for the second developer",
    body: "The question is never whether we can make something work. It is whether someone who was not here can change it safely in a year. That shapes how much we test, how much indirection we add, and how much we write down.",
  },
  {
    title: "We will argue against your rewrite",
    body: "A rewrite trades a known system with known problems for an unknown one, and it almost always takes longer than estimated. Sometimes it is right. We will tell you when, and we will tell you when it is not.",
  },
  {
    title: "Bad news travels fast",
    body: "If an estimate is wrong, you hear it the week we know, not at the deadline. This is the single thing that most determines whether a project relationship survives a problem.",
  },
];

export default function AboutPage() {
  return (
    <>
      <StructuredData data={graph([breadcrumbNode(CRUMBS)])} />

      <PageHeader
        eyebrow="About"
        title="A small firm, deliberately."
        lede="We started as freelance engineers building and maintaining systems for companies that needed a specialist rather than an agency. Same people, same way of working, with the structure to take on larger work."
        crumbs={CRUMBS}
      />

      <section className="section" aria-labelledby="origin-heading">
        <div className="shell">
          <div className="about-grid">
            <div>
              <div className="section-head" style={{ marginBottom: "1.5rem" }}>
                <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>01</span>
                <span className="u-eyebrow">Who you work with</span>
              </div>
              <h2 id="origin-heading" className="t-display-md" style={{ maxWidth: "16ch" }}>
                You will not be handed to a junior after the proposal.
              </h2>
            </div>

            <div className="prose" style={{ marginTop: 0 }}>
              <p>
                The person who scopes your project is the person who writes or
                reviews the code. That is not a promise about seniority badges;
                it is a consequence of being small, and it is the main reason to
                hire a firm this size instead of a larger one.
              </p>
              <p>
                It also sets an honest limit. We take on a small number of
                engagements at a time, and when we are full we will say so
                rather than stretching and delivering late.
              </p>
              <p style={{ color: "var(--color-text-subtle)" }}>
                PLACEHOLDER — founder name, role, photograph, and a background
                summary built only from verifiable history. Do not publish a
                years-of-experience figure until it is confirmed.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" data-surface="dark" aria-labelledby="principles-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>02</span>
            <span className="u-eyebrow">What we believe</span>
          </div>
          <h2 id="principles-heading" className="t-display-md" data-reveal style={{ maxWidth: "20ch", marginBottom: "3rem" }}>
            Positions, not values.
          </h2>
          <div className="cap-list">
            {PRINCIPLES.map((p, i) => (
              <article key={p.title} className="cap-item" data-reveal data-reveal-delay={i * 60}>
                <span className="u-eyebrow cap-item__n" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="t-title-lg" style={{ maxWidth: "26ch" }}>{p.title}</h3>
                  <p style={{ marginTop: "0.6rem", color: "var(--color-text-muted)", maxWidth: "58ch" }}>
                    {p.body}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="setup-heading">
        <div className="shell">
          <h2 id="setup-heading" className="u-eyebrow" style={{ color: "var(--color-accent)", marginBottom: "1.5rem" }}>
            How we are set up
          </h2>
          <div className="prose">
            <p>
              PLACEHOLDER — registered entity, company number, jurisdiction and
              where the team is based. Current delivery capacity and how larger
              work is staffed. Do not state a headcount unless it is accurate.
            </p>
            <p>
              <Link href="/how-we-work">Our process, engagement models and exit terms</Link>{" "}
              are published in full.
            </p>
          </div>
        </div>
      </section>

      <ContactCTA index="—" />
    </>
  );
}
