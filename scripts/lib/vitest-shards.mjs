// CI runs the suite as four jobs, `vitest run --shard=<n>/4` each, and the
// local check runs the same four in turn rather than the suite whole. A
// whole-suite run on one machine starves vitest's host of its workers'
// reporting channel at the tail of the run and fails a run whose every test
// passed with `[vitest-worker]: Timeout calling "onTaskUpdate"` and no file
// named (LUKE-187); a quarter of the suite per process never reaches that
// tail. vitest assigns a file to a shard by the hash of its path, so a shard
// here holds exactly the files the same shard holds on CI.
export const VITEST_SHARD_COUNT = 4;

export function vitestShardIndexes(count = VITEST_SHARD_COUNT) {
  return Array.from({ length: count }, (_, offset) => offset + 1);
}

export function vitestShardArguments(index, count = VITEST_SHARD_COUNT) {
  return ["exec", "vitest", "run", `--shard=${index}/${count}`];
}
