import { PageHeader } from "@/components/PageHeader";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/config/site";

export const metadata = buildMetadata({
  title: "Privacy policy",
  description:
    "What personal data this site collects, why, how long it is kept, and how to ask for it to be removed.",
  path: "/privacy",
});

/* This page creates legal obligations, so the body is deliberately a
   structured PLACEHOLDER rather than generic boilerplate. Shipping
   template privacy text that does not describe what the site actually does
   is worse than shipping nothing — it is a statement that happens to be
   false. The structure below is what counsel needs to fill in. */
export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        lede="PLACEHOLDER — this page must be reviewed by counsel before launch. The structure below reflects what the site actually does today."
        crumbs={[
          { href: "/", label: "Home" },
          { href: "/privacy", label: "Privacy" },
        ]}
      />
      <section className="section" aria-labelledby="privacy-body">
        <div className="shell">
          <h2 id="privacy-body" className="u-sr-only">Policy</h2>
          <div className="prose">
            <h2>What we collect</h2>
            <p>
              If you submit the enquiry form we receive the name, email address,
              company, service interest, timeline and message you provide.
              Nothing else on this site collects personal data.
            </p>

            <h2>Why we collect it</h2>
            <p>
              Solely to respond to your enquiry. We do not use it for marketing,
              and we do not sell or share it with third parties for their own
              purposes.
            </p>

            <h2>Lawful basis</h2>
            <p>
              PLACEHOLDER — confirm with counsel. The form asks for explicit
              consent, and the likely basis is consent and/or legitimate
              interest in responding to a business enquiry.
            </p>

            <h2>How long we keep it</h2>
            <p>PLACEHOLDER — state a specific retention period and stick to it.</p>

            <h2>Cookies and analytics</h2>
            <p>
              This build sets no cookies and runs no analytics. If privacy-first,
              cookieless analytics is added later, it will be stated here — and
              because it would set no cookies, no consent banner would be
              required.
            </p>

            <h2>Processors</h2>
            <p>
              PLACEHOLDER — list every third party that will touch enquiry data
              once email delivery is wired up: the mail provider, the hosting
              provider, and any form or spam-prevention service.
            </p>

            <h2>Your rights</h2>
            <p>
              PLACEHOLDER — confirm the applicable jurisdiction, then describe
              the right of access, correction, erasure and complaint, and name
              the supervisory authority.
            </p>

            <h2>Contact</h2>
            <p>
              Email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>{" "}
              for anything relating to this policy.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
