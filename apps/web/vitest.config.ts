import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { DurationSharding } from "../../scripts/lib/test-shards.mjs";
import { panelResolve } from "./scripts/panel-build";
import { siteMarkdown } from "./scripts/site-markdown";

const INLINE_STYLESHEETS =
  /\/ui\/src\/tokens\/tokens\.css\?inline$|\/web\/src\/styles\.css\?inline$/;

export default defineConfig({
  plugins: [panelResolve(), siteMarkdown(), tailwindcss()],
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    setupFiles: [
      "../../packages/wire/src/testing/file-time-cap.ts",
      "../../packages/wire/src/testing/duplicate-keys.ts",
      "./tests/support/refused-socket.ts",
    ],
    globalSetup: ["../../packages/database/src/testing/migrated-pglite-setup.ts"],
    css: { include: [INLINE_STYLESHEETS] },
    server: { deps: { inline: ["streamdown"] } },
    sequence: { sequencer: DurationSharding },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
