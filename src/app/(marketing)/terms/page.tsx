import { PageHeader } from "@/components/PageHeader";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/config/site";

export const metadata = buildMetadata({
  title: "Terms of use",
  description: "The terms governing use of this website.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Terms of use"
        lede="PLACEHOLDER — review before launch. These terms cover use of this website only, not the terms of any engagement, which are agreed separately in writing."
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/terms", label: "Terms" },
        ]}
      />
      <section className="section" aria-labelledby="terms-body">
        <div className="shell">
          <h2 id="terms-body" className="u-sr-only">Terms</h2>
          <div className="prose">
            <h2>About this site</h2>
            <p>
              This site is operated by {siteConfig.legal.entity}. Its content is
              provided for information and does not constitute an offer, a
              quotation, or professional advice on which you should rely without
              speaking to us.
            </p>

            <h2>Engagement terms are separate</h2>
            <p>
              Process descriptions, engagement models and any indicative figures
              on this site are illustrative. The terms of any actual engagement
              are set out in a separate written agreement, which takes
              precedence over anything here.
            </p>

            <h2>Case studies</h2>
            <p>
              Work described on this site is published with the relevant
              client&rsquo;s permission. Where an engagement is anonymised, names
              and identifying details have been removed or generalised at the
              client&rsquo;s request.
            </p>

            <h2>Intellectual property</h2>
            <p>
              Content on this site belongs to {siteConfig.legal.entity} unless
              stated otherwise. Typefaces are used under the SIL Open Font
              License 1.1.
            </p>

            <h2>Liability</h2>
            <p>PLACEHOLDER — confirm wording with counsel.</p>

            <h2>Governing law</h2>
            <p>PLACEHOLDER — confirm jurisdiction.</p>

            <h2>Contact</h2>
            <p>
              Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
