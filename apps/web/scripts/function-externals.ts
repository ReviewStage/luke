import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import { build } from "esbuild";
import {
  externalsByBundle,
  externalsSource,
  FUNCTION_EXTERNALS_FILE,
  functionBundlePlan,
} from "../server/function-bundles.js";

/**
 * `--write` bundles every function unwritten and records each bundle's
 * external imports in the committed map. The map is the review moment a
 * bundle's graph otherwise lacks: a diff line saying which function now loads
 * which package is a question a reviewer can ask, where a silently widened
 * bundle is not. The build enforces the map itself — `bundle-functions.ts`
 * fails on drift.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE) {
  console.error(`usage: function-externals.ts ${MODE.WRITE}`);
  exit(2);
}

const plan = await functionBundlePlan(WEB);
const result = await build({ ...plan.options, write: false });
const actual = externalsByBundle(result.metafile, WEB);
await writeFile(join(WEB, FUNCTION_EXTERNALS_FILE), externalsSource(actual));
// biome-ignore lint/suspicious/noConsole: a script's output is its log.
console.log(
  `recorded the externals of ${Object.keys(actual).length} bundles in ${FUNCTION_EXTERNALS_FILE}`,
);
