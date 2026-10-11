import { z } from "zod";

/* ONE schema, two consumers.

   The client imports it for inline validation (UX); the Server Action imports
   it to re-validate independently (security). Because it is the same module,
   the two can never drift — which is the usual failure mode when client and
   server validation are written separately. */

export const SERVICE_OPTIONS = [
  "Not sure yet",
  "Product engineering",
  "API & systems integration",
  "Automation & data workflows",
  "Modernization & ongoing care",
] as const;

export const TIMELINE_OPTIONS = [
  "As soon as possible",
  "1–3 months",
  "3–6 months",
  "Exploring, no date yet",
] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Enter the email address you would like us to reply to")),
  company: z.string().trim().max(100).optional().or(z.literal("")),
  service: z.enum(SERVICE_OPTIONS).optional(),
  timeline: z.enum(TIMELINE_OPTIONS).optional(),
  /* The 20-character floor is the single most effective zero-cost filter here.
     It removes drive-by spam and simultaneously raises lead quality, because
     anyone willing to write two sentences is a materially better prospect. */
  message: z
    .string()
    .trim()
    .min(20, "A sentence or two about the problem helps us reply usefully")
    .max(5000),
  consent: z.literal(true, {
    message: "We need your permission to reply to this enquiry",
  }),
  /** Honeypot. Bots fill it; humans never see it.
   *  Deliberately NOT constrained to empty here. A `.max(0)` would make a
   *  filled honeypot fail schema validation, which returns a visible error —
   *  telling the bot exactly which field caught it. The action inspects this
   *  separately and responds with a silent success instead. */
  website: z.string().optional(),
  /** Form render time, for the time-trap. */
  renderedAt: z.coerce.number().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;

export type ContactState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<Record<keyof ContactInput, string>>;
  /** Echoed back so a server-side rejection never discards what was typed. */
  values?: Partial<Record<keyof ContactInput, string>>;
};
