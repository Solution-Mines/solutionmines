import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";

/* `next build` with output:"standalone" traces dependencies into
   .next/standalone, but deliberately does NOT copy static assets — the
   expectation is that a CDN serves them. We self-host behind nginx, so they
   have to be placed next to the server or every page loads unstyled.

   Running this after a build produces a directory that can be shipped as-is
   and started with `node server.js`, with no node_modules install. */

const exists = async (p) =>
  access(p, constants.F_OK).then(() => true).catch(() => false);

if (!(await exists(".next/standalone"))) {
  console.error(
    'No .next/standalone directory. Run `pnpm build` first, with output: "standalone" in next.config.ts.',
  );
  process.exit(1);
}

await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
console.log("copied .next/static");

if (await exists("public")) {
  await cp("public", ".next/standalone/public", { recursive: true });
  console.log("copied public");
}

console.log("standalone bundle ready: node .next/standalone/server.js");
