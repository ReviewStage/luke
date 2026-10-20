import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

/** Loads a function and answers one request through its default export, printing the status and the body. */
const ANSWER_REQUEST =
  "const fn = await import(process.argv[1]); const answer = await fn.default.fetch(new Request(process.argv[2])); console.log(answer.status, await answer.text()); process.exit(0);";

/** A database URL that connects to nothing, which the web runtime's layer names and no answer here dials. */
const PLACEHOLDER_DATABASE_URL = "postgresql://isolation:load@127.0.0.1:5432/luke";

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

test("the default .func, loaded alone, lands the fallback's requests on the hosted oRPC router", {
  timeout: 180_000,
}, async () => {
  const { outputDirectory } = await emitFromTask();
  const grouped = (await webFunctions(WEB)).find((definition) => definition.file === "default");
  assert.ok(grouped);
  const path = functionPublicPath(grouped);
  const answered = (query: string) => {
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        ANSWER_REQUEST,
        functionEntryPath(outputDirectory, path),
        `https://luke.test/${path}?${query}`,
      ],
      {
        cwd: functionDirectory(outputDirectory, path),
        encoding: "utf8",
        env: { ...LOAD_ENVIRONMENT, DATABASE_URL: PLACEHOLDER_DATABASE_URL },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim().split("\n").at(-1);
  };
  assert.equal(answered("route=orpc&route-path=models"), '401 {"error":"invalid-token"}');
  assert.equal(answered("route=orpc&route-path=nope"), '404 {"error":"not-found"}');
});

test("the site is copied under static/ whole, but for any source map the client build left in it", async () => {
  const site = mkdtempSync(join(tmpdir(), "luke-build-site-"));
  mkdirSync(join(site, "assets"));
  writeFileSync(join(site, "app.html"), "<!doctype html>");
  writeFileSync(join(site, "assets", "app-1a2b.js"), "console.log(1);");
  writeFileSync(join(site, "assets", "app-1a2b.js.map"), '{"version":3}');
  writeFileSync(join(site, "assets", "app-1a2b.css.map"), '{"version":3}');
  const outputDirectory = mkdtempSync(join(tmpdir(), "luke-build-output-"));

  await emitBuildOutput({ outputDirectory, functions: [], staticDirectory: site });

  const served = readdirSync(join(outputDirectory, "static"), { recursive: true }).map(String);
  assert.deepEqual(served.sort(), ["app.html", "assets", join("assets", "app-1a2b.js")]);
});
