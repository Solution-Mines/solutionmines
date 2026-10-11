import Link from "next/link";
import { siteConfig, footerNav } from "@/config/site";

export function Footer() {
  return (
    <footer
      data-surface="dark"
      style={{
        backgroundColor: "var(--color-surface)",
        color: "var(--color-text-primary)",
      }}
    >
      <div
        className="shell"
        style={{ paddingBlock: "4rem", borderTop: "1px solid var(--color-hairline)" }}
      >
        <div className="grid gap-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href="/" className="t-title-lg link-quiet">
              SolutionMines<span style={{ color: "var(--color-accent)" }}>.</span>
            </Link>
            <p
              style={{
                marginTop: "1rem",
                color: "var(--color-text-muted)",
                fontSize: "var(--text-body-sm)",
                maxWidth: "34ch",
              }}
            >
              {siteConfig.tagline}.
            </p>
            <a
              href={`mailto:${siteConfig.email}`}
              className="link-quiet"
              style={{
                display: "inline-block",
                marginTop: "1.25rem",
                fontSize: "var(--text-body-sm)",
                textDecoration: "underline",
                textUnderlineOffset: "0.2em",
              }}
            >
              {siteConfig.email}
            </a>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {Object.entries(footerNav).map(([heading, links]) => (
              <nav key={heading} aria-label={heading}>
                <h2 className="u-eyebrow" style={{ marginBottom: "1rem" }}>
                  {heading}
                </h2>
                <ul style={{ display: "grid", gap: "0.6rem" }}>
                  {links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="link-quiet"
                        style={{ fontSize: "var(--text-body-sm)" }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: "3.5rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid var(--color-hairline)",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem 2rem",
            justifyContent: "space-between",
          }}
        >
          <p className="u-eyebrow" style={{ color: "var(--color-text-subtle)" }}>
            {siteConfig.legal.entity} &middot; {siteConfig.legal.number}
          </p>
          <p className="u-eyebrow" style={{ color: "var(--color-text-subtle)" }}>
            Prototype build &middot; all content is placeholder
          </p>
        </div>
      </div>
    </footer>
  );
}
