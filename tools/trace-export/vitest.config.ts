import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "trace-export",
    include: ["src/**/*.test.ts"],
  },
});
