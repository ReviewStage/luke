import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "live",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
  },
});
