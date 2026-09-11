import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "gateway",
    include: ["src/**/*.test.ts"],
  },
});
