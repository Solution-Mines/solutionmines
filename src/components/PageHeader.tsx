import Link from "next/link";

type Crumb = { href: string; label: string };

type Props = {
  eyebrow: string;
  title: string;
  lede?: string;
  crumbs?: Crumb[];
  meta?: { label: string; value: string }[];
};

/* Shared page masthead. The visible breadcrumb is required on service and
   case-study pages because the BreadcrumbList JSON-LD must mirror something
   the user can actually see — markup describing invisible content is a
   structured-data violation, not a shortcut. */
export function PageHeader({ eyebrow, title, lede, crumbs, meta }: Props) {
  return (
    <section
      className="section"
      style={{ paddingTop: "clamp(6.5rem, 5rem + 6vw, 9rem)", paddingBottom: 0 }}
      aria-labelledby="page-heading"
    >
      <div className="shell">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" style={{ marginBottom: "2rem" }}>
            <ol style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {crumbs.map((c, i) => (
                <li key={c.href} className="u-eyebrow" style={{ display: "flex", gap: "0.5rem" }}>
                  <Link href={c.href} className="link-quiet">{c.label}</Link>
                  {i < crumbs.length - 1 && <span aria-hidden="true">/</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <p className="u-eyebrow" style={{ marginBottom: "1.5rem", color: "var(--color-accent)" }}>
          {eyebrow}
        </p>

        <h1 id="page-heading" className="t-display-lg" style={{ maxWidth: "20ch" }}>
          {title}
        </h1>

        {lede && (
          <p
            style={{
              marginTop: "1.75rem",
              maxWidth: "52ch",
              fontSize: "var(--text-body-lg)",
              color: "var(--color-text-muted)",
              borderLeft: "1px solid var(--color-accent)",
              paddingLeft: "1.25rem",
            }}
          >
            {lede}
          </p>
        )}

        {meta && meta.length > 0 && (
          <dl className="page-meta">
            {meta.map((m) => (
              <div key={m.label}>
                <dt className="u-eyebrow">{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
