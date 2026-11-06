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

const FUNCTION_BUNDLE_TARGET = "node24";

const REQUIRE_BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';

export const INLINE_EXCEPTION = {
  PG_NATIVE: "pg-native",
  BUFFERUTIL: "bufferutil",
  UTF8_VALIDATE: "utf-8-validate",
} as const;

export const FUNCTION_EXTERNALS_FILE = join("server", "function-externals.json");

const LOCAL_ONLY_MODULES = [join("server", "local-sign-in.ts")] as const;

export const FUNCTION_METAFILE = join(FUNCTION_BUNDLE_DIRECTORY, "metafile.json");

const BundleExternalsSchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

export type BundleExternals = typeof BundleExternalsSchema.Type;

const decodeBundleExternals = Schema.decodeUnknownSync(
  Schema.fromJsonString(BundleExternalsSchema),
);

export interface ExternalsDrift {
  readonly bundle: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}
const DISPATCHER_NAMESPACE = "function-dispatcher";
const DISPATCH_MODULE = join("server", "function-dispatch.ts");

export interface FunctionBundlePlan {
  readonly functions: readonly FunctionDefinition[];
  readonly externalPackages: ReadonlySet<string>;
  readonly options: BuildOptions & { readonly metafile: true };
}

function packageNameOf(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);
}

function routeImport(web: string, route: string, index: number): string {
  if (route === ORPC_ROUTE_KEY) {
    return `import { orpcRoute as route${index} } from ${JSON.stringify(join(web, ORPC_ROUTE_MODULE))};`;
  }
  return `import route${index} from ${JSON.stringify(join(web, routeSourcePath(route)))};`;
}

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

const ZOD_ENTRY_MODULES = [
  "/node_modules/zod/index.js",
  "/node_modules/zod/v4/index.js",
  "/node_modules/zod/v4/classic/index.js",
];
const ZOD_ENTRY_SPECIFIER = /^(zod(\/v4)?|\.\/classic\/index\.js)$/;
const ZOD_ENTRY_PLUGIN = "zod-entry-side-effects";

function zodEntryPlugin(): Plugin {
  return {
    name: ZOD_ENTRY_PLUGIN,
    setup(build) {
      build.onResolve({ filter: ZOD_ENTRY_SPECIFIER }, async (args) => {
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
      loader: { ".sh": "text" },
      external: exceptions,
      banner: { js: REQUIRE_BANNER },
    },
  };
}

function bundleKey(web: string, outputPath: string): string {
  const fromWeb = relative(join(web, FUNCTION_BUNDLE_DIRECTORY), join(web, outputPath));
  return fromWeb.split(sep).join(posix.sep);
}

const ESBUILD_RUNTIME = "<runtime>";

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

export async function expectedExternals(web: string): Promise<BundleExternals> {
  return decodeBundleExternals(await readFile(join(web, FUNCTION_EXTERNALS_FILE), "utf8"));
}

export function externalsSource(externals: BundleExternals): string {
  const sorted = Object.fromEntries(
    Object.keys(externals)
      .sort()
      .map((bundle) => [bundle, [...(externals[bundle] ?? [])].sort()]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

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

export function bundlesReaching(
  metafile: Metafile,
  web: string,
  module: string,
): ReadonlySet<string> {
  const input = relative(web, module);
  return new Set(
    Object.entries(metafile.outputs)
      .filter(([, output]) => input in output.inputs)
      .map(([path]) => path),
  );
}

export function localOnlyReach(metafile: Metafile, web: string): readonly string[] {
  return LOCAL_ONLY_MODULES.flatMap((module) =>
    [...bundlesReaching(metafile, web, join(web, module))].map(
      (bundle) => `${bundleKey(web, bundle)} reaches ${module}`,
    ),
  );
}
