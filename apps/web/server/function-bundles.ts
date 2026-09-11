import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, posix, relative, sep } from "node:path";
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

/**
 * The declared dependencies no function bundle may load at all: each runs in
 * a service of its own, and a bundle reaching one loads a graph the function
 * never calls. A second entry here is a second package with that property,
 * and the eve-specific guard runs over every entry.
 */
export const FORBIDDEN_FUNCTION_EXTERNALS = {
  EVE: "eve",
} as const;

/** Where the expected external set of every bundle is committed, compared as data. */
export const FUNCTION_EXTERNALS_FILE = join("server", "function-externals.json");

/** The metafile the build writes beside its bundles, for reading what actually shipped. */
export const FUNCTION_METAFILE = join(FUNCTION_BUNDLE_DIRECTORY, "metafile.json");

/** Each bundle's external imports, keyed by its file under `dist-functions/`, each set sorted. */
export type BundleExternals = Readonly<Record<string, readonly string[]>>;

/** How one bundle's externals differ from the recorded set. */
export interface ExternalsDrift {
  readonly bundle: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}
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
      // The metafile's paths are relative to this, so the build and the test key bundles the same way from any working directory.
      absWorkingDir: web,
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

/** The bundle's file under `dist-functions/`, POSIX-separated, whatever the metafile's output path was relative to. */
function bundleKey(web: string, outputPath: string): string {
  const fromWeb = relative(join(web, FUNCTION_BUNDLE_DIRECTORY), join(web, outputPath));
  return fromWeb.split(sep).join(posix.sep);
}

/** Every bundle's external imports as the metafile records them, sorted and unique, keyed by bundle. */
export function externalsByBundle(metafile: Metafile, web: string) {
  return Object.fromEntries(
    Object.entries(metafile.outputs).map(([path, output]) => [
      bundleKey(web, path),
      [
        ...new Set(output.imports.filter((imported) => imported.external).map((i) => i.path)),
      ].sort(),
    ]),
  ) satisfies BundleExternals;
}

/** The recorded external set of every bundle, as committed. */
export async function expectedExternals(web: string): Promise<BundleExternals> {
  // SAFETY: the file is this app's own committed map, written by `functions:externals`; the sets below are compared as data.
  return JSON.parse(await readFile(join(web, FUNCTION_EXTERNALS_FILE), "utf8")) as BundleExternals;
}

/** The committed map's text, stable under regeneration: bundles sorted, each set sorted. */
export function externalsSource(externals: BundleExternals): string {
  const sorted = Object.fromEntries(
    Object.keys(externals)
      .sort()
      .map((bundle) => [bundle, [...(externals[bundle] ?? [])].sort()]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * Where the bundles' externals differ from the recorded set: a bundle that
 * gained or lost an external, one no longer built, or one the record has
 * not seen. Empty when every bundle loads exactly what was recorded, which
 * is what a deploy is trusted on.
 */
export function externalsDrift(
  expected: BundleExternals,
  actual: BundleExternals,
): readonly ExternalsDrift[] {
  const bundles = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const drift: ExternalsDrift[] = [];
  for (const bundle of bundles) {
    const was = new Set(expected[bundle] ?? []);
    const is = new Set(actual[bundle] ?? []);
    const added = [...is].filter((specifier) => !was.has(specifier)).sort();
    const removed = [...was].filter((specifier) => !is.has(specifier)).sort();
    if (added.length > 0 || removed.length > 0) drift.push({ bundle, added, removed });
  }
  return drift;
}

/**
 * The import chain from a bundle's entry to the first module that imports
 * the specifier, as the metafile's input paths: what makes a drift fixable
 * rather than merely true, since the offending edge is the last step and the
 * module that carried it into the bundle is the one before. Empty when the
 * bundle does not import it.
 */
export function importChain(
  metafile: Metafile,
  outputPath: string,
  specifier: string,
): readonly string[] {
  const output = metafile.outputs[outputPath];
  if (output?.entryPoint === undefined) return [];
  const inBundle = new Set(Object.keys(output.inputs));
  const parent = new Map<string, string | undefined>([[output.entryPoint, undefined]]);
  const queue = [output.entryPoint];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const input = metafile.inputs[current];
    if (input === undefined) continue;
    if (input.imports.some((imported) => imported.external && imported.path === specifier)) {
      const chain: string[] = [];
      for (let at: string | undefined = current; at !== undefined; at = parent.get(at)) {
        chain.unshift(at);
      }
      return chain;
    }
    for (const imported of input.imports) {
      if (imported.external || !inBundle.has(imported.path) || parent.has(imported.path)) continue;
      parent.set(imported.path, current);
      queue.push(imported.path);
    }
  }
  return [];
}
