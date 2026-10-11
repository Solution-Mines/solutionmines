import { z } from "zod";

/* ----------------------------------------------------------------------------
   CONTENT SCHEMAS

   Zod is the single source of truth: the TypeScript types below are INFERRED
   from these schemas, so a field can never drift between validation and types.

   Parsing happens at module load (see registry.ts), which means malformed
   frontmatter fails `next build` rather than rendering a half-populated page
   in production. That is deliberate — a case study missing its outcome is
   worse than a build error.

   Field choices worth defending:
   - `client.anonymised` exists because a firm moving on from freelance work
     often cannot name its best references. Retrofitting this later would mean
     re-editing every file.
   - `heroImage` carries mandatory width/height. This is the primary defence
     against layout shift, and making it optional guarantees someone forgets.
   - `metrics[].context` exists because an uncontextualised percentage reads as
     marketing noise to the technical buyer this site is aimed at.
-------------------------------------------------------------------------------*/

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

const seo = z
  .object({
    title: z.string().max(70).optional(),
    description: z.string().min(50).max(165).optional(),
    noindex: z.boolean().optional(),
  })
  .optional();

export const serviceSchema = z.object({
  slug,
  title: z.string().min(3),
  shortTitle: z.string().optional(),
  /** Doubles as the meta-description fallback, hence the length bounds. */
  summary: z.string().min(60).max(200),
  order: z.number().int(),
  featured: z.boolean(),
  /** The commercially load-bearing field: outcomes, not features. */
  outcomes: z.array(z.string()).min(3).max(6),
  subCapabilities: z
    .array(z.object({ title: z.string(), body: z.string().min(40) }))
    .min(3)
    .max(6),
  technologies: z
    .array(z.object({ name: z.string(), rationale: z.string() }))
    .optional(),
  engagement: z.object({
    duration: z.string(),
    model: z.enum(["project", "retainer", "consulting", "managed"]),
    /** Free text, not a number — pricing copy is rarely a clean integer. */
    band: z.string().optional(),
  }),
  symptoms: z.array(z.string()).min(2).max(4),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).max(6),
  relatedServices: z.array(slug).default([]),
  seo,
  updatedAt: z.string().optional(),
  draft: z.boolean().default(false),
});

export const caseStudySchema = z.object({
  slug,
  title: z.string().min(6),
  kind: z.enum(["case-study", "build", "open-source", "teardown"]),
  client: z.object({
    name: z.string(),
    industry: z.string(),
    size: z.string().optional(),
    /** When true the UI renders the descriptor, never the name. */
    anonymised: z.boolean(),
  }),
  summary: z.string().min(60).max(200),
  /** width/height are mandatory: this is the CLS defence. */
  heroImage: z
    .object({
      src: z.string(),
      alt: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  /** Foreign keys into the services collection; validated in registry.ts. */
  services: z.array(slug).min(1),
  challenge: z.string().min(80),
  approach: z.string().min(80),
  outcome: z.string().min(60),
  decisions: z
    .array(
      z.object({
        title: z.string(),
        chose: z.string(),
        tradeoff: z.string(),
      }),
    )
    .max(4)
    .default([]),
  metrics: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        context: z.string().optional(),
      }),
    )
    .max(4)
    .default([]),
  technologies: z.array(z.string()).min(1),
  duration: z.string().optional(),
  retrospective: z.string().optional(),
  externalUrl: z.string().url().optional(),
  featured: z.boolean(),
  order: z.number().int(),
  seo,
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  draft: z.boolean().default(false),
});

export type Service = z.infer<typeof serviceSchema>;
export type CaseStudy = z.infer<typeof caseStudySchema>;
