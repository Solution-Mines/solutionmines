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
  readonly kind: "smtp" | "resend" | "console";
  /** The enquiry notification to the team. Failure is user-visible. */
  notify(payload: EnquiryPayload): Promise<SendResult>;
  /** The acknowledgement to the enquirer. Best-effort; never blocks success. */
  acknowledge(payload: EnquiryPayload): Promise<SendResult>;
}

/* Strip CR/LF from any value interpolated into a mail header.

   Header injection is the specific attack a contact form invites: a newline
   in the "name" field can otherwise append arbitrary headers — a Bcc to a
   spam list, or a forged From. Nodemailer encodes most headers, but the
   display name we build ourselves must be sanitised before it gets there. */
export function sanitiseHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
