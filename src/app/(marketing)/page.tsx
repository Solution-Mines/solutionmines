import { Hero } from "@/components/Hero";
import { Situations } from "@/components/Situations";
import { Commitments } from "@/components/Commitments";
import { Services } from "@/components/Services";
import { DeliverySpine } from "@/components/DeliverySpine";
import { Work } from "@/components/Work";
import { ContactCTA } from "@/components/ContactCTA";
import { StructuredData } from "@/components/StructuredData";
import { graph, organizationNode, websiteNode } from "@/lib/seo/structured-data";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteConfig } from "@/config/site";
import { getFeaturedServices, getFeaturedCaseStudies } from "@/lib/content";

export const metadata = buildMetadata({
  title: siteConfig.tagline,
  description: siteConfig.description,
  path: "/",
});

/* ----------------------------------------------------------------------------
   HOMEPAGE — narrative order

   Deliberately NOT hero -> feature cards -> about -> testimonials -> contact.
   That pattern front-loads CLAIMS and back-loads PROOF, and for a company
   without a public track record the proof section would be empty — leaving a
   page that is entirely assertion.

   This inverts it:
     1 Positioning     — what we do, in a sentence someone could repeat
     2 Recognition     — we understand your situation (buys the attention)
     3 Trust           — verifiable, falsifiable commitments (the dark band)
     4 Services        — what we do, once credibility is accepted
     5 The spine       — how the work runs, with artifacts (signature section)
     6 Proof           — read as instances of the stated method
     7 Convert         — with the cost of a first conversation made explicit

   Section 3 before 4 is intentional. Differentiation only lands once a visitor
   accepts you as credible; reversed, it reads as boasting.

   Services and work come from the content layer, so the homepage can never
   drift out of sync with the detail pages.
-------------------------------------------------------------------------------*/

export default function Home() {
  const services = getFeaturedServices();
  const work = getFeaturedCaseStudies(4);

  return (
    <>
      <StructuredData data={graph([organizationNode(), websiteNode()])} />
      <Hero />
      <Situations />
      <Commitments />
      <Services services={services} />
      <DeliverySpine />
      <Work items={work} />
      <ContactCTA />
    </>
  );
}
