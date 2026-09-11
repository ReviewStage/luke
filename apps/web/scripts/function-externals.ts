import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exit } from "node:process";
import { build } from "esbuild";
import {
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  externalsSource,
  FUNCTION_EXTERNALS_FILE,
  functionBundlePlan,
  importChain,
} from "../server/function-bundles.js";

/**
 * `--write` bundles every function unwritten and records each bundle's
 * external imports in the committed map; `--check` records nothing and lists
 * every bundle whose externals differ from the map, with the import chain
 * that carries each added external, and exits non-zero. The map is the
 * review moment a bundle's graph otherwise lacks: a diff line saying which
 * function now loads which package is a question a reviewer can ask, where
 * a silently widened bundle is not.
 */
const WEB = join(import.meta.dirname, "..");
const MODE = { WRITE: "--write", CHECK: "--check" } as const;

const mode = process.argv[2];
if (mode !== MODE.WRITE && mode !== MODE.CHECK) {
  console.error(`usage: function-externals.ts ${MODE.WRITE} | ${MODE.CHECK}`);
  exit(2);
}

const plan = await functionBundlePlan(WEB);
const result = await build({ ...plan.options, write: false });
const actual = externalsByBundle(result.metafile, WEB);

if (mode === MODE.WRITE) {
  await writeFile(join(WEB, FUNCTION_EXTERNALS_FILE), externalsSource(actual));
  // biome-ignore lint/suspicious/noConsole: a script's output is its log.
  console.log(
    `recorded the externals of ${Object.keys(actual).length} bundles in ${FUNCTION_EXTERNALS_FILE}`,
  );
  exit(0);
}

const drift = externalsDrift(await expectedExternals(WEB), actual);
if (drift.length === 0) exit(0);
for (const entry of drift) {
  const outputPath = Object.keys(result.metafile.outputs).find((path) =>
    path.endsWith(entry.bundle),
  );
  console.error(
    `${entry.bundle}: added ${JSON.stringify(entry.added)} removed ${JSON.stringify(entry.removed)}`,
  );
  for (const added of entry.added) {
    const chain = outputPath === undefined ? [] : importChain(result.metafile, outputPath, added);
    console.error(`  ${added} via ${chain.join(" -> ")}`);
  }
}
console.error(
  `run \`pnpm --filter @luke/web functions:externals\` once the change above is the intended one`,
);
exit(1);
