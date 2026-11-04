import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sync",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
  },
});
