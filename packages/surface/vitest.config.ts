import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "surface",
    include: ["src/**/*.test.ts"],
  },
});
