import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "anti-slop",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
