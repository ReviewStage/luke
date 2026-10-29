import { defineConfig } from "vitest/config";
import { reactCompilerVite } from "../../scripts/lib/react-compiler.mjs";

export default defineConfig({
  // The React Compiler trial, so the tests draw what the bundles ship
  // (`scripts/lib/react-compiler.mjs`).
  plugins: [reactCompilerVite()],
  test: {
    name: "ui",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../wire/src/testing/file-time-cap.ts"],
  },
});
