import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { DurationSharding } from "../../scripts/lib/test-shards.mjs";
import { redirectOf } from "./scripts/build-table.mjs";

const panelRedirects = {
  name: "panel-redirects",
  enforce: "pre",
  resolveId: (source: string, importer: string | undefined) => redirectOf(source, importer),
} as const;

const PANEL_STYLESHEETS =
  /\/panel\/src\/styles\/[a-z-]+\.css(?:\?raw)?$|\/ui\/src\/(?:styles|tokens\/tokens)\.css\?inline$|\/panel\/src\/testing\/tailwind\.css\?inline$/;

export default defineConfig({
  plugins: [panelRedirects, tailwindcss()],
  test: {
    name: "panel",
    include: ["src/**/*.test.ts"],
    setupFiles: [
      "../wire/src/testing/file-time-cap.ts",
      "../wire/src/testing/duplicate-keys.ts",
      "src/testing/resize-observer.ts",
      "src/testing/match-media.ts",
    ],
    css: { include: [PANEL_STYLESHEETS] },
    server: { deps: { inline: ["streamdown", "@pierre/diffs"] } },
    sequence: { sequencer: DurationSharding },
  },
});
