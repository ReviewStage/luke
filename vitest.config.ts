import { defineConfig } from "vitest/config";

// One entry per workspace that holds a vitest.config.ts of its own, which is
// every workspace that has tests at all: `no-node-test` refuses a
// `node:test` import in TypeScript.
// A workspace whose components are also checked in a real browser names its
// second config, `vitest.browser.config.ts`, beside its first.
// `scripts/repository-checks.sh` fails a workspace that gains or loses a
// config without this list moving with it.
export default defineConfig({
  test: {
    projects: [
      "packages/runtime",
      "packages/wire",
      "packages/live",
      "packages/gateway",
      "packages/settings",
      "packages/voice",
      "packages/features",
      "packages/credentials",
      "packages/database",
      "packages/service",
      "apps/desktop",
      "apps/web",
      "packages/host",
      "packages/ui",
      "packages/ui/vitest.browser.config.ts",
    ],
  },
});
