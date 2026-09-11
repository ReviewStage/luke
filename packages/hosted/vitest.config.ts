import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "hosted",
    include: ["src/**/*.test.ts"],
  },
});
