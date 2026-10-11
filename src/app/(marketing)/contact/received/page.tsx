import Link from "next/link";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/config/site";

/* noindex: a thank-you page has no search value and would dilute the site's
   topical focus. It needs its own URL so the conversion can be tracked. */
export const metadata = buildMetadata({
  title: "Enquiry received",
  description: "Thank you — your enquiry has reached us.",
  path: "/contact/received",
  noindex: true,
});

export default function ReceivedPage() {
  return (
    <section
      className="section"
      style={{ paddingTop: "clamp(8rem, 6rem + 8vw, 12rem)", minHeight: "70vh" }}
      aria-labelledby="received-heading"
    >
      <div className="shell">
        <p className="u-eyebrow" style={{ color: "var(--color-accent)", marginBottom: "1.5rem" }}>
          Enquiry received
        </p>
        <h1 id="received-heading" className="t-display-lg" style={{ maxWidth: "18ch" }}>
          That is with us.
        </h1>
        <p
          style={{
            marginTop: "1.75rem",
            maxWidth: "48ch",
            fontSize: "var(--text-body-lg)",
            color: "var(--color-text-muted)",
            borderLeft: "1px solid var(--color-accent)",
            paddingLeft: "1.25rem",
          }}
        >
          You will get a reply within one business day, from an engineer, with a
          real question or observation about what you described.
        </p>

        <p style={{ marginTop: "2rem", color: "var(--color-text-subtle)", fontSize: "var(--text-body-sm)", maxWidth: "48ch" }}>
          If it has not arrived, check your spam folder and then email us
          directly at{" "}
          <a href={`mailto:${siteConfig.email}`} className="link-quiet" style={{ textDecoration: "underline" }}>
            {siteConfig.email}
          </a>
          .
        </p>

        <div style={{ marginTop: "3rem", display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
          <Link href="/how-we-work" className="link-quiet u-eyebrow">How we work &rarr;</Link>
          <Link href="/work" className="link-quiet u-eyebrow">Selected work &rarr;</Link>
          <Link href="/" className="link-quiet u-eyebrow">Back to home &rarr;</Link>
        </div>
      </div>
    </section>
  );
}
