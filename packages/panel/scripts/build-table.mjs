// build-table.mjs -- what any bundler of the panel must answer differently from the packages' own imports: the redirects, the trim, the defines, and the static files, as data and resolvers both builds read.
//
// The desktop bundles the panel with esbuild (`apps/desktop/scripts/build.mjs`)
// and the web with Vite (`apps/web/scripts/panel-build.ts`); each wraps this
// table in a thin plugin of its own bundler's shape, so a redirect added here
// reaches both builds and neither restates it. Nothing here imports a bundler.

import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const panelRoot = fileURLToPath(new URL("..", import.meta.url));
const panelRequire = createRequire(path.join(panelRoot, "package.json"));

// The HTML parser Streamdown draws every reply through, `rehype-raw` and
// parse5 under it, loaded after the panel's first paint rather than parsed
// with the bundle every window opens with: Streamdown's own import of it is
// answered with the module that loads it on demand
// (`src/markdown-html-parser.ts`), whose `import()` of the library a
// splitting bundler makes a chunk of its own. The panel's `vitest.config.ts`
// answers the import the same way, so the tests draw what the panel draws.
const MARKDOWN_HTML_PARSER = path.join(panelRoot, "src/markdown-html-parser.ts");

// Pierre's diffs writes each diff as HTML with inline styles, which the
// panel's policy refuses and reports one by one; its import of the writer is
// answered with the diff bundle's own (`src/diff-view/inline-styles.ts`),
// which carries each style where the bundle applies it through the CSSOM.
const DIFF_MARKUP = path.join(panelRoot, "src/diff-view/inline-styles.ts");

/**
 * Each bare import answered with a module of the panel's own, by its
 * specifier, from every importer but that module itself, which reaches the
 * library it stands in front of.
 */
const REDIRECTS = new Map([
  ["rehype-raw", MARKDOWN_HTML_PARSER],
  ["hast-util-to-html", DIFF_MARKUP],
]);

/** The specifiers `redirectOf` answers, for a bundler that filters before it asks. */
export const REDIRECTED = /^(?:rehype-raw|hast-util-to-html)$/;

/** The module of the panel's own an import is answered with, or undefined where it resolves as written. */
export function redirectOf(specifier, importer) {
  const target = REDIRECTS.get(specifier);
  return target === undefined || importer === target ? undefined : target;
}

// The whiteboard bundle (`src/whiteboard/`) is Excalidraw, which reaches
// three things the board never uses through dynamic imports: the Mermaid
// converter, every interface language but English, and the font subsetter an
// SVG export embeds its fonts with (1.8 MB of WebAssembly), the board
// offering no export. Each would be split into chunks the app ships and never
// loads, so each is answered with an empty module rather than carried; the
// English strings are Excalidraw's own built-ins. The locales folder also
// holds the translation-progress table, which Excalidraw imports statically,
// so it is kept.

/** The imports the trim may leave out, for a bundler that filters before it asks. */
export const EXCALIDRAW_UNUSED =
  /^(@excalidraw\/mermaid-to-excalidraw|\.\/locales\/[^/]+\.js|\.\/subset-(shared|worker)\.chunk\.js)$/;
const EXCALIDRAW_KEPT_LOCALE = /^\.\/locales\/percentages-/;
// Only Excalidraw's own imports are answered, since the build is the panel's whole.
const EXCALIDRAW_IMPORTER = /[\\/]@excalidraw[\\/]/;

/** What an import the trim leaves out is answered with. */
export const EXCALIDRAW_UNUSED_MODULE = "export default {};";

/** Whether an import is one of Excalidraw's the board never uses. */
export function excalidrawLeftOut(specifier, importer) {
  return (
    EXCALIDRAW_UNUSED.test(specifier) &&
    EXCALIDRAW_IMPORTER.test(importer ?? "") &&
    !EXCALIDRAW_KEPT_LOCALE.test(specifier)
  );
}

// The whole of Lucide's icons, which a section's icon picker draws every one
// of (`src/desktop/section-icon-picker.tsx`), loaded on demand: its
// `import("lucide-react")` is answered with a module of `icons` alone, read
// from Lucide's CommonJS build, one file the panel's own named imports never
// reach. Note that the ES build would not do, because its barrel, which
// every window's bundle imports a few dozen glyphs through, names each of
// some two thousand icon modules, and a module a splitting bundler can reach
// from the window's entry through any import may be loaded with it.

/** Lucide's CommonJS build, the one file a dynamic import of the package is answered from. */
export const LUCIDE_WHOLE = panelRequire.resolve("lucide-react");

/** The module a dynamic `import("lucide-react")` is answered with, given how the bundler names Lucide's CommonJS file. */
export function lucideWholeModule(file) {
  return `export { icons } from ${JSON.stringify(file)};`;
}

// The worker Pierre's diffs highlights a Files changed list in
// (`src/diff-view/index.ts`'s `highlightPool`), bundled whole as one classic
// script and handed to the diff bundle as text (`DIFF_HIGHLIGHT_WORKER`),
// which starts each worker from a `blob:`, the one place the panel's policy
// admits a worker from. Its WebAssembly engine is answered with nothing,
// since the policy admits no WebAssembly and the bundle asks for Shiki's
// JavaScript engine; carried, it would be 600 KB of the worker's text.
const SHIKI_WASM = /^shiki\/wasm$/;
const shikiWasmLeftOut = {
  name: "shiki-wasm-left-out",
  setup(build) {
    build.onResolve({ filter: SHIKI_WASM }, (args) => ({ path: args.path, namespace: "no-wasm" }));
    build.onLoad({ filter: /.*/, namespace: "no-wasm" }, () => ({
      contents: "export default undefined;",
      loader: "js",
    }));
  },
};

/**
 * The esbuild options the highlight worker is bundled with; each build runs
 * them through its own esbuild, since Vite bundles a classic script no
 * differently, and hands `panelDefines` the text.
 */
export const HIGHLIGHT_WORKER_BUILD = {
  entryPoints: [fileURLToPath(import.meta.resolve("@pierre/diffs/worker/worker.js"))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "chrome140",
  minify: true,
  conditions: ["production"],
  plugins: [shikiWasmLeftOut],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

/** The free identifiers the panel's code reads that a build replaces, given the highlight worker's text. */
export function panelDefines(highlightWorkerText) {
  return {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
    DIFF_HIGHLIGHT_WORKER: JSON.stringify(highlightWorkerText),
  };
}

/**
 * Excalidraw's own stylesheet, which the whiteboard's (`src/whiteboard/index.css`)
 * imports, as its `production` condition names it: the package names no
 * default, so a resolver asking only for styles finds none.
 */
export const EXCALIDRAW_STYLESHEET = fileURLToPath(
  new URL("index.css", import.meta.resolve("@excalidraw/excalidraw")),
);

// Excalidraw's fonts, served from the shell's asset base so the panel loads
// nothing from the network. Xiaolai is left out: it is 13 MB of CJK glyphs,
// and the system's own font draws those characters instead.
const EXCALIDRAW_FONTS = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw"))),
  "fonts",
);
const EXCALIDRAW_FONTS_LEFT_OUT = new Set(["Xiaolai"]);

/**
 * The folders of static files the panel reaches under its shell's asset base
 * (`src/app-platform.ts`'s `assetBase`), each as the directory it is copied
 * from and the path under that base it is served at: Excalidraw's fonts, the
 * harness marks drawn as images rather than traced
 * (`src/harness-marks.tsx`), and the clip Settings plays for each voice
 * (`tools/voice-samples`), so the bundle carries none of their bytes.
 */
export function panelStaticDirectories() {
  return [
    ...readdirSync(EXCALIDRAW_FONTS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !EXCALIDRAW_FONTS_LEFT_OUT.has(entry.name))
      .map((entry) => ({
        from: path.join(EXCALIDRAW_FONTS, entry.name),
        to: `fonts/${entry.name}`,
      })),
    { from: path.join(panelRoot, "marks"), to: "marks" },
    { from: path.join(panelRoot, "voices"), to: "voices" },
  ];
}
