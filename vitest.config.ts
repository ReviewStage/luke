import { defineConfig } from "vitest/config";

// One entry per workspace that holds a vitest.config.ts of its own, which is
// every workspace that has tests at all: `no-node-test` refuses a
// `node:test` import in TypeScript, and `pnpm test:harness` is the one
// `node --test` pass left, over the `.mjs` build and lint harnesses.
// `scripts/repository-checks.sh` fails a workspace that gains or loses a
// config without this list moving with it.
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
      "packages/hosted",
      "packages/credentials",
      "packages/analytics",
      "packages/feedback",
      "packages/brain",
      "tools/trace-export",
      "apps/desktop",
      "apps/web",
      "packages/host",
    ],
  },
});
