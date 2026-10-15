import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "service",
    include: ["src/**/*.test.ts"],
    // Held to the web suite's bar, which these tests came from: a store test's
    // layer hook opens its own PGlite and runs every migration before the
    // file's first test (`apps/web/vitest.config.ts`).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
