import "server-only";

import { getMailConfig } from "@/lib/env";
import { createSmtpTransport } from "./smtp";
import { createResendTransport } from "./resend";
import { createConsoleTransport } from "./console";
import type { EmailTransport, EnquiryPayload } from "./types";

export type { EnquiryPayload, SendResult, EmailTransport } from "./types";
export { sanitiseHeaderValue } from "./types";

let transport: EmailTransport | undefined;

export function getTransport(): EmailTransport {
  if (transport) return transport;

  const config = getMailConfig();
  transport =
    config.kind === "smtp"
      ? createSmtpTransport(config.config)
      : config.kind === "resend"
        ? createResendTransport(config.config)
        : createConsoleTransport();

  return transport;
}

/* Delivering an enquiry is two messages with different failure semantics.

   The internal notification is the lead. If it fails, the submission failed
   and the visitor must be told, with a direct mailto as a way out.

   The acknowledgement is a courtesy. If it fails — a typo'd address, a
   recipient server rejecting us — the lead is already safely delivered, so
   failing the whole submission would turn a minor problem into a lost
   customer. It is logged and swallowed.

   Either way the full payload is written to stdout first, so the enquiry
   survives even a total mail outage. */
export async function deliverEnquiry(payload: EnquiryPayload): Promise<
  { ok: true; acknowledged: boolean } | { ok: false; error: string }
> {
  const active = getTransport();

  // Audit trail first. If everything downstream fails, this is the record.
  if (active.kind !== "console") {
    console.log(
      JSON.stringify({
        event: "enquiry.received",
        transport: active.kind,
        at: new Date().toISOString(),
        payload,
      }),
    );
  }

  const notified = await active.notify(payload);
  if (!notified.ok) {
    console.error(
      JSON.stringify({
        event: "enquiry.notify_failed",
        transport: active.kind,
        at: new Date().toISOString(),
        error: notified.error,
        payload,
      }),
    );
    return { ok: false, error: notified.error };
  }

  const acked = await active.acknowledge(payload);
  if (!acked.ok) {
    console.warn(
      JSON.stringify({
        event: "enquiry.ack_failed",
        transport: active.kind,
        at: new Date().toISOString(),
        error: acked.error,
        to: payload.email,
      }),
    );
  }

  return { ok: true, acknowledged: acked.ok };
}
