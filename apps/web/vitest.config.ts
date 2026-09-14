import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    // The whole suite stands up a database, and a PGlite test exceeds vitest's
    // 5 s default on a loaded machine; node:test, which ran it before, had no
    // default at all. Suite-wide so the next database test meets the same bar.
    testTimeout: 30_000,
    // A layer hook opens its own PGlite and runs every migration before the
    // file's first test, so it does the same work as a database test and is
    // held to the same bar; vitest's 10 s hook default is marginal under the
    // full suite's contention.
    hookTimeout: 30_000,
  },
});
