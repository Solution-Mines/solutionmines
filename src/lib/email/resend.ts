import type { ResendConfig } from "@/lib/env";
import {
  sanitiseHeaderValue,
  type EmailTransport,
  type EnquiryPayload,
  type SendResult,
} from "./types";
import { internalNotification, acknowledgement } from "./templates";

/* Resend via its REST API, called with fetch.

   Deliberately no SDK: the API is one POST, and the dependency budget is
   better spent elsewhere. This exists as the documented escape hatch — a
   fresh VPS IP often has poor sending reputation, and switching to a managed
   sender with delivery logs should be an env var, not a refactor. */

const ENDPOINT = "https://api.resend.com/emails";

export function createResendTransport(config: ResendConfig): EmailTransport {
  const from = `${sanitiseHeaderValue(config.MAIL_FROM_NAME)} <${config.MAIL_FROM}>`;

  async function send(
    to: string,
    subject: string,
    text: string,
    replyTo?: string,
  ): Promise<SendResult> {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: sanitiseHeaderValue(subject),
          text,
          ...(replyTo ? { reply_to: [replyTo] } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          error: `Resend responded ${response.status}: ${body.slice(0, 200)}`,
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    kind: "resend",
    notify(payload: EnquiryPayload) {
      const { subject, text } = internalNotification(payload);
      return send(config.CONTACT_RECIPIENT_EMAIL, subject, text, payload.email);
    },
    acknowledge(payload: EnquiryPayload) {
      const { subject, text } = acknowledgement(payload);
      return send(payload.email, subject, text);
    },
  };
}
