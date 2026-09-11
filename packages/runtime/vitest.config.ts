import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "runtime",
    include: ["src/**/*.test.ts"],
  },
});
