import { siteConfig } from "@/config/site";
import { services, solutions } from "@/content/site";

/* JSON-LD as ONE consolidated @graph per page, with stable @id values so
   entities reference each other instead of being duplicated.

   Deliberately omitted everywhere: aggregateRating, review, numberOfEmployees
   and award. None of them can be evidenced for this company, and an
   aggregateRating without real on-page reviews is a manual-action risk, not
   just an inaccuracy. */

const ORG_ID = `${siteConfig.url}/#organization`;
const SITE_ID = `${siteConfig.url}/#website`;

type Node = Record<string, unknown>;

export function organizationNode(): Node {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: siteConfig.name,
    alternateName: siteConfig.alternateName,
    url: siteConfig.url,
    // The pickaxe, at 180px: Google takes a logo from 112px square up.
    logo: `${siteConfig.url}/apple-icon.png`,
    description: siteConfig.description,
    email: siteConfig.email,
    // The services the page describes, by the same names and in the same words.
    makesOffer: services.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s.name, description: s.body },
    })),
    // The tags under the services: the wider kinds of work, as topics.
    knowsAbout: solutions,
    ...(siteConfig.social.length > 0
      ? { sameAs: siteConfig.social.map((s) => s.href) }
      : {}),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "sales",
      email: siteConfig.email,
      availableLanguage: "English",
    },
  };
}

export function websiteNode(): Node {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: siteConfig.url,
    name: siteConfig.name,
    // Google's site-name markup: the name a result is labelled with, and
    // the other spelling that means the same site.
    alternateName: siteConfig.alternateName,
    publisher: { "@id": ORG_ID },
    // No SearchAction: there is no on-site search, and claiming one that does
    // not exist is exactly the kind of markup Google penalises.
  };
}

export function graph(nodes: Node[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
