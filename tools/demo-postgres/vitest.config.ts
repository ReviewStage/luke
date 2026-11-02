import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "demo-postgres",
    include: ["*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
  },
});
