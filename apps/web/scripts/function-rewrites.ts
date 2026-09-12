import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import { webFunctions } from "../server/function-layout.js";
import {
  API_REWRITES_FILE,
  apiRewrites,
  apiRewritesSource,
  rewritesDrifted,
  VERCEL_CONFIG_FILE,
  vercelConfigSource,
} from "../server/function-rewrites.js";

/**
 * `--write` regenerates the committed table of `/api/` rewrites from the
 * routes under `server/routes/`, then assembles `vercel.json` from the table;
 * `--check` writes nothing and exits non-zero when the table is not what the
 * routes generate or `vercel.json`'s `/api/` entries are not the table, in
 * its order.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  throw new Error(`usage: function-rewrites.ts ${MODE.WRITE} | ${MODE.CHECK}`);
}

if (mode === MODE.WRITE) {
  await writeFile(
    join(WEB, API_REWRITES_FILE),
    apiRewritesSource(apiRewrites(await webFunctions(WEB))),
  );
  await writeFile(join(WEB, VERCEL_CONFIG_FILE), await vercelConfigSource(WEB));
}

if (await rewritesDrifted(WEB)) {
  console.error(`stale: ${API_REWRITES_FILE} or the /api/ routes of ${VERCEL_CONFIG_FILE}`);
  console.error("run `pnpm --filter @luke/web functions:rewrites` to regenerate the rewrites");
  exit(1);
}
