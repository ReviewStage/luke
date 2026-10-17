import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "host",
    include: ["src/**/*.test.ts"],
  },
});
