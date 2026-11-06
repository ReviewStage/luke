import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const panelRoot = fileURLToPath(new URL("..", import.meta.url));
const panelRequire = createRequire(path.join(panelRoot, "package.json"));

const MARKDOWN_HTML_PARSER = path.join(panelRoot, "src/markdown-html-parser.ts");

const DIFF_MARKUP = path.join(panelRoot, "src/diff-view/inline-styles.ts");

const REDIRECTS = new Map([
  ["rehype-raw", MARKDOWN_HTML_PARSER],
  ["hast-util-to-html", DIFF_MARKUP],
]);

const PIERRE_MARKUP = /^\.{1,2}\/(?:utils\/)?hastToHtml\.js$/;

const PIERRE_MODULE = /[\\/]@pierre[\\/]diffs[\\/]dist[\\/]/;

export const REDIRECTED = /^(?:rehype-raw|hast-util-to-html|\.{1,2}\/(?:utils\/)?hastToHtml\.js)$/;

export function redirectOf(specifier, importer) {
  if (PIERRE_MARKUP.test(specifier)) {
    return importer !== undefined && PIERRE_MODULE.test(importer) ? DIFF_MARKUP : undefined;
  }
  const target = REDIRECTS.get(specifier);
  return target === undefined || importer === target ? undefined : target;
}

export const LUCIDE_WHOLE = panelRequire.resolve("lucide-react");

export function lucideWholeModule(file) {
  return `export { icons } from ${JSON.stringify(file)};`;
}

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

export function panelDefines(highlightWorkerText) {
  return {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
    DIFF_HIGHLIGHT_WORKER: JSON.stringify(highlightWorkerText),
  };
}

export function panelStaticDirectories() {
  return [{ from: path.join(panelRoot, "marks"), to: "marks" }];
}
