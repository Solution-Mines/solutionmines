/* Runs once when the server starts, before it accepts traffic.

   Validating mail configuration here means a partially-configured deployment
   crashes at boot — where the deploy script's health check catches it and
   rolls back — instead of accepting enquiries it cannot deliver. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getMailConfig } = await import("@/lib/env");
  const config = getMailConfig();

  if (config.kind === "console") {
    console.warn(
      "[mail] No email transport configured. Enquiries will be logged to stdout only. " +
        "Set SMTP_* (or RESEND_API_KEY) before accepting real traffic.",
    );
  } else {
    console.log(`[mail] transport=${config.kind} ready`);
  }
}
