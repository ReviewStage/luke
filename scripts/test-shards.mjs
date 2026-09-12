import { spawnSync } from "node:child_process";
import {
  VITEST_SHARD_COUNT,
  vitestShardArguments,
  vitestShardIndexes,
} from "./lib/vitest-shards.mjs";

// Every shard runs even after one fails, as CI's `fail-fast: false` matrix
// does, so one run reports every failing file rather than the first shard's.
const failed = vitestShardIndexes().filter((index) => {
  process.stdout.write(`\n=== vitest shard ${index}/${VITEST_SHARD_COUNT} ===\n`);
  const shard = spawnSync("pnpm", vitestShardArguments(index), { stdio: "inherit" });
  return (shard.status ?? 1) !== 0;
});

if (failed.length > 0) {
  const names = failed.map((index) => `${index}/${VITEST_SHARD_COUNT}`).join(", ");
  process.stderr.write(`\nerror: vitest shard ${names} failed\n`);
  process.exit(1);
}
