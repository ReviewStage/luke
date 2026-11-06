import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
      "../../packages/wire/src/testing/file-time-cap.ts",
      "../../packages/wire/src/testing/duplicate-keys.ts",
      "../../packages/panel/src/testing/resize-observer.ts",
      "../../packages/panel/src/testing/match-media.ts",
    ],
    server: { deps: { inline: ["streamdown"] } },
  },
});
