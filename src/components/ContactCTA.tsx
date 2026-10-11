import Link from "next/link";
import { MagneticButton } from "./MagneticButton";

type Props = {
  eyebrow?: string;
  heading?: string;
  lede?: string;
  index?: string;
};

/* The closing conversion band. Used at the foot of every page, which is why
   the copy is a prop: a service page should not end with the homepage's
   generic ask. */
export function ContactCTA({
  eyebrow = "Start a project",
  heading = "Tell us what is broken.",
  lede = "We will tell you what we would do about it — before you have paid us anything.",
  index = "06",
}: Props) {
  return (
    <section className="section" data-surface="dark" aria-labelledby="cta-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>
            {index}
          </span>
          <span className="u-eyebrow">{eyebrow}</span>
        </div>

        <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
          <div>
            <h2
              id="cta-heading"
              className="t-display-xl"
              data-reveal
              style={{ maxWidth: "14ch" }}
            >
              {heading}
            </h2>
            <p
              data-reveal
              data-reveal-delay={80}
              style={{
                marginTop: "1.5rem",
                color: "var(--color-text-muted)",
                maxWidth: "40ch",
                fontSize: "var(--text-body-lg)",
              }}
            >
              {lede}
            </p>
            <div data-reveal data-reveal-delay={160} style={{ marginTop: "2.5rem" }}>
              <MagneticButton href="/contact">Start a project</MagneticButton>
            </div>
          </div>

          <ol className="contact-steps">
            {[
              { n: "01", t: "Send a short brief", d: "Five minutes. What you are building, or what is broken." },
              { n: "02", t: "We reply within one business day", d: "From an engineer, with a real question or observation." },
              { n: "03", t: "A 30-minute technical call", d: "Free, no deck, no obligation." },
            ].map((s, i) => (
              <li key={s.n} data-reveal data-reveal-delay={i * 70}>
                <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>{s.n}</span>
                <h3 className="t-title-lg" style={{ margin: "0.5rem 0 0.4rem" }}>{s.t}</h3>
                <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>

        <p style={{ marginTop: "3rem" }}>
          <Link href="/how-we-work" className="link-quiet u-eyebrow">
            Or read how we work first &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}
