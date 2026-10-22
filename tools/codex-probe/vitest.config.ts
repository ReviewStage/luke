import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "codex-probe",
    include: ["src/**/*.test.ts"],
  },
});
