import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { build } from "esbuild";
import {
  BUILD_OUTPUT_DIRECTORY,
  emitBuildOutput,
  functionPublicPath,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output.js";
import {
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  FUNCTION_METAFILE,
  functionBundlePlan,
  importChain,
  packageNameOf,
} from "../server/function-bundles.js";
import { bundlePath, FUNCTION_BUNDLE_DIRECTORY, stubDrift } from "../server/function-stubs.js";

/**
 * Bundles the functions the routes under `server/routes/` are grouped into,
 * each a plain ESM file under `dist-functions/`, so Vercel's builder finds JavaScript
 * and only traces dependencies. Handed TypeScript, the builder runs its own
 * compiler over each function's whole import graph separately — thirty-odd
 * passes over the same sixteen workspace packages, most of a deploy's build
 * time, under compiler options that are not this repository's.
 *
 * The bundles cannot land in `api/` themselves: Vercel registers `api/`
 * functions from the uploaded source tree before `buildCommand` runs, so a
 * function first emitted here is never deployed. The committed stubs under
 * `api/` are what the builder discovers, each re-exporting its bundle and
 * carrying its `config` literal, and a route without one fails this build
 * rather than 404ing on production.
 *
 * Workspace packages are inlined; the web app's own declared runtime
 * dependencies stay external, because those are what the builder can trace
 * from `apps/web/node_modules`. Anything else that resolved external is a
 * dependency a bundled package reaches that this app never declared, and it
 * would fail at the first request as a missing module, so the build refuses it
 * here instead.
 */
const WEB = join(import.meta.dirname, "..");
/** Where `vite build` and `prerender.ts` leave the site, copied whole under the output's `static/`. */
const SITE_DIRECTORY = "dist";

const drift = await stubDrift({ web: WEB });
if (drift.length > 0) {
  throw new Error(
    `api/ stubs disagree with server/routes/ (run \`pnpm --filter @luke/web functions:stubs\`): ${drift
      .map((entry) => `${entry.kind} ${entry.path}`)
      .join(", ")}`,
  );
}

const plan = await functionBundlePlan(WEB);
// Emptied first, so a bundle an earlier plan emitted can never sit beside the shipping ones and be read as one of them.
await rm(join(WEB, FUNCTION_BUNDLE_DIRECTORY), { recursive: true, force: true });
const result = await build({ ...plan.options, write: true });

/** esbuild's own helper module, recorded in the metafile as an external import of every bundle it shimmed a `require` in; not a dependency. */
const ESBUILD_RUNTIME = "<runtime>";
const undeclared = new Set<string>();
for (const input of Object.values(result.metafile.inputs)) {
  for (const imported of input.imports) {
    if (!imported.external || imported.path === ESBUILD_RUNTIME) continue;
    if (!plan.externalPackages.has(packageNameOf(imported.path))) undeclared.add(imported.path);
  }
}
if (undeclared.size > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${[...undeclared].sort().join(", ")}`,
  );
}

await writeFile(join(WEB, FUNCTION_METAFILE), JSON.stringify(result.metafile));

const externals = externalsDrift(
  await expectedExternals(WEB),
  externalsByBundle(result.metafile, WEB),
);
if (externals.length > 0) {
  const lines = externals.map((entry) => {
    const outputPath = Object.keys(result.metafile.outputs).find((path) =>
      path.endsWith(entry.bundle),
    );
    const chains = entry.added.map(
      (added) =>
        `${added} via ${(outputPath === undefined ? [] : importChain(result.metafile, outputPath, added)).join(" -> ")}`,
    );
    return `${entry.bundle}: added ${JSON.stringify(entry.added)} removed ${JSON.stringify(entry.removed)}${chains.length > 0 ? ` (${chains.join("; ")})` : ""}`;
  });
  throw new Error(
    `function bundles load externals the record does not expect (run \`pnpm --filter @luke/web functions:externals\` if intended):\n${lines.join("\n")}`,
  );
}

const durationOf = new Map(
  plan.functions.map((definition) => [join(WEB, bundlePath(definition)), definition.maxDuration]),
);
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  const maxDuration = durationOf.get(join(WEB, file));
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(
    `bundled ${relative(WEB, file)} (${output.bytes} bytes${maxDuration === undefined ? "" : `, ${maxDuration}s`})`,
  );
}

const emitted = await emitBuildOutput({
  outputDirectory: join(WEB, BUILD_OUTPUT_DIRECTORY),
  staticDirectory: join(WEB, SITE_DIRECTORY),
  functions: [
    ...(await Promise.all(
      plan.functions.map(async (definition) => ({
        path: functionPublicPath(definition),
        contents: await readFile(join(WEB, bundlePath(definition))),
        maxDuration: definition.maxDuration,
      })),
    )),
    ...(await Promise.all(
      HAND_WRITTEN_FUNCTIONS.map(async (fn) => ({
        path: fn.path,
        contents: await readFile(join(WEB, fn.source)),
        maxDuration: undefined,
      })),
    )),
  ],
});
// biome-ignore lint/suspicious/noConsole: a build script's output is its log — the tree it left for Vercel.
console.log(
  `emitted ${BUILD_OUTPUT_DIRECTORY} with ${emitted.length} functions: ${emitted.join(", ")}`,
);
