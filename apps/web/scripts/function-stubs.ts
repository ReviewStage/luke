import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import {
  routeRelativePaths,
  STUB_DRIFT,
  stubDirectory,
  stubDrift,
  stubPath,
  stubSource,
} from "../server/function-stubs.js";

/**
 * `--write` generates the committed `api/**\/*.js` stub for every route under
 * `server/routes/`; `--check` lists every stub that is missing, stale, or has
 * no route behind it and exits non-zero. Both refuse an orphan rather than
 * deleting it: a file under `api/` that nothing generates is a decision for the
 * developer, since Vercel would deploy it as a function.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  throw new Error(`usage: function-stubs.ts ${MODE.WRITE} | ${MODE.CHECK}`);
}

if (mode === MODE.WRITE) {
  for (const route of await routeRelativePaths(join(WEB, "server", "routes"))) {
    await mkdir(stubDirectory(WEB, route), { recursive: true });
    await writeFile(join(WEB, stubPath(route)), stubSource(route));
  }
}

const drift = (await stubDrift({ web: WEB })).filter(
  (entry) => mode === MODE.CHECK || entry.kind === STUB_DRIFT.ORPHAN,
);
if (drift.length > 0) {
  for (const entry of drift) {
    console.error(`${entry.kind}: ${entry.path}`);
  }
  console.error("run `pnpm --filter @luke/web functions:stubs` to regenerate the stubs under api/");
  exit(1);
}
