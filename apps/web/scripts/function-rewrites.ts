import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import {
  rewritesDrifted,
  VERCEL_CONFIG_FILE,
  vercelConfigSource,
} from "../server/function-rewrites.js";

/**
 * `--write` regenerates the `/api/` rewrites of `vercel.json` from the routes
 * under `server/routes/`; `--check` writes nothing and exits non-zero when the
 * committed rewrites are not the generated ones, in the generated order.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  throw new Error(`usage: function-rewrites.ts ${MODE.WRITE} | ${MODE.CHECK}`);
}

if (mode === MODE.WRITE) {
  await writeFile(join(WEB, VERCEL_CONFIG_FILE), await vercelConfigSource(WEB));
}

if (await rewritesDrifted(WEB)) {
  console.error(`stale: ${VERCEL_CONFIG_FILE} /api/ routes`);
  console.error("run `pnpm --filter @luke/web functions:rewrites` to regenerate the rewrites");
  exit(1);
}
