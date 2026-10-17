import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "host",
    include: ["src/**/*.test.ts"],
    // Note that open-on-mac's tests run real Git and bash, which a macOS
    // runner has been seen to take past vitest's 5s default.
    testTimeout: 30_000,
  },
});
