import { defineConfig } from "vitest/config";
import { redirectOf } from "./scripts/build-table.mjs";

/**
 * Streamdown's import of `rehype-raw`, and Pierre's of its diff writer,
 * answered with the panel's own modules, as `scripts/build-table.mjs`
 * (`redirectOf`) answers them in both apps' bundles, so a test draws a reply
 * and a diff as the panel does. Both are inlined so that their imports are
 * resolved here at all.
 */
const panelRedirects = {
  name: "panel-redirects",
  enforce: "pre",
  resolveId: (source: string, importer: string | undefined) => redirectOf(source, importer),
} as const;

/**
 * The panel's own stylesheets, and the shared tokens' and components' sheets,
 * which vitest answers as their text where a test imports one `?raw`, or
 * those `?inline` (`testing/container-width.ts`), rather than as the empty module it
 * answers any other stylesheet with.
 */
const PANEL_STYLESHEETS =
  /\/panel\/src\/styles\/[a-z-]+\.css(?:\?raw)?$|\/ui\/src\/(?:styles|tokens\/tokens)\.css\?inline$/;

export default defineConfig({
  plugins: [panelRedirects],
  test: {
    name: "panel",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testing/resize-observer.ts", "src/testing/match-media.ts"],
    css: { include: [PANEL_STYLESHEETS] },
    server: { deps: { inline: ["streamdown", "@pierre/diffs"] } },
  },
});
