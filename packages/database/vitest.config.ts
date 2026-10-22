import { configDefaults, defineConfig } from "vitest/config";

// A `*.postgres.test.ts` shows what only a real Postgres can, two connections
// contending for one lock, which PGlite's one connection cannot hold apart;
// it runs where `LUKE_STORE_TEST_DATABASE_URL` names one, CI's Postgres job.
const POSTGRES_ONLY = process.env.LUKE_STORE_TEST_DATABASE_URL ? [] : ["src/**/*.postgres.test.ts"];

export default defineConfig({
  test: {
    name: "database",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...POSTGRES_ONLY],
    // A store test's `it.layer(getTestDB())` hook opens the file's one PGlite
    // and runs every migration before its first test, about 4 s on an idle
    // machine; vitest's 10 s hook default was missed under the full suite's
    // contention on the macos-15 release runner. Held to the web suite's bar,
    // which raised it for the same hook (`apps/web/vitest.config.ts`). The
    // v0.19.0 release run then missed 30 s on four files, so it is 60 s.
    hookTimeout: 60_000,
    // A store test runs its statements on that same PGlite, and the v0.18.0
    // release run saw one take 5.4 s against vitest's 5 s default under the
    // same contention, so a test is held to the hook's bar too.
    testTimeout: 30_000,
  },
});
