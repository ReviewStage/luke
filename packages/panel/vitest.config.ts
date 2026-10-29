import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { reactCompilerVite } from "../../scripts/lib/react-compiler.mjs";
import { DurationSharding } from "../../scripts/lib/test-shards.mjs";
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
 * answers any other stylesheet with; and the apps' Tailwind entry, which
 * Tailwind's plugin compiles as it does for the catalog, so a test lays the
 * utilities `@luke/ui`'s controls draw with beside their sheets.
 */
const PANEL_STYLESHEETS =
  /\/panel\/src\/styles\/[a-z-]+\.css(?:\?raw)?$|\/ui\/src\/(?:styles|tokens\/tokens)\.css\?inline$|\/panel\/src\/testing\/tailwind\.css\?inline$/;

export default defineConfig({
  // The React Compiler trial, so the tests draw what the bundles ship
  // (`scripts/lib/react-compiler.mjs`).
  plugins: [reactCompilerVite(), panelRedirects, tailwindcss()],
  test: {
    name: "panel",
    include: ["src/**/*.test.ts"],
    setupFiles: [
      "../wire/src/testing/file-time-cap.ts",
      "src/testing/resize-observer.ts",
      "src/testing/match-media.ts",
    ],
    css: { include: [PANEL_STYLESHEETS] },
    server: { deps: { inline: ["streamdown", "@pierre/diffs"] } },
    // CI's shards split the files by their recorded time (`scripts/lib/test-shards.mjs`).
    sequence: { sequencer: DurationSharding },
    // Note that the compiler's Babel pass runs on Vite's main thread as a
    // test's first lazy import is transformed, inside that test's time: with
    // Channels on, desktop-shell's sidebar test took 2.35 s against 0.41 s
    // without it on a laptop, and past 5 s on a CI shard.
    testTimeout: 15_000,
  },
});
