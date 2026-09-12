import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { build } from "esbuild";
import { test } from "vitest";
import {
  bundlesReaching,
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  FORBIDDEN_FUNCTION_EXTERNALS,
  functionBundlePlan,
  INLINE_EXCEPTION,
  importChain,
} from "../server/function-bundles";
import { DISPATCH_QUERY } from "../server/function-dispatch";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionDefinitions,
  functionPath,
  routeKeyOf,
  VOICE_FUNCTION_MAX_DURATION_SECONDS,
} from "../server/function-durations";
import {
  FUNCTION_BUNDLE_DIRECTORY,
  functionPublicPath,
  routeKeys,
  routeSourcePath,
  webFunctions,
} from "../server/function-layout";
import {
  API_REWRITES_FILE,
  apiRewrites,
  apiRewritesSource,
  type Rewrite,
  readApiRewritesTable,
  rewritesDrifted,
  VERCEL_CONFIG_FILE,
} from "../server/function-rewrites";

const WEB = fileURLToPath(new URL("..", import.meta.url));

test("both voice functions carry the 800 second maximum duration", () => {
  for (const path of Object.values(VOICE_SERVICE_PATH)) {
    assert.equal(FUNCTION_MAX_DURATION_SECONDS.get(path), VOICE_FUNCTION_MAX_DURATION_SECONDS);
  }
});

test("every path given a duration is a route the bundle emits", () => {
  for (const path of FUNCTION_MAX_DURATION_SECONDS.keys()) {
    assert.ok(existsSync(join(WEB, routeSourcePath(routeKeyOf(path)))), path);
    assert.equal(functionPath(`${routeKeyOf(path)}.ts`), path);
  }
});

test("every route belongs to exactly one function, and the voice routes alone stand alone", async () => {
  const keys = await routeKeys(join(WEB, "server", "routes"));
  const functions = functionDefinitions(keys);
  const claimed = functions.flatMap((definition) => definition.routes);
  assert.deepEqual([...claimed].sort(), [...keys].sort());
  assert.equal(new Set(claimed).size, keys.length);
  assert.deepEqual(
    functions
      .filter((definition) => !definition.dispatches)
      .flatMap((definition) => definition.routes)
      .sort(),
    Object.values(VOICE_SERVICE_PATH).map(routeKeyOf).sort(),
  );
  const files = functions.map((definition) => definition.file);
  assert.deepEqual([...new Set(files)], files);
});

test("a grouped function's routes all had the duration the group declares", async () => {
  for (const definition of await webFunctions(WEB)) {
    for (const route of definition.routes) {
      assert.equal(
        FUNCTION_MAX_DURATION_SECONDS.get(functionPath(`${route}.ts`)),
        definition.maxDuration,
      );
    }
  }
});

test("the committed table is what the routes generate, and vercel.json's /api/ entries are the table", async () => {
  assert.deepEqual(await readApiRewritesTable(WEB), apiRewrites(await webFunctions(WEB)));
  assert.equal(await rewritesDrifted(WEB), false);
});

/** A web app whose routes are this one's and whose two committed files are the caller's, so each half can drift alone. */
function scratchWeb(table: string, config: string): string {
  const web = mkdtempSync(join(tmpdir(), "luke-rewrites-"));
  mkdirSync(join(web, "server"));
  symlinkSync(join(WEB, "server", "routes"), join(web, "server", "routes"), "dir");
  writeFileSync(join(web, API_REWRITES_FILE), table);
  writeFileSync(join(web, VERCEL_CONFIG_FILE), config);
  return web;
}

test("drift is read from both halves: a table behind the routes, and a vercel.json behind the table", async () => {
  const table = readFileSync(join(WEB, API_REWRITES_FILE), "utf8");
  const config = readFileSync(join(WEB, VERCEL_CONFIG_FILE), "utf8");
  assert.equal(await rewritesDrifted(scratchWeb(table, config)), false);
  const generated = apiRewrites(await webFunctions(WEB));
  assert.equal(
    await rewritesDrifted(scratchWeb(apiRewritesSource(generated.slice(1)), config)),
    true,
  );
  // SAFETY: the text is this app's own committed vercel.json, which the generator's schema decoded whole in the assertion above; only its routes array is moved here.
  const reordered = JSON.parse(config) as { routes: readonly Rewrite[] };
  const [first, ...rest] = reordered.routes;
  assert.ok(first);
  const swapped = `${JSON.stringify({ ...reordered, routes: [...rest, first] }, null, 2)}\n`;
  assert.equal(await rewritesDrifted(scratchWeb(table, swapped)), true);
});

test("every dispatched route has one rewrite onto its function, carrying the route key", async () => {
  const functions = await webFunctions(WEB);
  const rewrites = apiRewrites(functions);
  const seen = new Map<string, string>();
  for (const rewrite of rewrites) {
    const destination = new URL(rewrite.dest, "http://localhost");
    const route = destination.searchParams.get(DISPATCH_QUERY.ROUTE);
    assert.notEqual(route, null);
    assert.equal(seen.has(String(route)), false);
    seen.set(String(route), destination.pathname);
  }
  for (const definition of functions) {
    for (const route of definition.routes) {
      assert.equal(
        seen.get(route),
        definition.dispatches ? `/${functionPublicPath(definition)}` : undefined,
      );
    }
  }
});

/**
 * The eve package runs in eve's own service; a function bundle that imports
 * it loads the brain host's whole graph at invocation, and the one time a
 * shared module gained a value import reaching it, every function on
 * production failed at load while every check stayed green. The bundles are
 * built here as the build script builds them, unwritten, and the set of them
 * reaching any forbidden package is asserted to be exactly none.
 */
test("no function bundle imports a forbidden package", { timeout: 60_000 }, async () => {
  const plan = await functionBundlePlan(WEB);
  const result = await build({ ...plan.options, write: false });
  assert.equal(Object.keys(result.metafile.outputs).length, plan.functions.length);
  for (const forbidden of Object.values(FORBIDDEN_FUNCTION_EXTERNALS)) {
    assert.deepEqual(bundlesReaching(result.metafile, forbidden), []);
  }
});

/**
 * The whole map, not one package: every bundle's external set is the one the
 * record holds. The outage deploy moved three externals on one edge and the
 * eve check names one of them; this is the assertion that would have named
 * all three, and it fails as data, naming the bundle and what it gained or
 * lost, so a legitimate widening is a one-line edit to the record and a
 * review moment rather than a silent change to what a function loads.
 */
test("every function bundle loads exactly the externals the record expects", {
  timeout: 60_000,
}, async () => {
  const plan = await functionBundlePlan(WEB);
  const result = await build({ ...plan.options, write: false });
  const actual = externalsByBundle(result.metafile, WEB);
  assert.deepEqual(Object.keys(actual).sort(), plan.functions.map((f) => `${f.file}.js`).sort());
  assert.deepEqual(externalsDrift(await expectedExternals(WEB), actual), []);
  // Inline-first leaves outside a bundle only Node's own modules and the named exceptions; a fourth external is a dependency that stopped inlining.
  const permitted = new Set<string>([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
    ...Object.values(INLINE_EXCEPTION),
  ]);
  for (const externals of Object.values(actual)) {
    assert.deepEqual(
      externals.filter((specifier) => !permitted.has(specifier)),
      [],
    );
  }
});

/**
 * The guard falsified on purpose: a route bundled with one value import into
 * `eve/`, whose hooks value-import `defineState` from `eve/context` and are
 * safe today only because no function bundle reaches them. Both checks must
 * fail on that bundle, and the drift must carry the import chain to the
 * module that brought eve in, or the guard is a belief rather than a check.
 */
test("a route that reaches eve/ fails the reachability guard, naming the bundle and the import chain", {
  timeout: 60_000,
}, async () => {
  const plan = await functionBundlePlan(WEB);
  const probe = "devices-reaching-agent";
  const { entryPoints: _entryPoints, outdir: _outdir, ...options } = plan.options;
  const result = await build({
    ...options,
    write: false,
    outfile: join(WEB, FUNCTION_BUNDLE_DIRECTORY, `${probe}.js`),
    stdin: {
      contents: 'import "./devices.ts";\nimport "../../eve/hooks/store.ts";\n',
      resolveDir: join(WEB, "server", "routes"),
      sourcefile: `${probe}.ts`,
      loader: "ts",
    },
  });
  const [outputPath, ...rest] = Object.keys(result.metafile.outputs);
  assert.ok(outputPath);
  assert.deepEqual(rest, []);

  assert.deepEqual(bundlesReaching(result.metafile, FORBIDDEN_FUNCTION_EXTERNALS.EVE), [
    outputPath,
  ]);

  // The edge is inlined, so the bundle's externals never name it: a guard over
  // externals alone would have passed here, which is why the guard reads inputs.
  const probeExternals = externalsByBundle(result.metafile, WEB)[`${probe}.js`] ?? [];
  assert.equal(probeExternals.includes("eve/context"), false);

  const chain = importChain(result.metafile, outputPath, "eve/context");
  assert.equal(chain.at(-1), posix.join("eve", "hooks", "store.ts"));
  assert.equal(chain.length >= 2, true);
});
