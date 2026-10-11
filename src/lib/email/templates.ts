import { siteConfig } from "@/config/site";
import type { EnquiryPayload } from "./types";

/* Plain text on purpose.

   A designed, branded HTML template directly undermines the promise this site
   makes — that a person replies, not a marketing system. The acknowledgement
   should read like the first line of a real conversation, because the next
   message in the thread will be exactly that.

   Both messages are text/plain, which also sidesteps HTML-injection risk in
   the recipient's mail client entirely. */

const rule = "-".repeat(56);

export function internalNotification(p: EnquiryPayload) {
  const lines = [
    `New enquiry via ${siteConfig.name}`,
    rule,
    `Name:     ${p.name}`,
    `Email:    ${p.email}`,
    p.company ? `Company:  ${p.company}` : null,
    p.service ? `Service:  ${p.service}` : null,
    p.timeline ? `Timeline: ${p.timeline}` : null,
    p.sourcePath ? `Page:     ${p.sourcePath}` : null,
    rule,
    "",
    p.message,
    "",
    rule,
    `Reply directly to this email to respond to ${p.name}.`,
    `Commitment: ${siteConfig.responseCommitment}.`,
  ].filter(Boolean);

  return {
    subject: `Enquiry — ${p.name}${p.company ? ` (${p.company})` : ""}`,
    text: lines.join("\n"),
  };
}

export function acknowledgement(p: EnquiryPayload) {
  const firstName = p.name.trim().split(/\s+/)[0] || p.name;

  const text = [
    `Hi ${firstName},`,
    "",
    "Thanks — your message reached us and it is with a person, not a queue.",
    "",
    `You will get a proper reply within one business day. It will come from an`,
    `engineer and it will contain an actual question or observation about what`,
    `you described, rather than a link to a calendar.`,
    "",
    "For reference, here is what you sent:",
    "",
    p.message
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n"),
    "",
    "If anything changed in the meantime, just reply to this email.",
    "",
    `— ${siteConfig.name}`,
    `  ${siteConfig.url}`,
  ].join("\n");

  return {
    subject: `We have your message — ${siteConfig.name}`,
    text,
  };
}
