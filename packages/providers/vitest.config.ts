import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "providers",
    include: ["src/**/*.test.ts"],
  },
});
