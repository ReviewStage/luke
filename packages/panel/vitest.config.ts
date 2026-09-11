import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "panel",
    include: ["src/**/*.test.ts"],
  },
});
