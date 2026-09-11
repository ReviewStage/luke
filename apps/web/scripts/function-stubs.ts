import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import {
  rewritesDrifted,
  VERCEL_CONFIG_FILE,
  vercelConfigSource,
} from "../server/function-rewrites.js";
import {
  STUB_DRIFT,
  stubDirectory,
  stubDrift,
  stubPath,
  stubSource,
  webFunctions,
} from "../server/function-stubs.js";

/**
 * `--write` generates the committed `api/*.js` stub for every function and
 * the `/api/` rewrites of `vercel.json`; `--check` lists every stub that is
 * missing, stale, or has no function behind it, says when the rewrites have
 * drifted, and exits non-zero. Both refuse an orphan rather than deleting it:
 * a file under `api/` that nothing generates is a decision for the developer,
 * since Vercel would deploy it as a function.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  throw new Error(`usage: function-stubs.ts ${MODE.WRITE} | ${MODE.CHECK}`);
}

if (mode === MODE.WRITE) {
  for (const definition of await webFunctions(WEB)) {
    await mkdir(stubDirectory(WEB, definition), { recursive: true });
    await writeFile(join(WEB, stubPath(definition)), stubSource(definition));
  }
  await writeFile(join(WEB, VERCEL_CONFIG_FILE), await vercelConfigSource(WEB));
}

const drift = (await stubDrift({ web: WEB })).filter(
  (entry) => mode === MODE.CHECK || entry.kind === STUB_DRIFT.ORPHAN,
);
const rewrites = mode === MODE.CHECK && (await rewritesDrifted(WEB));
if (drift.length > 0 || rewrites) {
  for (const entry of drift) {
    console.error(`${entry.kind}: ${entry.path}`);
  }
  if (rewrites) console.error(`stale: ${VERCEL_CONFIG_FILE} /api/ routes`);
  console.error(
    "run `pnpm --filter @luke/web functions:stubs` to regenerate the stubs under api/ and the rewrites",
  );
  exit(1);
}
