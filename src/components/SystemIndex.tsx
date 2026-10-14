import Link from "next/link";
import { Console } from "./Console";
import { getConsoleData } from "@/lib/console/data";

/* ----------------------------------------------------------------------------
   THE INDEX — the signature section.

   Placed after Services deliberately. By this point a visitor knows what we
   claim to do; this is where they get to check it themselves rather than read
   another paragraph asserting it.

   It is also the answer to a real structural problem: the catalogue is small
   and will stay small for a while. Three engagements laid out as large cards
   read as "that is all there is". The same three behind a queryable index read
   as a catalogue with depth, because the interface implies a system rather
   than a list — and the interface is not a lie, since it is reading the actual
   content layer.

   A server component: it reads the seam, flattens to plain data, and hands
   that to the one client component on the page.
-------------------------------------------------------------------------------*/

export function SystemIndex() {
  const data = getConsoleData();

  return (
    <section className="section" data-surface="dark" aria-labelledby="index-heading">
      <div className="shell">
        <div className="section-head">
          <span className="u-eyebrow" style={{ color: "var(--color-accent)" }}>04</span>
          <span className="u-eyebrow">Look it up yourself</span>
        </div>

        <div className="sysindex__head">
          <h2 id="index-heading" className="t-display-lg" data-reveal>
            Ask the system.
          </h2>
          <p className="sysindex__lede" data-reveal>
            Everything on this site is one content layer, so it can be queried
            rather than browsed. Type <code>services</code>, or{" "}
            <code>open payment-reconciliation</code>, and the diagram redraws
            from the engagement you opened.{" "}
            {/* Hidden on touch: there is no keyboard to press, and promising a
                shortcut a visitor cannot use is worse than saying nothing. */}
            <span className="u-fine-only">
              Press <kbd className="console__kbd">⌘K</kbd> from anywhere on the
              page.
            </span>
          </p>
        </div>

        <Console data={data} />

        {/* The console is the fast path, never the only one. Everything it can
            reach is also here as plain, linked tables — which is what a
            visitor with JS disabled, a screen-reader user, or a crawler gets. */}
        <div className="sysindex__tables">
          <table className="sysindex__table">
            <caption>Services</caption>
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Service</th>
                <th scope="col">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {data.services.map((s) => (
                <tr key={s.slug}>
                  <td>
                    <Link href={`/services/${s.slug}`}>{s.slug}</Link>
                  </td>
                  <td>{s.title}</td>
                  <td>
                    {s.duration} · {s.model}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="sysindex__table">
            <caption>Engagements</caption>
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Engagement</th>
                <th scope="col">Client</th>
              </tr>
            </thead>
            <tbody>
              {data.work.map((w) => (
                <tr key={w.slug}>
                  <td>
                    <Link href={`/work/${w.slug}`}>{w.slug}</Link>
                  </td>
                  <td>{w.title}</td>
                  <td>{w.client}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
