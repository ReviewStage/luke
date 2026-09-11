import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "settings",
    include: ["src/**/*.test.ts"],
  },
});
