import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";
import type { BuildOptions, Metafile } from "esbuild";
import { FUNCTION_BUNDLE_DIRECTORY } from "./function-stubs.js";

/**
 * How the routes under `server/routes/` become function bundles, declared
 * once so the build script and the test bundle the same way. Workspace
 * packages are inlined; the web app's own declared runtime dependencies stay
 * external, because those are what Vercel's builder traces from
 * `apps/web/node_modules`, and everything else that resolves external is a
 * dependency a bundled package reaches that this app never declared.
 *
 * The externals are also where an import edge shows itself. A package this
 * app declares but no function should load — the eve package, whose door
 * and host run in eve's own service — appears in a bundle's externals the
 * moment a shared module gains a value import that reaches it, and esbuild
 * follows a value import where it would erase a type one. That is how one
 * import took every function down at once, so `bundlesReaching` is what the
 * test asserts over, before any deploy.
 */

const ROUTES_DIRECTORY = join("server", "routes");
const WORKSPACE_PROTOCOL = "workspace:";
const FUNCTION_BUNDLE_TARGET = "node24";

export interface FunctionBundlePlan {
  /** Absolute paths of every route, the bundle entry points. */
  readonly entryPoints: readonly string[];
  /** The declared runtime dependencies left external, by package name. */
  readonly externalPackages: ReadonlySet<string>;
  /** The esbuild options the bundles are built with; `write` is the caller's, and the metafile is always asked for since the checks read it. */
  readonly options: BuildOptions & { readonly metafile: true };
}

/** The name of the package a specifier reaches: the scope and name of a scoped one, the first segment otherwise. */
export function packageNameOf(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);
}

export async function functionBundlePlan(web: string): Promise<FunctionBundlePlan> {
  // SAFETY: the file is this app's own package.json, read for its dependencies map alone.
  const manifest = JSON.parse(await readFile(join(web, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const externalDependencies = Object.entries(manifest.dependencies)
    .filter(([, range]) => !range.startsWith(WORKSPACE_PROTOCOL))
    .map(([name]) => name);
  const routes = join(web, ROUTES_DIRECTORY);
  const entryPoints = (await readdir(routes, { recursive: true }))
    .filter((path) => path.endsWith(".ts"))
    .map((path) => join(routes, path));
  return {
    entryPoints,
    externalPackages: new Set([
      ...externalDependencies,
      ...builtinModules,
      ...builtinModules.map((name) => `node:${name}`),
    ]),
    options: {
      entryPoints,
      outbase: routes,
      outdir: join(web, FUNCTION_BUNDLE_DIRECTORY),
      bundle: true,
      platform: "node",
      format: "esm",
      target: FUNCTION_BUNDLE_TARGET,
      sourcemap: false,
      metafile: true,
      logLevel: "warning",
      external: [...externalDependencies, ...externalDependencies.map((name) => `${name}/*`)],
    },
  };
}

/** The output bundles whose graph imports the named package at runtime, as the metafile's output paths, sorted. */
export function bundlesReaching(metafile: Metafile, packageName: string): readonly string[] {
  return Object.entries(metafile.outputs)
    .filter(([, output]) =>
      output.imports.some(
        (imported) => imported.external && packageNameOf(imported.path) === packageName,
      ),
    )
    .map(([path]) => path)
    .sort();
}
