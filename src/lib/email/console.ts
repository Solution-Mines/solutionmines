import { siteConfig } from "@/config/site";
import {
  sanitiseHeaderValue,
  type EmailTransport,
  type EnquiryPayload,
  type SendResult,
} from "./types";
import { internalNotification, acknowledgement } from "./templates";

/* Development fallback. Also the audit trail: every enquiry is written as
   structured JSON to stdout regardless of transport, so a delivery outage
   can never silently destroy a lead. */

function log(event: string, to: string, subject: string, payload: EnquiryPayload) {
  console.log(
    JSON.stringify({
      event,
      to,
      subject,
      at: new Date().toISOString(),
      payload: {
        ...payload,
        name: sanitiseHeaderValue(payload.name),
        email: sanitiseHeaderValue(payload.email),
      },
    }),
  );
}

export function createConsoleTransport(): EmailTransport {
  return {
    kind: "console",
    async notify(payload): Promise<SendResult> {
      const { subject } = internalNotification(payload);
      log("enquiry.received", siteConfig.email, subject, payload);
      return { ok: true };
    },
    async acknowledge(payload): Promise<SendResult> {
      const { subject } = acknowledgement(payload);
      log("enquiry.acknowledged", payload.email, subject, payload);
      return { ok: true };
    },
  };
}
