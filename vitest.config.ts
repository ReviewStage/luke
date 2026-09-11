import { defineConfig } from "vitest/config";

// Runner-swap PRs (P0-04 onward) add one project entry per package or app
// that gains its own vitest.config.ts. Root `pnpm test` still runs the
// per-package `node --test` scripts until each is swapped.
export default defineConfig({
  test: {
    projects: ["packages/wire", "tools/ios-parity", "tools/trace-export", "packages/providers"],
  },
});
