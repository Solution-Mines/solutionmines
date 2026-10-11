import nodemailer, { type Transporter } from "nodemailer";
import type { SmtpConfig } from "@/lib/env";
import {
  sanitiseHeaderValue,
  type EmailTransport,
  type EnquiryPayload,
  type SendResult,
} from "./types";
import { internalNotification, acknowledgement } from "./templates";

/* SMTP via the client's own mailbox.

   This is the default because it introduces no third-party dependency and no
   recurring cost, which was an explicit constraint.

   Deliverability rules encoded here:
   - FROM is always an address on our own domain. Sending FROM the enquirer's
     address is the single most common cause of "the contact form doesn't
     work": it fails DMARC and lands in spam.
   - REPLY-TO is the enquirer, so hitting reply in the notification just works.
   - The display name is sanitised before it reaches a header.             */

let transporter: Transporter | undefined;

function getTransporter(config: SmtpConfig): Transporter {
  if (transporter) return transporter;

  // Pooled: a marketing site sends few messages, but reusing the connection
  // avoids a TLS handshake per enquiry and keeps submit latency low.
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE ?? config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return transporter;
}

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  const from = {
    name: sanitiseHeaderValue(config.MAIL_FROM_NAME),
    address: config.MAIL_FROM,
  };

  async function send(
    to: string,
    subject: string,
    text: string,
    replyTo?: { name: string; address: string },
  ): Promise<SendResult> {
    try {
      await getTransporter(config).sendMail({
        from,
        to,
        subject: sanitiseHeaderValue(subject),
        text,
        ...(replyTo
          ? {
              replyTo: {
                name: sanitiseHeaderValue(replyTo.name),
                address: replyTo.address,
              },
            }
          : {}),
      });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    kind: "smtp",
    notify(payload: EnquiryPayload) {
      const { subject, text } = internalNotification(payload);
      return send(config.CONTACT_RECIPIENT_EMAIL, subject, text, {
        name: payload.name,
        address: payload.email,
      });
    },
    acknowledge(payload: EnquiryPayload) {
      const { subject, text } = acknowledgement(payload);
      return send(payload.email, subject, text);
    },
  };
}
