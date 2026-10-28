import { defineConfig } from "vitest/config";
import { DurationSharding } from "../../scripts/lib/test-shards.mjs";

export default defineConfig({
  test: {
    name: "service",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
    // One migrated PGlite per run, which every file's opening loads.
    globalSetup: ["../database/src/testing/migrated-pglite-setup.ts"],
    // CI's shards split the files by their recorded time (`scripts/lib/test-shards.mjs`).
    sequence: { sequencer: DurationSharding },
    // Held to the web suite's bar, which these tests came from: a store test's
    // layer hook opens its own PGlite and runs every migration before the
    // file's first test (`apps/web/vitest.config.ts`).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
