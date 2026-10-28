import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "anti-slop",
    include: ["**/*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
    exclude: ["node_modules/**"],
  },
});
