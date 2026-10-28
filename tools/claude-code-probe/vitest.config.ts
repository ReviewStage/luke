import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "claude-code-probe",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["../../packages/wire/src/testing/file-time-cap.ts"],
  },
});
