import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "host-daemon",
    include: ["scripts/**/*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
  },
});
