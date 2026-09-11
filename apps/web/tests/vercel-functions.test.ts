import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { VOICE_SERVICE_PATH } from "@sidecar/hosted";
import { build } from "esbuild";
import { test } from "vitest";
import { bundlesReaching, functionBundlePlan } from "../server/function-bundles";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  functionConfigSource,
  functionPath,
  VOICE_FUNCTION_MAX_DURATION_SECONDS,
} from "../server/function-durations";
import {
  FUNCTION_BUNDLE_DIRECTORY,
  routeRelativePaths,
  stubDrift,
  stubPath,
  stubSource,
} from "../server/function-stubs";

const WEB = fileURLToPath(new URL("..", import.meta.url));

test("both voice functions carry the 800 second maximum duration", () => {
  for (const path of Object.values(VOICE_SERVICE_PATH)) {
    assert.equal(FUNCTION_MAX_DURATION_SECONDS.get(path), VOICE_FUNCTION_MAX_DURATION_SECONDS);
  }
});

test("every path given a duration is a route the bundle emits", () => {
  for (const path of FUNCTION_MAX_DURATION_SECONDS.keys()) {
    const source = fileURLToPath(
      new URL(`../server/routes/${path.slice("/api/".length)}.ts`, import.meta.url),
    );
    assert.ok(existsSync(source), path);
    assert.equal(functionPath(`${path.slice("/api/".length)}.ts`), path);
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

test("every route has its committed stub and nothing under api/ is an orphan", async () => {
  assert.deepEqual(await stubDrift({ web: WEB }), []);
});

test("a stub carries the duration its route was given, and only then", async () => {
  for (const route of await routeRelativePaths(join(WEB, "server", "routes"))) {
    const maxDuration = FUNCTION_MAX_DURATION_SECONDS.get(functionPath(route));
    const configLine = stubSource(route).split("\n")[1] ?? "";
    if (maxDuration === undefined) {
      assert.equal(configLine, "");
      continue;
    }
    // SAFETY: the module is the config line the stub carries, whose only export is `config`.
    const module = (await import(`data:text/javascript,${encodeURIComponent(configLine)}`)) as {
      config: { maxDuration: number };
    };
    assert.deepEqual(module.config, { maxDuration });
  }
});

test("a nested stub's specifier resolves to its bundle under dist-functions/", () => {
  const route = "brain/v2/respond.ts";
  const specifier = stubSource(route).match(/from "([^"]+)"/)?.[1] ?? "";
  assert.equal(
    posix.resolve("/", posix.dirname(stubPath(route)), specifier),
    `/${FUNCTION_BUNDLE_DIRECTORY}/brain/v2/respond.js`,
  );
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
  assert.equal(Object.keys(result.metafile.outputs).length, plan.entryPoints.length);
  assert.deepEqual(bundlesReaching(result.metafile, "eve"), []);
});
