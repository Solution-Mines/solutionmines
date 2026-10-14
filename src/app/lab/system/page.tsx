import Link from "next/link";
import "./system.css";
import { LabScope } from "@/components/lab/LabScope";
import {
  SystemConsole,
  type SysService,
  type SysWork,
} from "@/components/lab/SystemConsole";
import { getServices, getCaseStudies, clientLabel } from "@/lib/content";

export const metadata = {
  title: "04 — Live system",
};

export default function SystemPage() {
  /* Flattened at the server boundary rather than passing MDX entries through:
     the console only ever needs plain data, and keeping the component prop
     serialisable keeps it honest about what it is. */
  const services: SysService[] = getServices().map(({ data }) => ({
    slug: data.slug,
    title: data.title,
    summary: data.summary,
    outcomes: data.outcomes,
    tech: (data.technologies ?? []).map((t) => t.name),
    duration: data.engagement.duration,
    model: data.engagement.model,
  }));

  const work: SysWork[] = getCaseStudies().map(({ data }) => ({
    slug: data.slug,
    title: data.title,
    summary: data.summary,
    client: clientLabel(data.client),
    tech: data.technologies,
    metrics: (data.metrics ?? []).map((m) => ({
      label: m.label,
      value: m.value,
    })),
    diagram: data.diagram,
  }));

  return (
    <LabScope className="sys-scope">
      <div className="sys">
        <section className="sys-hero">
          <div>
            <p className="sys-hero__status">
              <span>
                status <b>operational</b>
              </span>
              <span>
                services <b>{services.length}</b>
              </span>
              <span>
                engagements <b>{work.length}</b>
              </span>
              <span>
                reply <b>&lt; 1 business day</b>
              </span>
            </p>

            <h1>Query us the way you would query a system.</h1>

            <p className="sys-hero__lede">
              We design, build and maintain the software other businesses run
              on. This page is driven by commands rather than by scrolling —
              every answer below is read from the same content the rest of the
              site is built from, and the topology redraws itself as you open
              things.
            </p>

            <p className="sys-hero__keys">
              Press <kbd className="sys-kbd">⌘K</kbd> anywhere, or just start
              typing in the console.
            </p>
          </div>

          <SystemConsole services={services} work={work} />
        </section>

        <section className="sys-sec" aria-labelledby="sys-index">
          <h2 id="sys-index">Full index</h2>
          <p className="sys-sec__lede">
            Everything the console can reach, rendered as plain tables. The
            command line is the fast path, not the only one — nothing here is
            reachable solely by typing.
          </p>

          <table className="sys-table">
            <caption>Services</caption>
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Service</th>
                <th scope="col">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
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

          <table className="sys-table">
            <caption>Engagements</caption>
            <thead>
              <tr>
                <th scope="col">Slug</th>
                <th scope="col">Engagement</th>
                <th scope="col">Client</th>
              </tr>
            </thead>
            <tbody>
              {work.map((w) => (
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
        </section>
      </div>
    </LabScope>
  );
}
