import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    // The whole suite stands up a database, and a PGlite test exceeds vitest's
    // 5 s default on a loaded machine; node:test, which ran it before, had no
    // default at all. Suite-wide so the next database test meets the same bar.
    testTimeout: 30_000,
  },
});
