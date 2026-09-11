import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { build } from "esbuild";
import { test } from "vitest";
import { bundlesReaching, functionBundlePlan } from "../server/function-bundles";
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
 * reaching eve is asserted to be exactly none.
 */
test("no function bundle imports the eve package", { timeout: 60_000 }, async () => {
  const plan = await functionBundlePlan(WEB);
  const result = await build({ ...plan.options, write: false });
  assert.equal(Object.keys(result.metafile.outputs).length, plan.functions.length);
  assert.deepEqual(bundlesReaching(result.metafile, "eve"), []);
});
