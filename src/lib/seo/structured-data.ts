import { siteConfig } from "@/config/site";
import { services, solutions, questions } from "@/content/site";
import type { Service } from "@/lib/content";

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
    // The registered company behind the brand.
    legalName: siteConfig.legal.entity,
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

export function faqPageNode(): Node {
  return {
    "@type": "FAQPage",
    "@id": `${siteConfig.url}/#faq`,
    // Same questions array the "Common questions" section renders, word for
    // word -- the markup must match what a visitor actually sees on the page.
    mainEntity: questions.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbNode(crumbs: { href: string; label: string }[]): Node {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: new URL(c.href, siteConfig.url).toString(),
    })),
  };
}

export function serviceNode(service: Service): Node {
  return {
    "@type": "Service",
    name: service.title,
    description: service.summary,
    serviceType: service.title,
    provider: { "@id": ORG_ID },
    url: new URL(`/services/${service.slug}`, siteConfig.url).toString(),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${service.title} capabilities`,
      itemListElement: service.subCapabilities.map((c) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: c.title },
      })),
    },
    // No `offers` with a price: none is published, and inventing one would be
    // both wrong and a rich-results violation.
  };
}

export function faqNode(items: { question: string; answer: string }[]): Node {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function graph(nodes: Node[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
