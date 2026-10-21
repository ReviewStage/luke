/**
 * runner-bundle.test.ts -- the runner's bundle read from beside a function's entry, and a build that left none there.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { Effect, Exit } from "effect";
import { test } from "vitest";
import { RUNNER_BUNDLE_FILE, RunnerBundle, runnerBundleFromDirectory } from "./runner-bundle.js";

const contentsIn = (directory: string) =>
  Effect.runPromiseExit(
    Effect.flatMap(RunnerBundle, (bundle) => bundle.contents).pipe(
      Effect.provide(runnerBundleFromDirectory(directory)),
    ),
  );

test("the bundle is read from the directory the function's entry stands in", async (t) => {
  const directory = await temporaryDirectory(t, "runner-bundle-");
  writeFileSync(join(directory, RUNNER_BUNDLE_FILE), "// the runner\n");

  const read = await contentsIn(directory);

  assert.ok(Exit.isSuccess(read));
  assert.equal(new TextDecoder().decode(read.value), "// the runner\n");
});

test("a directory the build left no bundle in fails the read", async (t) => {
  const directory = await temporaryDirectory(t, "runner-bundle-");

  const read = await contentsIn(directory);

  assert.ok(Exit.isFailure(read));
});
