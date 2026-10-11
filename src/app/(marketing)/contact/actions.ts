"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { contactSchema, type ContactState } from "@/lib/validation/contact";
import { checkRateLimit, clientKeyFromHeaders } from "@/lib/rate-limit";
import { getTransport } from "@/lib/email";

/* Server Action for the enquiry form.

   Using an action rather than a fetch handler means the form still submits
   with JavaScript disabled, and Next applies its own origin check so we are
   not hand-rolling CSRF protection.

   Layered, zero-cost spam defence, in order:
     1. honeypot field
     2. time trap (< 3s between render and submit)
     3. per-IP rate limit
   A CAPTCHA is deliberately NOT here. A new domain receives effectively no
   targeted spam, and a third-party script on the highest-value page costs
   more in conversion than it saves. `verifyHuman` below is the seam for
   adding Turnstile later as an env var, not a refactor. */

const MIN_FILL_MS = 3000;

async function verifyHuman(): Promise<boolean> {
  // No-op until TURNSTILE_SECRET_KEY exists.
  if (!process.env.TURNSTILE_SECRET_KEY) return true;
  return true;
}

export async function submitEnquiry(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;

  // Echoed back on any failure so a rejection never discards a typed message.
  const values = {
    name: raw.name ?? "",
    email: raw.email ?? "",
    company: raw.company ?? "",
    service: raw.service ?? "",
    timeline: raw.timeline ?? "",
    message: raw.message ?? "",
  };

  const parsed = contactSchema.safeParse({
    ...raw,
    consent: raw.consent === "on" || raw.consent === "true",
  });

  if (!parsed.success) {
    const fieldErrors: ContactState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof fieldErrors;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors,
      values,
    };
  }

  const data = parsed.data;

  // 1. Honeypot — silently accept so a bot cannot learn it was caught.
  if (data.website) {
    redirect("/contact/received");
  }

  // 2. Time trap.
  if (data.renderedAt && Date.now() - data.renderedAt < MIN_FILL_MS) {
    return {
      status: "error",
      message: "That submitted unusually fast. Please try again.",
      values,
    };
  }

  // 3. Rate limit.
  const key = clientKeyFromHeaders(await headers());
  const limit = checkRateLimit(key);
  if (!limit.ok) {
    const minutes = Math.ceil(limit.retryAfterSeconds / 60);
    return {
      status: "error",
      message: `That is a few enquiries in a short time. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}, or email us directly.`,
      values,
    };
  }

  if (!(await verifyHuman())) {
    return { status: "error", message: "We could not verify that submission.", values };
  }

  const result = await getTransport().send({
    name: data.name,
    email: data.email,
    company: data.company || undefined,
    service: data.service,
    timeline: data.timeline,
    message: data.message,
  });

  if (!result.ok) {
    // The lead is already logged by the transport. Surface a direct route out
    // so our infrastructure failure does not cost the enquiry.
    return {
      status: "error",
      message:
        "Something went wrong on our side — nothing you wrote was lost. Try again, or email us directly.",
      values,
    };
  }

  redirect("/contact/received");
}
