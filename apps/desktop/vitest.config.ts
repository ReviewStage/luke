import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Streamdown's import of `rehype-raw` answered with the module that loads
 * the parser on demand, as the panel's build table (`@luke/panel/build-table`)
 * answers it in the bundle, so a test draws a reply as the panel does.
 * Streamdown is inlined so that its imports are resolved here at all.
 */
const MARKDOWN_HTML_PARSER = fileURLToPath(
  new URL("../../packages/panel/src/markdown-html-parser.ts", import.meta.url),
);

export default defineConfig({
  plugins: [
    {
      name: "markdown-html-parser-on-demand",
      enforce: "pre",
      resolveId: (source, importer) =>
        source === "rehype-raw" && importer !== MARKDOWN_HTML_PARSER
          ? MARKDOWN_HTML_PARSER
          : undefined,
    },
  ],
  test: {
    name: "desktop",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: [
      "../../packages/panel/src/testing/resize-observer.ts",
      "../../packages/panel/src/testing/match-media.ts",
    ],
    server: { deps: { inline: ["streamdown"] } },
  },
});
