import { z } from "zod";

/* ----------------------------------------------------------------------------
   CONTENT SCHEMAS

   Zod is the single source of truth: the TypeScript type below is INFERRED
   from this schema, so a field can never drift between validation and types.

   Parsing happens at module load (see registry.ts), which means malformed
   frontmatter fails `next build` rather than rendering a half-populated page
   in production. That is deliberate — a service page missing its outcomes is
   worse than a build error.
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

export type Service = z.infer<typeof serviceSchema>;
