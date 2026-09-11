import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "actions",
    include: ["src/**/*.test.ts"],
  },
});
