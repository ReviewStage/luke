import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "catalog",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
  },
});
