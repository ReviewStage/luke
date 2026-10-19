import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "database",
    include: ["src/**/*.test.ts"],
    // A store test's `it.layer(getTestDB())` hook opens the file's one PGlite
    // and runs every migration before its first test, about 4 s on an idle
    // machine; vitest's 10 s hook default was missed under the full suite's
    // contention on the macos-15 release runner. Held to the web suite's bar,
    // which raised it for the same hook (`apps/web/vitest.config.ts`).
    hookTimeout: 30_000,
    // A store test runs its statements on that same PGlite, and the v0.18.0
    // release run saw one take 5.4 s against vitest's 5 s default under the
    // same contention, so a test is held to the hook's bar too.
    testTimeout: 30_000,
  },
});
