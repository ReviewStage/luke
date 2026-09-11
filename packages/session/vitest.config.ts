import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "session",
    include: ["src/**/*.test.ts"],
  },
});
