import { getMailConfig } from "@/lib/env";

/* Health probe for the blue/green deploy.

   The deploy script polls this on the NEW container and only switches the
   nginx upstream once it returns 200 with the expected commit SHA — which is
   what catches the "deployed, but it's the old image" failure.

   It also reports the mail transport. A container that booted with mail
   unconfigured is serving, but it cannot deliver a lead, and that should be
   visible to monitoring rather than discovered from missing enquiries. */

export const dynamic = "force-dynamic";

export async function GET() {
  let mail: string;
  try {
    mail = getMailConfig().kind;
  } catch (error) {
    // Should be unreachable: instrumentation.ts fails the boot first.
    return Response.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    {
      status: "ok",
      commit: process.env.GIT_COMMIT_SHA ?? "unknown",
      mail,
      uptimeSeconds: Math.round(process.uptime()),
      at: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
