import { siteConfig } from "@/config/site";
import type { CaseStudy, Service } from "@/lib/content";

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
    url: siteConfig.url,
    description: siteConfig.description,
    email: siteConfig.email,
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
    publisher: { "@id": ORG_ID },
    // No SearchAction: there is no on-site search, and claiming one that does
    // not exist is exactly the kind of markup Google penalises.
  };
}

export function breadcrumbNode(
  crumbs: { href: string; label: string }[],
): Node {
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

export function articleNode(study: CaseStudy): Node {
  return {
    "@type": "Article",
    headline: study.title.slice(0, 110),
    description: study.summary,
    datePublished: study.publishedAt,
    ...(study.updatedAt ? { dateModified: study.updatedAt } : {}),
    publisher: { "@id": ORG_ID },
    mainEntityOfPage: new URL(`/work/${study.slug}`, siteConfig.url).toString(),
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
