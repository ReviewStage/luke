import { join, relative } from "node:path";
import { build } from "esbuild";
import { functionBundlePlan, packageNameOf } from "../server/function-bundles.js";
import { bundlePath, stubDrift } from "../server/function-stubs.js";

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

const drift = await stubDrift({ web: WEB });
if (drift.length > 0) {
  throw new Error(
    `api/ stubs disagree with server/routes/ (run \`pnpm --filter @luke/web functions:stubs\`): ${drift
      .map((entry) => `${entry.kind} ${entry.path}`)
      .join(", ")}`,
  );
}

const plan = await functionBundlePlan(WEB);
const result = await build({ ...plan.options, write: true });

const undeclared = new Set<string>();
for (const input of Object.values(result.metafile.inputs)) {
  for (const imported of input.imports) {
    if (!imported.external) continue;
    if (!plan.externalPackages.has(packageNameOf(imported.path))) undeclared.add(imported.path);
  }
}
if (undeclared.size > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${[...undeclared].sort().join(", ")}`,
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
