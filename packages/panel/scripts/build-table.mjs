// build-table.mjs -- what any bundler of the panel must answer differently from the packages' own imports: the redirects, the trim, the defines, and the static files, as data and resolvers both builds read.
//
// The desktop bundles the panel with esbuild (`apps/desktop/scripts/build.mjs`)
// and the web with Vite (`apps/web/scripts/panel-build.ts`); each wraps this
// table in a thin plugin of its own bundler's shape, so a redirect added here
// reaches both builds and neither restates it. Nothing here imports a bundler.

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
// panel's policy refuses and reports one by one; its imports of the writer,
// `hast-util-to-html` and, since 1.6, its own `utils/hastToHtml.js` in front
// of it, are answered with the diff bundle's own
// (`src/diff-view/inline-styles.ts`), which carries each style where the
// bundle applies it through the CSSOM.
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

/** Pierre's own writer, as its modules import it by a relative path. */
const PIERRE_MARKUP = /^\.{1,2}\/(?:utils\/)?hastToHtml\.js$/;

/** A module of Pierre's diffs, which alone imports `PIERRE_MARKUP`'s writer. */
const PIERRE_MODULE = /[\\/]@pierre[\\/]diffs[\\/]dist[\\/]/;

/** The specifiers `redirectOf` answers, for a bundler that filters before it asks. */
export const REDIRECTED = /^(?:rehype-raw|hast-util-to-html|\.{1,2}\/(?:utils\/)?hastToHtml\.js)$/;

/** The module of the panel's own an import is answered with, or undefined where it resolves as written. */
export function redirectOf(specifier, importer) {
  if (PIERRE_MARKUP.test(specifier)) {
    return importer !== undefined && PIERRE_MODULE.test(importer) ? DIFF_MARKUP : undefined;
  }
  const target = REDIRECTS.get(specifier);
  return target === undefined || importer === target ? undefined : target;
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
// (`src/diff-view/highlight-pool.ts`, started by `src/diff-view/index.ts`),
// bundled whole as one classic script and handed to the diff bundle as text
// (`DIFF_HIGHLIGHT_WORKER`), which starts each worker from a `blob:`, the one
// place the panel's policy admits a worker from.
//
// The worker is handed every grammar and theme it highlights with by the
// window's thread, which loads each on its own as a language or a theme is
// first drawn; Pierre's own loaders of Shiki's grammars and of the theme
// catalogues throw before they load anything in a worker, so the sets they
// import are answered with a module that throws, rather than carried: some
// 9.7 MB of the worker's text, which every window parsed with the diff
// bundle. Shiki's WebAssembly engine is answered the same way, since the
// bundle colours with Pierre's Highlights, or with Shiki's JavaScript engine
// where WebAssembly is refused, and never with Shiki's own WebAssembly.
const HIGHLIGHT_WORKER_LEFT_OUT =
  /^(?:shiki\/langs|shiki\/wasm|@pierre\/highlights\/themes\/loader|@pierre\/theming\/themes)$/;
const highlightWorkerSetsLeftOut = {
  name: "highlight-worker-sets-left-out",
  setup(build) {
    build.onResolve({ filter: HIGHLIGHT_WORKER_LEFT_OUT }, (args) => ({
      path: args.path,
      namespace: "highlight-worker-left-out",
    }));
    build.onLoad({ filter: /.*/, namespace: "highlight-worker-left-out" }, (args) => ({
      contents: `throw new Error(${JSON.stringify(`${args.path} is left out of the highlight worker, which is handed what it highlights with.`)});`,
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
  plugins: [highlightWorkerSetsLeftOut],
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
 * The folders of static files the panel reaches under its shell's asset base
 * (`src/app-platform.ts`'s `assetBase`), each as the directory it is copied
 * from and the path under that base it is served at: the harness marks
 * drawn as images rather than traced (`src/harness-marks.tsx`), and the clip Settings plays for each voice
 * (`tools/voice-samples`), so the bundle carries none of their bytes.
 */
export function panelStaticDirectories() {
  return [
    { from: path.join(panelRoot, "marks"), to: "marks" },
    { from: path.join(panelRoot, "voices"), to: "voices" },
  ];
}
