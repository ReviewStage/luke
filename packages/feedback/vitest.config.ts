import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "feedback",
    include: ["src/**/*.test.ts"],
  },
});
