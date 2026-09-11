import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "credentials",
    include: ["src/**/*.test.ts"],
  },
});
