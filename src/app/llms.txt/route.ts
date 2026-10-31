import { site, stages, commitments, PLACEHOLDER } from "@/content/site";
import { siteConfig } from "@/config/site";

/* /llms.txt: the site in plain words, for the language models that read the
   web on people's behalf (the llmstxt.org convention). Written from the same
   copy the journey shows, and filtered the same way, so it can never say
   anything the page does not. Built once, at build time. */
export const dynamic = "force-static";

export function GET() {
  const lines = [
    `# ${site.name}`,
    "",
    `> ${site.positioning.join(" ")} ${site.qualifier}`,
    "",
    `What we do: ${site.capabilities.join(", ")}.`,
    "",
    "## How the work runs",
    "",
    ...stages.map((s) => `- ${s.index} ${s.name}: ${s.body} You receive: ${s.artifact}.`),
    "",
    "## Commitments",
    "",
    ...commitments
      .filter((c) => !c.body.startsWith(PLACEHOLDER))
      .map((c) => `- ${c.title}: ${c.body}`),
    "",
    "## Contact",
    "",
    `- Email: ${site.email}, for ${site.responseCommitment}`,
    `- Site: ${new URL("/", siteConfig.url).toString()}`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
