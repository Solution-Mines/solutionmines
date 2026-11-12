/* Single source of truth for site-wide constants.

   These appear in metadata, JSON-LD, the sitemap and the share image.
   Keeping them in one typed module prevents the classic bug where the old
   contact address survives in exactly one component. */

export const siteConfig = {
  name: "SolutionMines",
  /** The name as two words, the way the island's block letters and the sign
   *  at the mine spell it, and the way people type it into a search box --
   *  where Google, not knowing the one-word brand yet, corrects
   *  "solutionmines" to "solution means". Declared as the same company. */
  alternateName: "Solution Mines",
  /** PLACEHOLDER — replace with the live origin once the domain is confirmed.
   *  `.invalid` is reserved by RFC 2606 so it can never resolve by accident. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://solutionmines.invalid",
  /** The page title before the brand, in the words people search with:
   *  the headline says what we do in our own, and nobody types it. */
  tagline: "Website development & custom software",
  /** Under 160 characters, where a search result cuts a description off:
   *  the services by their searched-for names, and the reply commitment. */
  description:
    "Website development with admin portals, custom software and API integrations for brands and growing businesses. An engineer replies within one business day.",
  email: "hello@solutionmines.com",
  responseCommitment: "a technical reply within one business day",
  /** The company's own profiles elsewhere, which the JSON-LD names as the
   *  same organization (sameAs). Add only profiles that actually exist and
   *  have content: an empty GitHub org is a negative trust signal, not a
   *  neutral one. */
  social: [
    // The company's own page, under its registered name (2026-11-05) --
    // not linkedin.com/company/solutionmines, which is another company's.
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/company/solution-mines-technology-private-limited",
    },
  ] as { label: string; href: string }[],
  /** The registered company behind the name, as the founder gave it
   *  (2026-11-05). The number and address are not confirmed: they stay
   *  PLACEHOLDER and appear nowhere. */
  legal: {
    entity: "Solution Mines Technology Private Limited",
    number: "PLACEHOLDER — company number",
    address: "PLACEHOLDER — registered address",
  },
} as const;
