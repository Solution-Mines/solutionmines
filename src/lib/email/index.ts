import { siteConfig } from "@/config/site";

/* Email transport behind an adapter.

   Phase 1 ships the console transport only: this build has no SMTP
   credentials and should not pretend to deliver mail. The interface is what
   matters — swapping in Nodemailer or Resend is a new file plus an env var,
   not a refactor of the Server Action.

   Deliverability note for whoever wires this up: send FROM an address on our
   own domain with SPF, DKIM and DMARC configured, and set Reply-To to the
   enquirer. Sending FROM the enquirer's address fails DMARC and lands in
   spam — the most common cause of "the contact form doesn't work". */

export type EnquiryPayload = {
  name: string;
  email: string;
  company?: string;
  service?: string;
  timeline?: string;
  message: string;
  sourcePath?: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export interface EmailTransport {
  send(payload: EnquiryPayload): Promise<SendResult>;
}

/** Strip CR/LF from anything interpolated into a mail header.
 *  Header injection is the specific attack this endpoint invites. */
export function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const consoleTransport: EmailTransport = {
  async send(payload) {
    // Structured JSON to stdout. On the server this reaches the journal, so a
    // delivery outage never silently destroys a lead.
    console.log(
      JSON.stringify({
        event: "enquiry.received",
        to: siteConfig.email,
        at: new Date().toISOString(),
        payload: {
          ...payload,
          name: sanitiseHeaderValue(payload.name),
          email: sanitiseHeaderValue(payload.email),
        },
      }),
    );
    return { ok: true };
  },
};

export function getTransport(): EmailTransport {
  // When SMTP_HOST / RESEND_API_KEY are introduced, select here.
  return consoleTransport;
}
