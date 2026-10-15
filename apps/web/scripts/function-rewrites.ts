import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import { webFunctions } from "../server/function-layout.js";
import {
  API_REWRITES_FILE,
  apiRewrites,
  apiRewritesPath,
  apiRewritesSource,
  rewritesDrifted,
} from "../server/function-rewrites.js";

/**
 * `--write` regenerates the committed table of `/api/` rewrites, which the
 * root `vercel.ts` imports, from the routes under `server/routes/`; `--check`
 * writes nothing and exits non-zero when the table is not what the routes
 * generate, in their order.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  throw new Error(`usage: function-rewrites.ts ${MODE.WRITE} | ${MODE.CHECK}`);
}

if (mode === MODE.WRITE) {
  await writeFile(apiRewritesPath(WEB), apiRewritesSource(apiRewrites(await webFunctions(WEB))));
}

if (await rewritesDrifted(WEB)) {
  console.error(`stale: ${API_REWRITES_FILE}`);
  console.error("run `pnpm --filter @luke/web functions:rewrites` to regenerate the rewrites");
  exit(1);
}
