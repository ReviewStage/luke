import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "claude-code-probe",
    include: ["tests/**/*.test.ts"],
  },
});
