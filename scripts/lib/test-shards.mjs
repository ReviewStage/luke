// test-shards.mjs -- vitest's sequencer for CI's shards: each shard takes an equal share of the time, not of the files.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BaseSequencer } from "vitest/node";

/**
 * Where a workspace records how long each of its test files ran, in
 * milliseconds by its path from the workspace root, as
 * `scripts/test-durations.mjs` writes it.
 */
export const TEST_DURATIONS_FILE = "test-durations.json";

/** A workspace's recorded durations, or none where it records nothing. */
function recordedDurations(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, TEST_DURATIONS_FILE), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/**
 * How long each file is expected to run. A file the record names takes its
 * recorded time; any other, such as one added since, takes its size at the
 * median milliseconds per byte of the files the record names, so a large new
 * file still weighs as a large one.
 */
function weighed(files, durations) {
  const sizes = files.map((file) => statSync(file.absolute).size);
  const rates = files
    .map((file, index) => (durations[file.relative] ?? 0) / sizes[index])
    .filter((rate) => rate > 0)
    .sort((a, b) => a - b);
  const rate = rates.length > 0 ? rates[Math.floor(rates.length / 2)] : 1;
  return files.map((file, index) => ({
    ...file,
    weight: durations[file.relative] ?? sizes[index] * rate,
  }));
}

/**
 * Vitest's own `--shard` hashes each file's path into an equal count of files
 * per shard, whatever each one costs, so one shard drew a 177 s file and the
 * others idled. Here the files go longest first to whichever shard holds the
 * least time so far, which every shard's job works out alike from the same
 * files and record. The order within a shard stays vitest's own.
 */
export class DurationSharding extends BaseSequencer {
  async shard(specs) {
    const { index, count } = this.ctx.config.shard;
    const byRoot = new Map();
    for (const spec of specs) {
      const root = spec.project.config.root;
      const relative = path.relative(root, spec.moduleId).split(path.sep).join("/");
      const files = byRoot.get(root) ?? [];
      files.push({ spec, absolute: spec.moduleId, relative });
      byRoot.set(root, files);
    }
    const files = [...byRoot].flatMap(([root, inRoot]) => weighed(inRoot, recordedDurations(root)));
    files.sort((a, b) => b.weight - a.weight || (a.absolute < b.absolute ? -1 : 1));
    const totals = Array.from({ length: count }, () => 0);
    const mine = [];
    for (const file of files) {
      const lightest = totals.indexOf(Math.min(...totals));
      totals[lightest] += file.weight;
      if (lightest === index - 1) mine.push(file.spec);
    }
    return mine;
  }
}
