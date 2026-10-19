import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Streamdown's import of `rehype-raw` answered with the module that loads
 * the parser on demand, as the desktop's `scripts/build.mjs`
 * (`markdownHtmlParserOnDemand`) answers it in the bundle, so a test draws a
 * reply as the panel does. Streamdown is inlined so that its imports are
 * resolved here at all.
 */
const MARKDOWN_HTML_PARSER = fileURLToPath(
  new URL("./src/markdown-html-parser.ts", import.meta.url),
);

/**
 * The panel's own stylesheets, which vitest answers as their text where a test
 * imports one `?raw` (`testing/container-width.ts`), rather than as the empty
 * module it answers any other stylesheet with.
 */
const PANEL_STYLESHEETS = /\/panel\/src\/styles\/[a-z-]+\.css(?:\?raw)?$/;

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
    name: "panel",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/testing/resize-observer.ts"],
    css: { include: [PANEL_STYLESHEETS] },
    server: { deps: { inline: ["streamdown"] } },
  },
});
