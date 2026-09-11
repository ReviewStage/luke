import { defineConfig } from "vitest/config";

// Runner-swap PRs (P0-04 onward) add one project entry per package or app
// that gains its own vitest.config.ts. Root `pnpm test` still runs the
// per-package `node --test` scripts until each is swapped.
export default defineConfig({
  test: {
    projects: [
      "packages/wire",
      "packages/runtime",
      "packages/session",
      "packages/guide",
      "packages/live",
      "packages/gateway",
      "packages/devtrace",
      "packages/settings",
      "packages/voice",
      "tools/ios-parity",
      "tools/trace-export",
      "packages/providers",
      "apps/desktop",
    ],
  },
});
