import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agent-runner",
    include: ["src/**/*.test.ts"],
  },
});
