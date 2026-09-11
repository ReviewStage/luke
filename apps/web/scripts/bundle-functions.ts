import { appendFile, readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { build } from "esbuild";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionPath,
} from "../server/function-durations.js";

/**
 * Bundles every route under `server/routes/` into a plain ESM file under
 * `api/`, mirroring the tree. Not part of `pnpm build`: Vercel discovers
 * functions from the source tree before the build runs, so bundles emitted
 * here are never deployed until they travel through the Build Output API. Handed TypeScript, the builder runs its own compiler
 * over each function's whole import graph separately — thirty-odd passes over
 * the same sixteen workspace packages, most of a deploy's build time, under
 * compiler options that are not this repository's.
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
const API = join(WEB, "api");

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

const entryPoints = (await readdir(ROUTES, { recursive: true }))
  .filter((path) => path.endsWith(".ts"))
  .map((path) => join(ROUTES, path));

const result = await build({
  entryPoints,
  outbase: ROUTES,
  outdir: API,
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
  if (maxDuration !== undefined) {
    await appendFile(join(WEB, file), functionConfigSource(maxDuration));
  }
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(
    `bundled ${relative(WEB, file)} (${output.bytes} bytes${maxDuration === undefined ? "" : `, ${maxDuration}s`})`,
  );
}
