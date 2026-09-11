import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "calendar",
    include: ["src/**/*.test.ts"],
  },
});
