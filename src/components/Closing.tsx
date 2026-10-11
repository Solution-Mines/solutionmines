import { site } from "@/content/site";
import { MagneticButton } from "./MagneticButton";

/* Closing CTA + footer.

   The three-step sequence exists to remove the specific uncertainty that
   stops technical buyers contacting an unknown firm: what will this cost me
   to find out? Naming the time commitment at each step answers it.          */

const STEPS = [
  { n: "01", t: "Send a short brief", d: "Five minutes. What you are building, or what is broken." },
  { n: "02", t: "We reply within one business day", d: "From an engineer, with a real question or observation." },
  { n: "03", t: "A 30-minute technical call", d: "Free, no deck, no obligation." },
];

export function Closing() {
  return (
    <>
      <section className="section" id="contact" data-surface="dark" aria-labelledby="contact-heading">
        <div className="shell">
          <div className="section-head">
            <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>06</span>
            <span className="u-eyebrow">Start a project</span>
          </div>

          <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
            <div>
              <h2
                id="contact-heading"
                className="t-display-xl"
                data-reveal
                style={{ maxWidth: "14ch" }}
              >
                Tell us what is broken.
              </h2>
              <p
                data-reveal
                data-reveal-delay={80}
                style={{ marginTop: "1.5rem", color: "var(--color-text-muted)", maxWidth: "40ch", fontSize: "var(--text-body-lg)" }}
              >
                We will tell you what we would do about it — before you have
                paid us anything.
              </p>
              <div data-reveal data-reveal-delay={160} style={{ marginTop: "2.5rem" }}>
                <MagneticButton href={`mailto:${site.email}`}>
                  Start a project
                </MagneticButton>
              </div>
            </div>

            <ol className="contact-steps">
              {STEPS.map((s, i) => (
                <li key={s.n} data-reveal data-reveal-delay={i * 70}>
                  <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>{s.n}</span>
                  <h3 className="t-title-lg" style={{ margin: "0.5rem 0 0.4rem" }}>
                    {s.t}
                  </h3>
                  <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-body-sm)" }}>{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <footer data-surface="dark" style={{ backgroundColor: "var(--color-surface)", color: "var(--color-text-primary)" }}>
        <div className="shell" style={{ paddingBlock: "3rem", borderTop: "1px solid var(--color-hairline)" }}>
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="u-display" style={{ fontSize: "1.375rem", letterSpacing: "-0.02em" }}>
                SolutionMines<span style={{ color: "var(--color-accent)" }}>.</span>
              </p>
              <p className="u-eyebrow" style={{ marginTop: "0.75rem", color: "var(--color-text-subtle)" }}>
                PLACEHOLDER — registered entity, address and company number
              </p>
            </div>

            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <div>
                <p className="u-eyebrow" style={{ marginBottom: "0.75rem" }}>Contact</p>
                <a href={`mailto:${site.email}`} className="link-quiet" style={{ fontSize: "var(--text-body-sm)" }}>
                  {site.email}
                </a>
                <p className="u-eyebrow" style={{ marginTop: "0.5rem", color: "var(--color-text-subtle)" }}>
                  Placeholder address
                </p>
              </div>
              <div>
                <p className="u-eyebrow" style={{ marginBottom: "0.75rem" }}>Legal</p>
                <ul style={{ display: "grid", gap: "0.35rem", fontSize: "var(--text-body-sm)" }}>
                  <li><a href="#" className="link-quiet">Privacy policy</a></li>
                  <li><a href="#" className="link-quiet">Terms of use</a></li>
                </ul>
              </div>
            </div>
          </div>

          <p
            className="u-eyebrow"
            style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--color-hairline)", color: "var(--color-text-subtle)" }}
          >
            Visual prototype — not the production website. All content is placeholder.
          </p>
        </div>
      </footer>
    </>
  );
}
