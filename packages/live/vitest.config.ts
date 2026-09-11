import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "live",
    include: ["src/**/*.test.ts"],
  },
});
