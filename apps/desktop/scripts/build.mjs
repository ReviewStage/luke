import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BRAND_ASSETS_DIRECTORY } from "@luke/brand/assets-directory";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build } from "esbuild";
import { signingModeDefine } from "./package-config.mjs";
import { tailwindPlugin } from "./tailwind.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = BRAND_ASSETS_DIRECTORY;
const appVersion = JSON.parse(
  await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
).version;
const budgetFile = path.join(appRoot, "bundle-budget.json");
// The Dock takes one large PNG per mode and swaps them as the theme changes.
const DOCK_ICON_IMAGES = {
  "luke-icon-light.png": "luke-icon-light-512.png",
  "luke-icon-dark.png": "luke-icon-dark-512.png",
};

// The whiteboard bundle (`src/renderer/whiteboard/`) is Excalidraw, which
// reaches three things the board never uses through dynamic imports: the
// Mermaid converter, every interface language but English, and the font
// subsetter an SVG export embeds its fonts with (1.8 MB of WebAssembly), the
// board offering no export. An IIFE inlines a dynamic import, so each is
// answered with an empty module here rather than carried; the English
// strings are Excalidraw's own built-ins. The locales folder also holds the
// translation-progress table, which Excalidraw imports statically, so it is
// kept.
const EXCALIDRAW_UNUSED =
  /^(@excalidraw\/mermaid-to-excalidraw|\.\/locales\/[^/]+\.js|\.\/subset-(shared|worker)\.chunk\.js)$/;
const EXCALIDRAW_KEPT_LOCALE = /^\.\/locales\/percentages-/;
const excalidrawTrim = {
  name: "excalidraw-trim",
  setup(build) {
    build.onResolve({ filter: EXCALIDRAW_UNUSED }, (args) =>
      EXCALIDRAW_KEPT_LOCALE.test(args.path)
        ? undefined
        : { path: args.path, namespace: "excalidraw-unused" },
    );
    build.onLoad({ filter: /.*/, namespace: "excalidraw-unused" }, () => ({
      contents: "export default {};",
      loader: "js",
    }));
  },
};

// The HTML parser Streamdown draws every reply through, `rehype-raw` and
// parse5 under it, loaded after the panel's first paint rather than parsed
// with the bundle every window opens with: Streamdown's own import of it is
// answered with the module that loads it on demand
// (`src/renderer/markdown-html-parser.ts`), whose `import()` of the library
// the splitting below makes a chunk of its own. `vitest.config.ts` answers
// the import the same way, so the tests draw what the panel draws.
const MARKDOWN_HTML_PARSER = path.join(appRoot, "src/renderer/markdown-html-parser.ts");
const markdownHtmlParserOnDemand = {
  name: "markdown-html-parser-on-demand",
  setup(build) {
    build.onResolve({ filter: /^rehype-raw$/ }, (args) =>
      args.importer === MARKDOWN_HTML_PARSER ? undefined : { path: MARKDOWN_HTML_PARSER },
    );
  },
};

// The whole of Lucide's icons, which a section's icon picker draws every one
// of (`src/renderer/desktop/section-icon-picker.tsx`), loaded on demand: its
// `import("lucide-react")` is answered with a module of `icons` alone, read
// from Lucide's CommonJS build, one file the panel's own named imports never
// reach. Note that the ES build would not do, because its barrel, which
// every window's bundle imports a few dozen glyphs through, names each of
// some two thousand icon modules, and a module the splitting below can reach
// from the window's entry through any import is loaded with it, so all of
// them would be. The CommonJS file is read in a namespace of its own, so the
// resolver never takes it for the package and keeps answering the named
// imports with the ES build.
const LUCIDE_WHOLE = createRequire(path.join(appRoot, "package.json")).resolve("lucide-react");
const LUCIDE_WHOLE_FILE = "lucide-whole-file";
const lucideWholeOnDemand = {
  name: "lucide-whole-on-demand",
  setup(build) {
    build.onResolve({ filter: /^lucide-react$/ }, (args) =>
      args.kind === "dynamic-import" ? { path: "icons", namespace: "lucide-whole" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "lucide-whole" }, () => ({
      contents: `export { icons } from "${LUCIDE_WHOLE_FILE}";`,
      loader: "js",
      resolveDir: appRoot,
    }));
    build.onResolve({ filter: new RegExp(`^${LUCIDE_WHOLE_FILE}$`) }, () => ({
      path: LUCIDE_WHOLE,
      namespace: LUCIDE_WHOLE_FILE,
    }));
    build.onLoad({ filter: /.*/, namespace: LUCIDE_WHOLE_FILE }, async (args) => ({
      contents: await fs.readFile(args.path, "utf8"),
      loader: "js",
      resolveDir: path.dirname(args.path),
    }));
  },
};

// Pierre's diffs writes each diff as HTML with inline styles, which the
// panel's policy refuses and reports one by one; its import of the writer is
// answered with the diff bundle's own (`src/renderer/diff-view/inline-styles.ts`),
// which carries each style where the bundle applies it through the CSSOM.
const DIFF_MARKUP = path.join(appRoot, "src/renderer/diff-view/inline-styles.ts");
const diffMarkupInDataAttributes = {
  name: "diff-markup-in-data-attributes",
  setup(build) {
    build.onResolve({ filter: /^hast-util-to-html$/ }, (args) =>
      args.importer === DIFF_MARKUP ? undefined : { path: DIFF_MARKUP },
    );
  },
};

// Excalidraw's fonts, copied beside the whiteboard bundle so the panel loads
// nothing from the network. Xiaolai is left out: it is 13 MB of CJK glyphs,
// and the system's own font draws those characters instead.
const EXCALIDRAW_FONTS = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw"))),
  "fonts",
);
const EXCALIDRAW_FONTS_LEFT_OUT = new Set(["Xiaolai"]);

// The commit the bundle is cut from, which Settings › Updates names
// (`@luke/host`'s `build-commit.ts`): the short SHA, whether the tree held
// uncommitted changes (a new file the bundle may carry counts too), and the
// branch unless the head is detached, as a tag's checkout is. A build made
// where git cannot answer stamps none.
function git(...args) {
  return execFileSync("git", args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function buildCommit() {
  try {
    const commit = {
      sha: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain") !== "",
    };
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    if (branch !== "HEAD") commit.branch = branch;
    return commit;
  } catch {
    return null;
  }
}

// The files that load before a bundle runs, as paths under `dist/`: the bundle
// itself and every chunk it reaches through static imports, at any depth. A
// bundle the metafile does not describe is one file, as an IIFE is.
function loadedUpFront(metafile, bundle) {
  const outputs = new Map(
    Object.entries(metafile.outputs).map(([file, output]) => [
      path.relative(outputRoot, path.resolve(file)),
      output,
    ]),
  );
  const loaded = new Set([bundle]);
  for (const file of loaded) {
    for (const { path: imported, kind } of outputs.get(file)?.imports ?? []) {
      if (kind === "import-statement")
        loaded.add(path.relative(outputRoot, path.resolve(imported)));
    }
  }
  return [...loaded];
}

// A document loads the renderer as a module script, or the entry's first
// `import` is a syntax error and the window stays blank.
async function assertModuleEntry(document) {
  const html = await fs.readFile(path.join(outputRoot, "renderer", document), "utf8");
  if (!html.includes('<script type="module" src="renderer.js"></script>')) {
    throw new Error(`${document} must load renderer.js with <script type="module">`);
  }
}

function sentryPlugins() {
  if (!process.env.SENTRY_AUTH_TOKEN) return [];
  return [
    sentryEsbuildPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "stage-review",
      project: "luke-desktop",
      release: { name: `Luke@${appVersion}` },
    }),
  ];
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "icon"), { recursive: true });

// The renderer every window parses, as ES modules: an entry and the chunks it
// imports, with no wrapper around the whole and nothing kept apart for one,
// which is about 6 KB gzipped smaller than the same code as one script. The
// chunks are named by their content, because esbuild names every shared one
// `chunk`. The metafile is what the bundle budget reads the chunks off.
const rendererBuild = build({
  entryPoints: { renderer: path.join(appRoot, "src/renderer/index.tsx") },
  outdir: path.join(outputRoot, "renderer"),
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  metafile: true,
  target: "chrome140",
  jsx: "automatic",
  minify: true,
  plugins: [markdownHtmlParserOnDemand, lucideWholeOnDemand, ...sentryPlugins()],
  sourcemap: true,
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
    // The analytics project the screen recorder files into, from the
    // packaging environment rather than source, where secret scanners
    // cannot tell a published project key from a real secret. A build without one records nothing at all — the same
    // kill switch the site's own counting has, so a local run or an
    // unconfigured build cannot record into a stranger's project.
    PACKAGED_POSTHOG_PROJECT_API_KEY: JSON.stringify(process.env.POSTHOG_PROJECT_API_KEY ?? ""),
  },
});

// A plan's diagrams, Mermaid, its own bundle so the bundle every window
// parses never carries it; the plan's page loads it the first time a
// diagram is shown (`src/renderer/diagram/contract.ts`). Unlike the bundles
// below it is an ES module split into chunks, because Mermaid reaches each
// diagram type and its layouts through dynamic imports, which a script would
// inline all of (about 950 KB gzipped) where a flowchart needs a quarter of
// that. Its chunks stand in `diagram/`, apart from the renderer's own, and
// its metafile is what the bundle budget reads them off.
const diagramBuild = build({
  entryPoints: { diagram: path.join(appRoot, "src/renderer/diagram/index.ts") },
  outdir: path.join(outputRoot, "renderer"),
  chunkNames: "diagram/[name]-[hash]",
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  metafile: true,
  target: "chrome140",
  minify: true,
  conditions: ["production"],
  plugins: sentryPlugins(),
  sourcemap: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
});

// A Files changed diff, Pierre's diffs with Shiki colouring it, its own
// bundle so the bundle every window parses never carries either; the view
// loads it the first time a diff is shown (`src/renderer/diff-view/contract.ts`).
// An ES module split into chunks, as the diagrams' is, because Shiki reaches
// each language's grammar and each theme through a dynamic import, which a
// script would inline every one of, where a diff needs its file's alone. Its
// chunks stand in `diff-view/`, and its metafile is what the bundle budget
// reads them off. Pierre draws in a shadow root with no React of its own.
const diffViewBuild = build({
  entryPoints: { "diff-view": path.join(appRoot, "src/renderer/diff-view/index.ts") },
  outdir: path.join(outputRoot, "renderer"),
  chunkNames: "diff-view/[name]-[hash]",
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  metafile: true,
  target: "chrome140",
  minify: true,
  conditions: ["production"],
  plugins: [diffMarkupInDataAttributes, ...sentryPlugins()],
  sourcemap: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
});

await Promise.all([
  rendererBuild,
  diagramBuild,
  diffViewBuild,
  build({
    entryPoints: [path.join(appRoot, "src/main/index.ts")],
    outfile: path.join(outputRoot, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    plugins: sentryPlugins(),
    define: {
      PACKAGED_SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN ?? ""),
      PACKAGED_BUILD_COMMIT: JSON.stringify(buildCommit()),
      // Whether this bundle rides in a Developer ID release, which is what
      // decides the name — and so the state directory and Keychain entry —
      // the run answers to; see `@luke/host`'s app-identity.ts.
      ...signingModeDefine(process.env),
    },
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(appRoot, "src/preload/index.ts")],
    outfile: path.join(outputRoot, "preload.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    // The stylesheet entry `@import`s the renderer's stylesheets; esbuild
    // inlines them into the single `styles.css` the renderer HTML links. The
    // Tailwind entry among them is compiled by the plugin as it is loaded.
    entryPoints: [path.join(appRoot, "src/renderer/styles/index.css")],
    outfile: path.join(outputRoot, "renderer/styles.css"),
    bundle: true,
    target: "chrome140",
    plugins: [tailwindPlugin()],
    minify: true,
    sourcemap: true,
    logLevel: "info",
  }),
  // The Plans tab's whiteboard, its own bundle and stylesheet so the bundle
  // every window parses never carries Excalidraw; the tab loads both the
  // first time a board is shown (`src/renderer/whiteboard/contract.ts`).
  build({
    entryPoints: [path.join(appRoot, "src/renderer/whiteboard/index.tsx")],
    outfile: path.join(outputRoot, "renderer/whiteboard.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    jsx: "automatic",
    minify: true,
    conditions: ["production"],
    plugins: [excalidrawTrim, ...sentryPlugins()],
    sourcemap: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"', "process.env.IS_PREACT": '"false"' },
  }),
  // A File tab's tree, its own bundle so the bundle every window parses
  // never carries Pierre's tree; the tab loads it the first time a tree is
  // shown (`src/renderer/file-tree/contract.ts`). Pierre draws with its own
  // Preact inside a shadow root, so no React rides along, and its styles
  // reach the shadow root as constructed sheets, which the panel's policy
  // admits.
  build({
    entryPoints: [path.join(appRoot, "src/renderer/file-tree/index.ts")],
    outfile: path.join(outputRoot, "renderer/file-tree.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    minify: true,
    conditions: ["production"],
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  // The editor bundle, a plan's editor and an agent's message box, its own
  // bundle so the bundle every window parses, the voice window's among them,
  // never carries TipTap; the panel starts loading it as it first paints
  // (`src/renderer/plan-editor/contract.ts`). It mounts with TipTap's own
  // DOM, so no React rides along.
  build({
    entryPoints: [path.join(appRoot, "src/renderer/plan-editor/index.ts")],
    outfile: path.join(outputRoot, "renderer/plan-editor.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    minify: true,
    conditions: ["production"],
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  // A Terminal tab's screen, its own bundle and stylesheet so the bundle
  // every window parses never carries xterm.js; the tab loads both the first
  // time a terminal is shown (`src/renderer/terminal/contract.ts`). It draws
  // on its own canvas, so no React rides along.
  build({
    entryPoints: [path.join(appRoot, "src/renderer/terminal/index.ts")],
    outfile: path.join(outputRoot, "renderer/terminal.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    minify: true,
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(appRoot, "src/renderer/terminal/index.css")],
    outfile: path.join(outputRoot, "renderer/terminal.css"),
    bundle: true,
    target: "chrome140",
    minify: true,
    logLevel: "info",
  }),
  // Session replay's recorder, its own bundle so the bundle every window
  // parses never carries rrweb; session replay loads it before it starts the
  // client, in a window that records (`src/renderer/session-recorder/contract.ts`).
  build({
    entryPoints: [path.join(appRoot, "src/renderer/session-recorder/index.ts")],
    outfile: path.join(outputRoot, "renderer/session-recorder.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    minify: true,
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
  }),
  // The avatar feed's AudioWorklet, its own bundle because a worklet loads a
  // module by URL into a scope of its own on the audio thread; the voice
  // window adds it from beside `voice.html`, whose `script-src 'self'` is the
  // policy a worklet module answers to (`@luke/voice/avatar-pcm`).
  build({
    entryPoints: [path.join(appRoot, "src/renderer/avatar-feed/pcm-tee-worklet.ts")],
    outfile: path.join(outputRoot, "renderer/pcm-tee-worklet.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "chrome140",
    minify: true,
    sourcemap: true,
    logLevel: "info",
  }),
  // A call's avatar, its own bundle so the bundle every window parses never
  // carries Keyframe's SDK or the LiveKit client under it; the panel
  // loads it the first time an avatar is shown
  // (`@luke/ui/avatar-session-contract`).
  build({
    entryPoints: [path.join(appRoot, "src/renderer/avatar-session/index.ts")],
    outfile: path.join(outputRoot, "renderer/avatar-session.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    minify: true,
    conditions: ["production"],
    plugins: sentryPlugins(),
    sourcemap: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  build({
    entryPoints: [path.join(appRoot, "src/renderer/whiteboard/index.css")],
    outfile: path.join(outputRoot, "renderer/whiteboard.css"),
    bundle: true,
    target: "chrome140",
    conditions: ["production"],
    // Its `url(./fonts/...)` stay as written, and reach the fonts copied beside it below.
    external: ["*.woff2"],
    minify: true,
    logLevel: "info",
  }),
]);

await Promise.all([
  fs.copyFile(
    path.join(appRoot, "src/renderer/index.html"),
    path.join(outputRoot, "renderer/index.html"),
  ),
  // The hidden voice window's document, over the same `renderer.js`: its role
  // is main's answer, its policy allows no network, and the recording carries
  // no words in any case (`src/renderer/session-replay.ts`).
  fs.copyFile(
    path.join(appRoot, "src/renderer/voice.html"),
    path.join(outputRoot, "renderer/voice.html"),
  ),
  // The floating call window's document, on the same terms as the voice
  // window's, with the stylesheet the call card is drawn in.
  fs.copyFile(
    path.join(appRoot, "src/renderer/call.html"),
    path.join(outputRoot, "renderer/call.html"),
  ),
]);

await Promise.all(["index.html", "voice.html", "call.html"].map(assertModuleEntry));

await Promise.all(
  (await fs.readdir(EXCALIDRAW_FONTS))
    .filter((family) => !EXCALIDRAW_FONTS_LEFT_OUT.has(family))
    .map((family) =>
      fs.cp(path.join(EXCALIDRAW_FONTS, family), path.join(outputRoot, "renderer/fonts", family), {
        recursive: true,
      }),
    ),
);

// The harness marks drawn as images rather than traced (`src/renderer/harness-marks.tsx`),
// copied beside the bundle so the panel reaches them as its own files and the
// bundle carries none of their bytes.
await fs.cp(path.join(appRoot, "src/renderer/marks"), path.join(outputRoot, "renderer/marks"), {
  recursive: true,
});

await Promise.all(
  Object.entries(DOCK_ICON_IMAGES).map(([name, source]) =>
    fs.copyFile(path.join(brandRoot, "icon", source), path.join(outputRoot, "icon", name)),
  ),
);

// The renderer bundle is what a browser context parses at every window open,
// the panels' and the hidden voice window's alike, so its compressed size is a
// cost the user pays rather than one the build absorbs. The baseline is recorded rather than
// derived, because the number worth holding is the one a reviewer agreed to: a
// dependency that adds a fifth to the panel is a decision, and
// `LUKE_UPDATE_BUNDLE_BUDGET=1` is how that decision is written down once it has
// been made.
//
// Note that a bundle is measured with the chunks it imports, because those load
// with it before anything runs; a chunk reached only by a dynamic `import()` is
// fetched when that code first runs, and is left out. Each file is gzipped on
// its own, as each is read on its own.
const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
const metafile = {
  outputs: {
    ...(await rendererBuild).metafile.outputs,
    ...(await diagramBuild).metafile.outputs,
    ...(await diffViewBuild).metafile.outputs,
  },
};
const measured = Object.fromEntries(
  await Promise.all(
    Object.keys(budget.gzipBytes).map(async (bundle) => {
      const sizes = await Promise.all(
        loadedUpFront(metafile, bundle).map(
          async (file) =>
            gzipSync(await fs.readFile(path.join(outputRoot, file)), { level: 9 }).length,
        ),
      );
      return [bundle, sizes.reduce((sum, bytes) => sum + bytes, 0)];
    }),
  ),
);

if (process.env.LUKE_UPDATE_BUNDLE_BUDGET === "1") {
  await fs.writeFile(
    budgetFile,
    `${JSON.stringify({ ...budget, gzipBytes: measured }, undefined, 2)}\n`,
  );
  for (const [bundle, bytes] of Object.entries(measured)) {
    process.stdout.write(`bundle budget recorded: ${bundle} ${bytes} gzipped bytes\n`);
  }
} else {
  const exceeded = Object.entries(measured).flatMap(([bundle, bytes]) => {
    const ceiling = Math.floor(budget.gzipBytes[bundle] * (1 + budget.slack));
    return bytes > ceiling ? [{ bundle, bytes, ceiling }] : [];
  });
  if (exceeded.length > 0) {
    for (const { bundle, bytes, ceiling } of exceeded) {
      console.error(
        `error: ${bundle} is ${bytes} gzipped bytes, over its ceiling of ${ceiling} (baseline ${budget.gzipBytes[bundle]} plus ${budget.slack * 100}%)`,
      );
    }
    console.error(
      "Reduce the bundle, or record the new baseline with LUKE_UPDATE_BUNDLE_BUDGET=1 and say why in the pull request.",
    );
    process.exitCode = 1;
  }
}
