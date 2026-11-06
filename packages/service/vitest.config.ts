import { defineConfig } from "vitest/config";
import { DurationSharding } from "../../scripts/lib/test-shards.mjs";

export default defineConfig({
  test: {
    name: "service",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
    globalSetup: ["../database/src/testing/migrated-pglite-setup.ts"],
    sequence: { sequencer: DurationSharding },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
