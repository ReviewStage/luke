import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";
import type { BuildOptions, Metafile, Plugin } from "esbuild";
import type { FunctionDefinition } from "./function-durations.js";
import { FUNCTION_BUNDLE_DIRECTORY, routeSourcePath, webFunctions } from "./function-stubs.js";

/**
 * How the functions become bundles, declared once so the build script and the
 * test bundle the same way. A grouped function's entry is generated here: it
 * imports each member route and hands them to `dispatchRoutes`. A standalone
 * function's entry is its route file. Workspace packages are inlined; the web
 * app's own declared runtime dependencies stay external, because those are
 * what Vercel's builder traces from `apps/web/node_modules`, and everything
 * else that resolves external is a dependency a bundled package reaches that
 * this app never declared.
 *
 * The externals are also where an import edge shows itself. A package this
 * app declares but no function should load — the eve package, whose door
 * and host run in eve's own service — appears in a bundle's externals the
 * moment a shared module gains a value import that reaches it, and esbuild
 * follows a value import where it would erase a type one. That is how one
 * import took every function down at once, so `bundlesReaching` is what the
 * test asserts over, before any deploy.
 */

const WORKSPACE_PROTOCOL = "workspace:";
const FUNCTION_BUNDLE_TARGET = "node24";
const DISPATCHER_NAMESPACE = "function-dispatcher";
const DISPATCH_MODULE = join("server", "function-dispatch.ts");

export interface FunctionBundlePlan {
  /** The functions the bundles are built for. */
  readonly functions: readonly FunctionDefinition[];
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

/** The generated entry of a grouped function: every member route, keyed for the dispatcher. */
function dispatcherSource(web: string, definition: FunctionDefinition): string {
  const imports = definition.routes.map(
    (route, index) =>
      `import route${index} from ${JSON.stringify(join(web, routeSourcePath(route)))};`,
  );
  const entries = definition.routes.map(
    (route, index) => `[${JSON.stringify(route)}, route${index}]`,
  );
  return [
    `import { dispatchRoutes } from ${JSON.stringify(join(web, DISPATCH_MODULE))};`,
    ...imports,
    `export default dispatchRoutes(new Map([${entries.join(", ")}]));`,
    "",
  ].join("\n");
}

function dispatcherPlugin(web: string, functions: readonly FunctionDefinition[]): Plugin {
  const sources = new Map(
    functions
      .filter((definition) => definition.dispatches)
      .map((definition) => [definition.file, dispatcherSource(web, definition)]),
  );
  const filter = new RegExp(`^${DISPATCHER_NAMESPACE}:`);
  return {
    name: DISPATCHER_NAMESPACE,
    setup(build) {
      build.onResolve({ filter }, (args) => ({
        path: args.path.slice(`${DISPATCHER_NAMESPACE}:`.length),
        namespace: DISPATCHER_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: DISPATCHER_NAMESPACE }, (args) => {
        const contents = sources.get(args.path);
        if (contents === undefined) throw new Error(`no dispatcher for the function ${args.path}`);
        return { contents, loader: "ts", resolveDir: web };
      });
    },
  };
}

export async function functionBundlePlan(web: string): Promise<FunctionBundlePlan> {
  // SAFETY: the file is this app's own package.json, read for its dependencies map alone.
  const manifest = JSON.parse(await readFile(join(web, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const externalDependencies = Object.entries(manifest.dependencies)
    .filter(([, range]) => !range.startsWith(WORKSPACE_PROTOCOL))
    .map(([name]) => name);
  const functions = await webFunctions(web);
  const entryPoints = functions.map((definition) => ({
    in: definition.dispatches
      ? `${DISPATCHER_NAMESPACE}:${definition.file}`
      : join(web, routeSourcePath(definition.file)),
    out: definition.file,
  }));
  return {
    functions,
    externalPackages: new Set([
      ...externalDependencies,
      ...builtinModules,
      ...builtinModules.map((name) => `node:${name}`),
    ]),
    options: {
      entryPoints,
      outdir: join(web, FUNCTION_BUNDLE_DIRECTORY),
      bundle: true,
      platform: "node",
      format: "esm",
      target: FUNCTION_BUNDLE_TARGET,
      sourcemap: false,
      metafile: true,
      logLevel: "warning",
      plugins: [dispatcherPlugin(web, functions)],
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
