import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join, posix, relative, sep } from "node:path";
import { Schema } from "effect";
import type { BuildOptions, Metafile, Plugin } from "esbuild";
import { ORPC_ROUTE_KEY } from "./function-dispatch.js";
import type { FunctionDefinition } from "./function-durations.js";
import {
  FUNCTION_BUNDLE_DIRECTORY,
  ORPC_ROUTE_MODULE,
  routeSourcePath,
  webFunctions,
} from "./function-layout.js";

/**
 * How the functions become bundles, declared once so the build script and the
 * test bundle the same way. A grouped function's entry is generated here: it
 * imports each member route and hands them to `dispatchRoutes`. A standalone
 * function's entry is its route file. Workspace packages are inlined; the web
 * app's own declared runtime dependencies stay external, because those are
 * what Vercel's builder traces from `apps/web/node_modules`, and everything
 * else that resolves external is a dependency a bundled package reaches that
 * this app never declared.
 */

const FUNCTION_BUNDLE_TARGET = "node24";

/**
 * The specifiers left outside every bundle. Each is a guarded optional
 * `require` inside an inlined dependency: `pg` tries its native binding and
 * falls back to JavaScript, `ws` tries its two native accelerators and falls
 * back the same way. esbuild leaves an unresolvable require inside a try/catch
 * external on its own; naming them is what lets the externals record say
 * exactly these and refuse a fourth.
 */
/**
 * Prepended to every bundle. esbuild turns a CommonJS `require` inside an
 * inlined dependency into a shim that throws "Dynamic require … is not
 * supported" in ES module output unless a `require` is in scope; `pg` asks
 * for `events` that way and every function would fail at load. A real
 * `require` built from the module's own URL is what the shim finds instead.
 */
const REQUIRE_BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';

export const INLINE_EXCEPTION = {
  PG_NATIVE: "pg-native",
  BUFFERUTIL: "bufferutil",
  UTF8_VALIDATE: "utf-8-validate",
} as const;

/** Where the expected external set of every bundle is committed, compared as data. */
export const FUNCTION_EXTERNALS_FILE = join("server", "function-externals.json");

/** The metafile the build writes beside its bundles, for reading what actually shipped. */
export const FUNCTION_METAFILE = join(FUNCTION_BUNDLE_DIRECTORY, "metafile.json");

/** Each bundle's external imports, keyed by its file under `dist-functions/`, each set sorted. */
const BundleExternalsSchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

export type BundleExternals = typeof BundleExternalsSchema.Type;

const decodeBundleExternals = Schema.decodeUnknownSync(
  Schema.fromJsonString(BundleExternalsSchema),
);

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
function packageNameOf(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);
}

/** One member's import: a route file's default export, or the hosted oRPC route by its name. */
function routeImport(web: string, route: string, index: number): string {
  if (route === ORPC_ROUTE_KEY) {
    return `import { orpcRoute as route${index} } from ${JSON.stringify(join(web, ORPC_ROUTE_MODULE))};`;
  }
  return `import route${index} from ${JSON.stringify(join(web, routeSourcePath(route)))};`;
}

/** The generated entry of a grouped function: every member route, keyed for the dispatcher. */
function dispatcherSource(web: string, definition: FunctionDefinition): string {
  const imports = definition.routes.map((route, index) => routeImport(web, route, index));
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

/** zod's pure re-export entry modules, as a resolved path ends: the package root, `zod/v4`, and the classic index `zod/v4` re-exports. */
const ZOD_ENTRY_MODULES = [
  "/node_modules/zod/index.js",
  "/node_modules/zod/v4/index.js",
  "/node_modules/zod/v4/classic/index.js",
];
/** The specifiers that reach them: `zod` and `zod/v4` from a dependency, `./classic/index.js` from inside `zod/v4`. */
const ZOD_ENTRY_SPECIFIER = /^(zod(\/v4)?|\.\/classic\/index\.js)$/;
const ZOD_ENTRY_PLUGIN = "zod-entry-side-effects";

/**
 * Keeps zod's re-export entry modules in every bundle. A module that some
 * bundled dependency reaches through a dynamic `import()` is wrapped by esbuild
 * in a lazy initializer, and Better Auth 1.7 dynamically imports modules that
 * reach `zod`, so zod's schemas are wrapped. A static importer of a wrapped
 * module is handed an `init_…()` call ahead of its own code, but the `ai`
 * package imports `zod/v4`, which reaches the schemas through two pure
 * re-export files that zod's `sideEffects` list lets esbuild drop, and esbuild
 * drops the initializer call with them (0.27.7 and 0.28.2 alike): `ai`'s top-level `z.lazy(…)` then runs before `ZodLazy`
 * is assigned and the function fails to load. Note that we mark only those
 * re-export files as having side effects, because keeping them costs a few
 * lines and keeps the initializer call esbuild would otherwise lose.
 */
function zodEntryPlugin(): Plugin {
  return {
    name: ZOD_ENTRY_PLUGIN,
    setup(build) {
      build.onResolve({ filter: ZOD_ENTRY_SPECIFIER }, async (args) => {
        // The plugin's own resolve below re-enters this hook; it is passed through by its marker.
        if (args.pluginData === ZOD_ENTRY_PLUGIN) return undefined;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          resolveDir: args.resolveDir,
          pluginData: ZOD_ENTRY_PLUGIN,
        });
        const entry = ZOD_ENTRY_MODULES.some((suffix) => resolved.path.endsWith(suffix));
        return entry && resolved.errors.length === 0
          ? { ...resolved, sideEffects: true }
          : undefined;
      });
    },
  };
}

export async function functionBundlePlan(web: string): Promise<FunctionBundlePlan> {
  const functions = await webFunctions(web);
  const entryPoints = functions.map((definition) => ({
    in: definition.dispatches
      ? `${DISPATCHER_NAMESPACE}:${definition.file}`
      : join(web, routeSourcePath(definition.file)),
    out: definition.file,
  }));
  const exceptions = Object.values(INLINE_EXCEPTION);
  return {
    functions,
    externalPackages: new Set([
      ...exceptions,
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
      plugins: [dispatcherPlugin(web, functions), zodEntryPlugin()],
      external: exceptions,
      banner: { js: REQUIRE_BANNER },
    },
  };
}

type MetafileImport = Metafile["inputs"][string]["imports"][number];

/** The specifier a module wrote, whether esbuild inlined what it resolved to or left it external. */
function importSpecifier(imported: MetafileImport): string {
  return imported.original ?? imported.path;
}

/** The bundle's file under `dist-functions/`, POSIX-separated, whatever the metafile's output path was relative to. */
function bundleKey(web: string, outputPath: string): string {
  const fromWeb = relative(join(web, FUNCTION_BUNDLE_DIRECTORY), join(web, outputPath));
  return fromWeb.split(sep).join(posix.sep);
}

/** esbuild's own helper module, recorded in the metafile as an external import of every bundle it shimmed a `require` in; not a dependency. */
const ESBUILD_RUNTIME = "<runtime>";

/**
 * The external imports no declared package accounts for, sorted: each a
 * module a bundle would fail to load. A module given to esbuild's `inject`,
 * as Sentry's plugin gives its release stub, is recorded external from every
 * importer even though it is bundled as an input, so an import the metafile
 * also lists as an input is not one.
 */
export function undeclaredImports(
  metafile: Metafile,
  web: string,
  declared: ReadonlySet<string>,
): string[] {
  const undeclared = new Set<string>();
  for (const input of Object.values(metafile.inputs)) {
    for (const imported of input.imports) {
      if (!imported.external || imported.path === ESBUILD_RUNTIME) continue;
      if (relative(web, imported.path) in metafile.inputs) continue;
      if (!declared.has(packageNameOf(imported.path))) undeclared.add(imported.path);
    }
  }
  return [...undeclared].sort();
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
  return decodeBundleExternals(await readFile(join(web, FUNCTION_EXTERNALS_FILE), "utf8"));
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
    if (input.imports.some((imported) => importSpecifier(imported) === specifier)) {
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
