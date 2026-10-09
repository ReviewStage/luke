import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "desktop",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testing/resize-observer.ts"],
  },
});
