import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "devtrace",
    include: ["src/**/*.test.ts"],
  },
});
