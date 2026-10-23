// build-table.mjs -- what any bundler of the panel must answer differently from the packages' own imports: the redirects, the trim, the defines, and the static files, as data and resolvers both builds read.
//
// The desktop bundles the panel with esbuild (`apps/desktop/scripts/build.mjs`)
// and the web with Vite (`apps/web/scripts/panel-build.ts`); each wraps this
// table in a thin plugin of its own bundler's shape, so a redirect added here
// reaches both builds and neither restates it. Nothing here imports a bundler.

import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

// Excalidraw names each font face at two addresses: its copy under the asset
// path (`src/whiteboard/asset-path.ts`), and the same file on esm.sh after it,
// for a page that serves none. The panel's policy admits fonts from its own
// origin alone, and Chromium checks every address of a face against it as the
// face is made, whether or not the first one serves it, so every face
// Excalidraw registers (some 230, the Chinese font's slices among them) is
// refused and reported the moment a board opens, and nothing is gained: the
// policy never lets the second address load. So the line that adds esm.sh is
// taken out of Excalidraw's code and each face names its own copy alone. The
// Chinese font is the one left out of the copies (`panelStaticDirectories`),
// so its text draws in the next font, as it always has under the policy.

/** Excalidraw's own scripts, for a bundler that filters before it asks. */
export const EXCALIDRAW_SCRIPT = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/].+\.js$/;
// The call that adds the esm.sh address to a face, as both of Excalidraw's
// builds spell it, which becomes a call that adds nothing. It starts at the
// literal `.push(` so that no repeated class leads the pattern.
const FONT_FALLBACK_PUSH = /\.push\(new URL\([\w$]+, ?[\w$]+\.ASSETS_FALLBACK_URL\)\)/g;

/**
 * An Excalidraw script with its fonts' esm.sh address taken out, or undefined
 * where the script names none. A script that names the address in a shape this
 * does not know fails the build, so an upgrade cannot bring the address back unseen.
 */
export function excalidrawWithoutFontFallback(code) {
  if (!code.includes("ASSETS_FALLBACK_URL")) return undefined;
  const without = code.replace(FONT_FALLBACK_PUSH, ".concat()");
  if (without === code || /\.ASSETS_FALLBACK_URL\b/.test(without)) {
    throw new Error(
      "Excalidraw's font fallback is no longer where the panel's build table takes it out (build-table.mjs).",
    );
  }
  return without;
}

/** The same in esbuild's shape, for the desktop's build and for Vite's prebundling of Excalidraw in development. */
export const excalidrawFontsLocal = {
  name: "excalidraw-fonts-local",
  setup(build) {
    build.onLoad({ filter: EXCALIDRAW_SCRIPT }, async (args) => {
      const contents = excalidrawWithoutFontFallback(await readFile(args.path, "utf8"));
      return contents === undefined ? undefined : { contents, loader: "js" };
    });
  },
};

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
// (`src/diff-view/index.ts`'s `listHighlighting`), bundled whole as one
// classic script whose text each build answers
// `src/diff-view/highlight-worker-script.ts` with, a chunk the diff bundle
// fetches once its pool starts and starts each worker from as a `blob:`, the
// one place the panel's policy admits a worker from.
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
 * differently, and answers `HIGHLIGHT_WORKER_SCRIPT` with the text.
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

/** The module each build answers with the highlight worker's text, which the diff bundle imports on demand. */
export const HIGHLIGHT_WORKER_SCRIPT = path.join(
  panelRoot,
  "src/diff-view/highlight-worker-script.ts",
);

/** What `HIGHLIGHT_WORKER_SCRIPT` is answered with, given the worker's text. */
export function highlightWorkerScriptModule(text) {
  return `export const HIGHLIGHT_WORKER_SCRIPT = ${JSON.stringify(text)};`;
}

/** The free identifiers the panel's code reads that a build replaces. */
export function panelDefines() {
  return {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
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
