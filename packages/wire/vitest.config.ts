import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "wire",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testing/file-time-cap.ts"],
  },
});
