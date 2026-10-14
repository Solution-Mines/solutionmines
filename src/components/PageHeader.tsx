import Link from "next/link";

type Crumb = { href: string; label: string };

type Props = {
  eyebrow: string;
  title: string;
  lede?: string;
  crumbs?: Crumb[];
  meta?: { label: string; value: string }[];
  /** Mono annotation printed against the closing rule, like a document
   *  reference. Keep it short — it is a margin note, not a sentence. */
  note?: string;
};

/* ----------------------------------------------------------------------------
   PAGE MASTHEAD

   Previously a single left-aligned column, which on a 1440 viewport left the
   right half of every inner page empty and opened a large void before the
   first section. That emptiness was the main reason the inner pages read as
   unfinished next to the homepage.

   Now it is an editorial masthead: the headline holds the left column, the
   lede and any specification data face it on the right, and a closing rule
   with a mono reference marks where the masthead ends and the document
   begins. Same content, arranged like a printed page rather than stacked.

   The visible breadcrumb is required on service and case-study pages because
   the BreadcrumbList JSON-LD must mirror something a visitor can actually
   see — markup describing invisible content is a structured-data violation,
   not a shortcut.
-------------------------------------------------------------------------------*/
export function PageHeader({
  eyebrow,
  title,
  lede,
  crumbs,
  meta,
  note,
}: Props) {
  return (
    <section className="masthead" aria-labelledby="page-heading">
      <div className="shell">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="masthead__crumbs">
            <ol>
              {crumbs.map((c, i) => (
                <li key={c.href} className="u-eyebrow">
                  <Link href={c.href} className="link-quiet">
                    {c.label}
                  </Link>
                  {i < crumbs.length - 1 && <span aria-hidden="true">/</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="masthead__grid">
          <div className="masthead__lead">
            <p className="u-eyebrow masthead__eyebrow">{eyebrow}</p>
            <h1 id="page-heading" className="t-display-lg masthead__title">
              {title}
            </h1>
          </div>

          <div className="masthead__aside">
            {lede && <p className="masthead__lede">{lede}</p>}

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
        </div>

        <div className="masthead__rule" aria-hidden="true">
          <span>{note ?? eyebrow}</span>
        </div>
      </div>
    </section>
  );
}
