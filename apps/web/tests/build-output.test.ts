import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { build } from "esbuild";
import { test } from "vitest";
import {
  type EmittedFunction,
  emitBuildOutput,
  functionConfig,
  functionConfigPath,
  functionDirectory,
  functionEntryPath,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output";
import { functionBundlePlan } from "../server/function-bundles";
import { functionPublicPath, webFunctions } from "../server/function-layout";
import { apiRewrites } from "../server/function-rewrites";

/**
 * The tree Vercel deploys is emitted here from the same plan the build step
 * uses, into a directory of its own, and read back as data. Two things are
 * asserted and they are different claims. Structure: every planned function
 * has a `.func` carrying exactly the configuration the plan gave it, and every
 * `/api/` rewrite names a `.func` that exists, so a route cannot point at
 * nothing while the build stays green. Isolation: each `.func` loads with
 * nothing above it on disk, which is how a function is mounted on the
 * platform; a bundle that reached a module it did not carry loads in this
 * checkout and fails on production, which is the shape of the one outage.
 */

const WEB = fileURLToPath(new URL("..", import.meta.url));

const FunctionConfigSchema = Schema.Struct({
  runtime: Schema.String,
  handler: Schema.String,
  launcherType: Schema.String,
  shouldAddHelpers: Schema.Boolean,
  maxDuration: Schema.optional(Schema.Number),
});
const decodeFunctionConfig = Schema.decodeUnknownSync(Schema.fromJsonString(FunctionConfigSchema));

const LOAD_MODULE = "await import(process.argv[1]);";

/**
 * What a load is given: a PATH to find node, and nothing else. Every bundle
 * reaches the auth module statically, and that module once built its pool as
 * it was constructed, so a load needed a `DATABASE_URL` to get through the
 * import at all; a load now reads no environment, and this environment is
 * what proves it. The guard is about what a bundle can resolve, not what a
 * deployment is configured with.
 */
const LOAD_ENVIRONMENT = { PATH: process.env.PATH ?? "" } as const;

async function emitFromTask(): Promise<{
  readonly outputDirectory: string;
  readonly paths: readonly string[];
}> {
  const task = await functionBundlePlan(WEB);
  const result = await build({ ...task.options, write: false });
  const contentsOf = new Map(result.outputFiles.map((file) => [file.path, file.contents] as const));
  const outputDirectory = mkdtempSync(join(tmpdir(), "luke-build-output-"));
  const functions: EmittedFunction[] = [
    ...task.functions.map((definition) => {
      const contents = contentsOf.get(join(WEB, "dist-functions", `${definition.file}.js`));
      assert.ok(contents, definition.file);
      return {
        path: functionPublicPath(definition),
        contents,
        maxDuration: definition.maxDuration,
      };
    }),
    ...(await Promise.all(
      HAND_WRITTEN_FUNCTIONS.map(async (fn) => ({
        path: fn.path,
        contents: await readFile(join(WEB, fn.source)),
        maxDuration: undefined,
      })),
    )),
  ];
  const paths = await emitBuildOutput({ outputDirectory, functions });
  return { outputDirectory, paths };
}

test("every planned function and every rewrite lands on a .func carrying the plan's configuration", {
  timeout: 180_000,
}, async () => {
  const { outputDirectory, paths } = await emitFromTask();
  const functions = await webFunctions(WEB);
  assert.deepEqual(
    paths,
    [...functions.map(functionPublicPath), ...HAND_WRITTEN_FUNCTIONS.map((fn) => fn.path)].sort(),
  );
  for (const definition of functions) {
    const config = decodeFunctionConfig(
      readFileSync(functionConfigPath(outputDirectory, functionPublicPath(definition)), "utf8"),
    );
    assert.deepEqual(config, functionConfig(definition.maxDuration));
  }
  for (const fn of HAND_WRITTEN_FUNCTIONS) {
    assert.deepEqual(
      decodeFunctionConfig(readFileSync(functionConfigPath(outputDirectory, fn.path), "utf8")),
      functionConfig(undefined),
    );
  }
  for (const rewrite of apiRewrites(functions)) {
    const destination = new URL(rewrite.dest, "http://localhost");
    assert.equal(
      existsSync(functionDirectory(outputDirectory, destination.pathname.slice(1))),
      true,
      rewrite.dest,
    );
  }
});

test("each .func loads with nothing above it available", { timeout: 180_000 }, async () => {
  const { outputDirectory, paths } = await emitFromTask();
  for (const path of paths) {
    const directory = functionDirectory(outputDirectory, path);
    const loaded = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", LOAD_MODULE, functionEntryPath(outputDirectory, path)],
      {
        cwd: directory,
        encoding: "utf8",
        env: LOAD_ENVIRONMENT,
      },
    );
    assert.equal(loaded.status, 0, `${path}: ${loaded.stderr}`);
  }
});
