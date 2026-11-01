/* Single source of truth for site-wide constants.

   These appear in metadata, JSON-LD, the sitemap and the share image.
   Keeping them in one typed module prevents the classic bug where the old
   contact address survives in exactly one component. */

export const siteConfig = {
  name: "SolutionMines",
  /** PLACEHOLDER — replace with the live origin once the domain is confirmed.
   *  `.invalid` is reserved by RFC 2606 so it can never resolve by accident. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://solutionmines.invalid",
  /** The page title before the brand, in the words people search with:
   *  the headline says what we do in our own, and nobody types it. */
  tagline: "Custom software development & integrations",
  /** Under 160 characters, where a search result cuts a description off:
   *  the services by their searched-for names, and the reply commitment. */
  description:
    "Custom software development, API integrations and legacy modernization for growing businesses. An engineer replies within one business day.",
  email: "azariahjerish100@gmail.com",
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
