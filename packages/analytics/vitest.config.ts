import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "analytics",
    include: ["src/**/*.test.ts"],
  },
});
