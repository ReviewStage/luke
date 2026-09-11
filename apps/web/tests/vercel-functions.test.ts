import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  importChain,
} from "../server/function-bundles";
import { DISPATCH_QUERY } from "../server/function-dispatch";
import {
  FUNCTION_GROUP,
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionDefinitions,
  functionPath,
  routeKeyOf,
  VOICE_FUNCTION_MAX_DURATION_SECONDS,
} from "../server/function-durations";
import { apiRewrites, rewritesDrifted } from "../server/function-rewrites";
import {
  bundlePath,
  FUNCTION_BUNDLE_DIRECTORY,
  routeKeys,
  routeSourcePath,
  stubDrift,
  stubPath,
  stubSource,
  webFunctions,
} from "../server/function-stubs";

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

test("the config literal parses back to the duration it was written from", async () => {
  const source = functionConfigSource(VOICE_FUNCTION_MAX_DURATION_SECONDS);
  // SAFETY: the module is the one line `functionConfigSource` wrote, whose only export is `config`.
  const module = (await import(`data:text/javascript,${encodeURIComponent(source)}`)) as {
    config: { maxDuration: number };
  };
  assert.deepEqual(module.config, { maxDuration: VOICE_FUNCTION_MAX_DURATION_SECONDS });
});

test("every function has its committed stub, nothing under api/ is an orphan, and the rewrites are current", async () => {
  assert.deepEqual(await stubDrift({ web: WEB }), []);
  assert.equal(await rewritesDrifted(WEB), false);
});

test("a stub carries the duration its function was given, and only then", async () => {
  for (const definition of await webFunctions(WEB)) {
    const configLine = stubSource(definition).split("\n")[1] ?? "";
    if (definition.maxDuration === undefined) {
      assert.equal(definition.file, FUNCTION_GROUP.DEFAULT);
      assert.equal(configLine, "");
      continue;
    }
    // SAFETY: the module is the config line the stub carries, whose only export is `config`.
    const module = (await import(`data:text/javascript,${encodeURIComponent(configLine)}`)) as {
      config: { maxDuration: number };
    };
    assert.deepEqual(module.config, { maxDuration: definition.maxDuration });
  }
});

test("a nested stub's specifier resolves to its bundle under dist-functions/", async () => {
  for (const definition of await webFunctions(WEB)) {
    const specifier = stubSource(definition).match(/from "([^"]+)"/)?.[1] ?? "";
    assert.equal(
      posix.resolve("/", posix.dirname(stubPath(definition)), specifier),
      `/${bundlePath(definition)}`,
    );
    assert.equal(bundlePath(definition).split(posix.sep)[0], FUNCTION_BUNDLE_DIRECTORY);
  }
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
      assert.equal(seen.get(route), definition.dispatches ? `/${stubPath(definition)}` : undefined);
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
});

/**
 * The guard falsified on purpose: a route bundled with one value import into
 * `agent/`, whose hooks value-import `defineState` from `eve/context` and are
 * safe today only because no function bundle reaches them. Both checks must
 * fail on that bundle, and the drift must carry the import chain to the
 * module that brought eve in, or the guard is a belief rather than a check.
 */
test("a route that reaches agent/ fails both guards, naming the bundle and the import chain", {
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
      contents: 'import "./devices.ts";\nimport "../../agent/hooks/store.ts";\n',
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

  const owner = plan.functions.find((definition) => definition.routes.includes("devices"));
  assert.ok(owner);
  const bundle = `${owner.file}.js`;
  const probeExternals = externalsByBundle(result.metafile, WEB)[`${probe}.js`] ?? [];
  // The record as it would stand had the route been recorded before the edge: everything the probe loads but eve.
  const recorded = probeExternals.filter((specifier) => specifier !== "eve/context");
  assert.deepEqual(externalsDrift({ [bundle]: recorded }, { [bundle]: probeExternals }), [
    { bundle, added: ["eve/context"], removed: [] },
  ]);

  const chain = importChain(result.metafile, outputPath, "eve/context");
  assert.equal(chain.at(-1), posix.join("agent", "hooks", "store.ts"));
  assert.equal(chain.length >= 2, true);
});
