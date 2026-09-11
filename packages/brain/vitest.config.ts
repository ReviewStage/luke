import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "brain",
    include: ["src/**/*.test.ts"],
  },
});
