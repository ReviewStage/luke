import { configDefaults, defineConfig } from "vitest/config";

const POSTGRES_ONLY = process.env.APP_STORE_TEST_DATABASE_URL ? [] : ["src/**/*.postgres.test.ts"];

export default defineConfig({
  test: {
    name: "database",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
    exclude: [...configDefaults.exclude, ...POSTGRES_ONLY],
    globalSetup: ["src/testing/migrated-pglite-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
