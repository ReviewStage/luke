import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { FUNCTION_MAX_DURATION_SECONDS, functionPath } from "../server/function-durations.js";
import { FUNCTION_BUNDLE_DIRECTORY, stubDrift } from "../server/function-stubs.js";

/**
 * Bundles every route under `server/routes/` into a plain ESM file under
 * `dist-functions/`, mirroring the tree, so Vercel's builder finds JavaScript
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
const ROUTES = join(WEB, "server", "routes");
const BUNDLES = join(WEB, FUNCTION_BUNDLE_DIRECTORY);

const WORKSPACE_PROTOCOL = "workspace:";

// SAFETY: the file is this app's own package.json, read for its dependencies map alone.
const manifest = JSON.parse(await readFile(join(WEB, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const externalDependencies = Object.entries(manifest.dependencies)
  .filter(([, range]) => !range.startsWith(WORKSPACE_PROTOCOL))
  .map(([name]) => name);
const external = new Set([
  ...externalDependencies,
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const drift = await stubDrift({ web: WEB });
if (drift.length > 0) {
  throw new Error(
    `api/ stubs disagree with server/routes/ (run \`pnpm --filter @luke/web functions:stubs\`): ${drift
      .map((entry) => `${entry.kind} ${entry.path}`)
      .join(", ")}`,
  );
}

const entryPoints = (await readdir(ROUTES, { recursive: true }))
  .filter((path) => path.endsWith(".ts"))
  .map((path) => join(ROUTES, path));

const result = await build({
  entryPoints,
  outbase: ROUTES,
  outdir: BUNDLES,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  metafile: true,
  logLevel: "warning",
  external: [...externalDependencies, ...externalDependencies.map((name) => `${name}/*`)],
});

const undeclared = new Set<string>();
for (const input of Object.values(result.metafile.inputs)) {
  for (const imported of input.imports) {
    if (!imported.external) continue;
    const packageName = imported.path.startsWith("@")
      ? imported.path.split("/").slice(0, 2).join("/")
      : (imported.path.split("/")[0] ?? imported.path);
    if (!external.has(packageName)) undeclared.add(imported.path);
  }
}
if (undeclared.size > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${[...undeclared].sort().join(", ")}`,
  );
}

for (const [file, output] of Object.entries(result.metafile.outputs)) {
  const maxDuration = output.entryPoint
    ? FUNCTION_MAX_DURATION_SECONDS.get(
        functionPath(relative(ROUTES, join(WEB, output.entryPoint))),
      )
    : undefined;
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(
    `bundled ${relative(WEB, file)} (${output.bytes} bytes${maxDuration === undefined ? "" : `, ${maxDuration}s`})`,
  );
}
