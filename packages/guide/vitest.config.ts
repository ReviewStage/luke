import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "guide",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
