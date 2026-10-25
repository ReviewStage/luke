import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { panelResolve } from "./scripts/panel-build";
import { siteMarkdown } from "./scripts/site-markdown";

/**
 * The sheets vitest answers as their text where a test imports them
 * `?inline`, rather than as the empty module it answers any other stylesheet
 * with: the shared tokens, so a test reads the palette a page wears its theme
 * in, and the site's own sheet as Tailwind compiles it, so a test reads the
 * utilities a public page's components are drawn with.
 */
const INLINE_STYLESHEETS =
  /\/ui\/src\/tokens\/tokens\.css\?inline$|\/web\/src\/styles\.css\?inline$/;

export default defineConfig({
  // The panel's imports answered as the build answers them, so the web app's
  // root draws in a test what it ships. Streamdown is inlined so that its
  // imports are resolved here at all. The site's Markdown documents are drawn
  // as the build draws them, and the site's sheet compiled as the build
  // compiles it.
  plugins: [panelResolve(), siteMarkdown(), tailwindcss()],
  test: {
    name: "web",
    include: ["tests/**/*.test.ts"],
    css: { include: [INLINE_STYLESHEETS] },
    server: { deps: { inline: ["streamdown"] } },
    // The whole suite stands up a database, and a PGlite test exceeds vitest's
    // 5 s default on a loaded machine; node:test, which ran it before, had no
    // default at all. Suite-wide so the next database test meets the same bar.
    testTimeout: 30_000,
    // A layer hook opens its own PGlite and runs every migration before the
    // file's first test, so it does the same work as a database test and is
    // held to the same bar; vitest's 10 s hook default is marginal under the
    // full suite's contention.
    hookTimeout: 30_000,
  },
});
