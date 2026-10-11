/* Single source of truth for site-wide constants.

   These appear in metadata, JSON-LD, the footer, the sitemap and the nav.
   Keeping them in one typed module prevents the classic bug where the old
   contact address survives in exactly one component. */

export const siteConfig = {
  name: "SolutionMines",
  /** PLACEHOLDER — replace with the live origin once the domain is confirmed.
   *  `.invalid` is reserved by RFC 2606 so it can never resolve by accident. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://solutionmines.invalid",
  tagline: "Software engineering for growing businesses",
  description:
    "We design, build and maintain the software other businesses run on — for teams who need a product shipped properly, an integration that stops breaking, or a codebase someone else abandoned.",
  /** PLACEHOLDER — replace with the real monitored inbox. */
  email: "hello@solutionmines.example",
  responseCommitment: "a technical reply within one business day",
  /** PLACEHOLDER — add only profiles that actually exist and have content.
   *  An empty GitHub org is a negative trust signal, not a neutral one. */
  social: [] as { label: string; href: string }[],
  legal: {
    entity: "PLACEHOLDER — registered company name",
    number: "PLACEHOLDER — company number",
    address: "PLACEHOLDER — registered address",
  },
} as const;

export const mainNav = [
  { href: "/services", label: "Services" },
  { href: "/work", label: "Work" },
  { href: "/how-we-work", label: "How we work" },
  { href: "/about", label: "About" },
] as const;

export const footerNav = {
  Company: [
    { href: "/about", label: "About" },
    { href: "/how-we-work", label: "How we work" },
    { href: "/contact", label: "Start a project" },
  ],
  Services: [
    { href: "/services/product-engineering", label: "Product engineering" },
    { href: "/services/integrations", label: "Integrations" },
    { href: "/services/automation-data", label: "Automation & data" },
    { href: "/services/modernization", label: "Modernization" },
  ],
  Legal: [
    { href: "/privacy", label: "Privacy policy" },
    { href: "/terms", label: "Terms of use" },
  ],
} as const;
