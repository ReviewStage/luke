import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ui",
    include: ["src/**/*.test.ts"],
    // A browser test runs in the package's browser project (vitest.browser.config.ts).
    exclude: ["src/**/*.browser.test.ts"],
  },
});
