import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  VITEST_SHARD_COUNT,
  vitestShardArguments,
  vitestShardIndexes,
} from "./lib/vitest-shards.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ciWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

test("the local run walks every shard index once, in order", () => {
  assert.deepEqual(vitestShardIndexes(), [1, 2, 3, 4]);
  assert.deepEqual(vitestShardIndexes(2), [1, 2]);
});

test("a shard's arguments are the run CI's matrix job makes", () => {
  assert.deepEqual(vitestShardArguments(3), ["exec", "vitest", "run", "--shard=3/4"]);
  assert.deepEqual(vitestShardArguments(1, 2), ["exec", "vitest", "run", "--shard=1/2"]);
});

test("CI's test matrix and the local run agree on the shard count", () => {
  const matrix = ciWorkflow.match(/^\s*shard:\s*\[([^\]]*)\]\s*$/m);
  assert.ok(matrix, "ci.yml declares a shard matrix");
  const jobs = matrix[1].split(",").map((entry) => Number(entry.trim()));
  assert.deepEqual(jobs, vitestShardIndexes());

  const denominators = [...ciWorkflow.matchAll(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(denominators, [VITEST_SHARD_COUNT]);
});
