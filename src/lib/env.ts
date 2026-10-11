import { z } from "zod";

/* ----------------------------------------------------------------------------
   SERVER ENVIRONMENT

   The dangerous state is PARTIAL configuration: SMTP_HOST set but
   SMTP_PASSWORD missing means the app looks configured, starts cleanly, and
   then silently fails to deliver the first real enquiry. So:

   - Nothing configured  -> console transport, with a loud warning. Fine for
     local development, and obvious in logs that mail is not being sent.
   - Partially configured -> THROW. Caught at boot by instrumentation.ts,
     where a deploy health check sees the container fail and rolls back,
     rather than a week of lost leads.
   - Fully configured     -> use it.

   This single practice prevents the most costly category of deployment bug on
   a site whose only conversion mechanism is a form.
-------------------------------------------------------------------------------*/

const smtpSchema = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1),
  SMTP_PASSWORD: z.string().min(1),
  /** Defaults to true on 465 (implicit TLS), false otherwise (STARTTLS). */
  SMTP_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  /** Must be on a domain we control, or DMARC will reject it. */
  MAIL_FROM: z.email(),
  MAIL_FROM_NAME: z.string().min(1).default("SolutionMines"),
  CONTACT_RECIPIENT_EMAIL: z.email(),
});

const resendSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  MAIL_FROM: z.email(),
  MAIL_FROM_NAME: z.string().min(1).default("SolutionMines"),
  CONTACT_RECIPIENT_EMAIL: z.email(),
});

export type SmtpConfig = z.infer<typeof smtpSchema>;
export type ResendConfig = z.infer<typeof resendSchema>;

export type MailConfig =
  | { kind: "smtp"; config: SmtpConfig }
  | { kind: "resend"; config: ResendConfig }
  | { kind: "console" };

/** Keys that, if ANY are present, mean someone intended to configure mail. */
const MAIL_KEYS = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "CONTACT_RECIPIENT_EMAIL",
] as const;

function describe(error: z.ZodError): string {
  return error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export function resolveMailConfig(env = process.env): MailConfig {
  const intended = MAIL_KEYS.some((k) => {
    const v = env[k];
    return typeof v === "string" && v.trim().length > 0;
  });

  if (!intended) return { kind: "console" };

  // Resend wins when its key is present — that is the documented escape hatch
  // if the VPS IP turns out to have poor sending reputation.
  if (env.RESEND_API_KEY?.trim()) {
    const parsed = resendSchema.safeParse(env);
    if (!parsed.success) {
      throw new Error(
        `Email is partially configured for Resend. Set these or unset RESEND_API_KEY:\n${describe(parsed.error)}`,
      );
    }
    return { kind: "resend", config: parsed.data };
  }

  const parsed = smtpSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Email is partially configured for SMTP. Set these or unset the SMTP_* variables:\n${describe(parsed.error)}`,
    );
  }
  return { kind: "smtp", config: parsed.data };
}

let cached: MailConfig | undefined;

export function getMailConfig(): MailConfig {
  if (!cached) cached = resolveMailConfig();
  return cached;
}
