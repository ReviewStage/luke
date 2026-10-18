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
// The one release every build's reports and uploaded source maps share, a
// Developer ID build's or not: main reports under it (`PACKAGED_SENTRY_RELEASE`)
// and the upload below files the maps under it, so the two cannot drift.
const sentryRelease = `Luke@${appVersion}`;
// Whether this build uploads its source maps (`sentryPlugins` below): where
// the token is set, unless the build is a Release workflow rehearsal (a
// manual dispatch), which publishes no release and so must not file maps
// under the real one. A tag's build and a release cut by hand both upload.
const uploadsSourceMaps =
  Boolean(process.env.SENTRY_AUTH_TOKEN) && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch";
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
// board offering no export. Each would be split into chunks the app ships and
// never loads, so each is answered with an empty module here rather than
// carried; the English strings are Excalidraw's own built-ins. The locales
// folder also holds the translation-progress table, which Excalidraw imports
// statically, so it is kept.
const EXCALIDRAW_UNUSED =
  /^(@excalidraw\/mermaid-to-excalidraw|\.\/locales\/[^/]+\.js|\.\/subset-(shared|worker)\.chunk\.js)$/;
const EXCALIDRAW_KEPT_LOCALE = /^\.\/locales\/percentages-/;
// Only Excalidraw's own imports are answered, since the build is the renderer's whole.
const EXCALIDRAW_IMPORTER = /[\\/]@excalidraw[\\/]/;
const excalidrawTrim = {
  name: "excalidraw-trim",
  setup(build) {
    build.onResolve({ filter: EXCALIDRAW_UNUSED }, (args) =>
      !EXCALIDRAW_IMPORTER.test(args.importer) || EXCALIDRAW_KEPT_LOCALE.test(args.path)
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
// (`@luke/panel`'s `markdown-html-parser.ts`), whose `import()` of the library
// the splitting below makes a chunk of its own. `vitest.config.ts` answers
// the import the same way, so the tests draw what the panel draws.
const MARKDOWN_HTML_PARSER = path.join(appRoot, "../../packages/panel/src/markdown-html-parser.ts");
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

// The stylesheets a bundle's entry imports for itself (`import "./index.css"`),
// each built on its own below to the file named here. esbuild writes a
// stylesheet a split chunk imports and never loads it, so the import is
// answered with a module that links the built file from beside the chunk
// that imports it, which is where the renderer's chunks all stand. A bundler
// that loads a chunk's stylesheets itself, as Vite does, needs none of this.
const WHITEBOARD_STYLESHEET = path.join(appRoot, "src/renderer/whiteboard/index.css");
const TERMINAL_STYLESHEET = path.join(appRoot, "src/renderer/terminal/index.css");
const SIDE_STYLESHEETS = new Map([
  [WHITEBOARD_STYLESHEET, "whiteboard.css"],
  [TERMINAL_STYLESHEET, "terminal.css"],
]);
const sideStylesheetsLinked = {
  name: "side-stylesheets-linked",
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => {
      const stylesheet = path.resolve(args.resolveDir, args.path);
      return args.kind === "import-statement" && SIDE_STYLESHEETS.has(stylesheet)
        ? { path: stylesheet, namespace: "side-stylesheet" }
        : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "side-stylesheet" }, (args) => ({
      contents: [
        'const link = document.createElement("link");',
        'link.rel = "stylesheet";',
        `link.href = new URL(${JSON.stringify(SIDE_STYLESHEETS.get(args.path))}, import.meta.url).href;`,
        "document.head.append(link);",
      ].join("\n"),
      loader: "js",
    }));
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

// A document loads its window's entry as a module script, or the entry's
// first `import` is a syntax error and the window stays blank.
async function assertModuleEntry(document, entry) {
  const html = await fs.readFile(path.join(outputRoot, "renderer", document), "utf8");
  if (!html.includes(`<script type="module" src="${entry}"></script>`)) {
    throw new Error(`${document} must load ${entry} with <script type="module">`);
  }
}

// The source-map upload, for a build that uploads (`uploadsSourceMaps`). A
// failed upload fails the build.
// Note that the plugin only logs a refused release or upload unless an
// `errorHandler` throws, whatever its documentation says, so a release
// could otherwise ship with no maps behind it and a green build.
function sentryPlugins() {
  if (!uploadsSourceMaps) return [];
  return [
    sentryEsbuildPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "stage-review",
      project: "luke-desktop",
      release: { name: sentryRelease },
      errorHandler: (error) => {
        throw error;
      },
    }),
  ];
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "icon"), { recursive: true });

// One entry per window role, by the bundle it is built into: its source, and
// the document that loads it, copied beside it below.
const WINDOW_ENTRIES = {
  panel: { source: "src/renderer/index.tsx", document: "index.html" },
  voice: { source: "src/renderer/voice/index.tsx", document: "voice.html" },
  call: { source: "src/renderer/call/index.tsx", document: "call.html" },
};

// The bundles too large for any window's entry, each reached through a
// dynamic `import()` of its own entry (`src/renderer/bundle-loader.ts`), so no
// window parses one before it is needed: the editors (TipTap), the whiteboard
// (Excalidraw), a File tab's tree (Pierre's tree), a Terminal tab's screen
// (xterm.js), a plan's diagrams (Mermaid), a Files changed diff (Pierre's
// diffs and Shiki), the Factory's scene host (Three.js), a call's avatar
// (Keyframe's SDK over LiveKit), and session replay's recorder (rrweb). Each is an entry rather than a chunk only so that
// it keeps a name of its own for the budget to read; what each reaches
// through dynamic imports of its own, a diagram type's layout or a language's
// grammar, is a chunk of its own, loaded when it is drawn.
const SIDE_BUNDLE_ENTRIES = {
  "plan-editor": "src/renderer/plan-editor/index.ts",
  whiteboard: "src/renderer/whiteboard/index.tsx",
  "file-tree": "../../packages/panel/src/file-tree/index.ts",
  terminal: "src/renderer/terminal/index.ts",
  diagram: "src/renderer/diagram/index.ts",
  "diff-view": "src/renderer/diff-view/index.ts",
  "factory-world": "src/renderer/factory-world/scene/index.ts",
  "avatar-session": "src/renderer/avatar-session/index.ts",
  "session-recorder": "src/renderer/session-recorder/index.ts",
};

// Each of the Factory's worlds, a bundle of its own beside the scene host's,
// found by its folder (`src/renderer/factory-world/worlds/<key>/index.ts`),
// so a world is added without a line here and one world's weight never loads
// with another's.
const WORLDS_ROOT = "src/renderer/factory-world/worlds";
const WORLD_BUNDLE_ENTRIES = Object.fromEntries(
  (await fs.readdir(path.join(appRoot, WORLDS_ROOT), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => [`factory-world-${entry.name}`, `${WORLDS_ROOT}/${entry.name}/index.ts`]),
);

// The bundles that only ever load after others have, each with those
// others: the scene host loads only in the panel, and a world only once the
// host has. Each is measured beyond what those loaded already, so the host's
// baseline is Three.js and its own code, and a world's is its own code and
// whatever of Three.js it reaches that the host does not.
const LOADED_AFTER = {
  "renderer/factory-world.js": ["renderer/panel.js"],
  ...Object.fromEntries(
    Object.keys(WORLD_BUNDLE_ENTRIES).map((name) => [
      `renderer/${name}.js`,
      ["renderer/panel.js", "renderer/factory-world.js"],
    ]),
  ),
};

// The renderer, as ES modules: one entry per window role, so a window parses
// only the surface it mounts, the side bundles above, and the chunks the
// entries share, with no wrapper around the whole, which is about 6 KB
// gzipped smaller than the same code as one script. The chunks are named by
// their content, because esbuild names every shared one `chunk`. The metafile
// is what the bundle budget reads the chunks off.
const rendererBuild = build({
  entryPoints: Object.fromEntries([
    ...Object.entries(WINDOW_ENTRIES).map(([name, { source }]) => [
      name,
      path.join(appRoot, source),
    ]),
    ...Object.entries({ ...SIDE_BUNDLE_ENTRIES, ...WORLD_BUNDLE_ENTRIES }).map(([name, source]) => [
      name,
      path.join(appRoot, source),
    ]),
  ]),
  outdir: path.join(outputRoot, "renderer"),
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  metafile: true,
  target: "chrome140",
  jsx: "automatic",
  minify: true,
  conditions: ["production"],
  plugins: [
    markdownHtmlParserOnDemand,
    lucideWholeOnDemand,
    diffMarkupInDataAttributes,
    excalidrawTrim,
    sideStylesheetsLinked,
    ...sentryPlugins(),
  ],
  // Every map is written beside its file and named by none: the maps stay
  // out of the app (`electron-builder-config.mjs`), so a comment would point
  // at a file that is not there. The upload finds each by `<file>.map`.
  sourcemap: "external",
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.IS_PREACT": '"false"',
    // The analytics project the screen recorder files into, from the
    // packaging environment rather than source, where secret scanners
    // cannot tell a published project key from a real secret. A build without one records nothing at all — the same
    // kill switch the site's own counting has, so a local run or an
    // unconfigured build cannot record into a stranger's project.
    PACKAGED_POSTHOG_PROJECT_API_KEY: JSON.stringify(process.env.POSTHOG_PROJECT_API_KEY ?? ""),
  },
});

await Promise.all([
  rendererBuild,
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
      PACKAGED_SENTRY_RELEASE: JSON.stringify(sentryRelease),
      PACKAGED_BUILD_COMMIT: JSON.stringify(buildCommit()),
      // Whether this bundle rides in a Developer ID release, which is what
      // decides the name — and so the state directory and Keychain entry —
      // the run answers to; see `@luke/host`'s app-identity.ts.
      ...signingModeDefine(process.env),
    },
    sourcemap: "external",
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
    sourcemap: "external",
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
    sourcemap: "external",
    logLevel: "info",
  }),
  // The stylesheets the whiteboard's and a Terminal tab's entries import,
  // each linked as its entry runs (`sideStylesheetsLinked` above).
  build({
    entryPoints: [WHITEBOARD_STYLESHEET],
    outfile: path.join(outputRoot, "renderer", SIDE_STYLESHEETS.get(WHITEBOARD_STYLESHEET)),
    bundle: true,
    target: "chrome140",
    conditions: ["production"],
    // Its `url(./fonts/...)` stay as written, and reach the fonts copied beside it below.
    external: ["*.woff2"],
    minify: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [TERMINAL_STYLESHEET],
    outfile: path.join(outputRoot, "renderer", SIDE_STYLESHEETS.get(TERMINAL_STYLESHEET)),
    bundle: true,
    target: "chrome140",
    minify: true,
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
    sourcemap: "external",
    logLevel: "info",
  }),
]);

// The hidden voice window's policy allows no network, the call window's may
// reach no host, and neither records; the recording carries no words in any
// case (`src/renderer/session-replay.ts`).
await Promise.all(
  Object.values(WINDOW_ENTRIES).map(({ document }) =>
    fs.copyFile(
      path.join(appRoot, "src/renderer", document),
      path.join(outputRoot, "renderer", document),
    ),
  ),
);

await Promise.all(
  Object.entries(WINDOW_ENTRIES).map(([name, { document }]) =>
    assertModuleEntry(document, `${name}.js`),
  ),
);

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

// A window's entry is what a browser context parses as the window opens, the
// panel's, the hidden voice window's, and the call window's, so its compressed size is a
// cost the user pays rather than one the build absorbs. The baseline is recorded rather than
// derived, because the number worth holding is the one a reviewer agreed to: a
// dependency that adds a fifth to the panel is a decision, and
// `LUKE_UPDATE_BUNDLE_BUDGET=1` is how that decision is written down once it has
// been made.
//
// Note that a bundle is measured with the chunks it imports, because those load
// with it before anything runs; a chunk reached only by a dynamic `import()` is
// fetched when that code first runs, and is left out. A bundle that only ever
// loads after another (`LOADED_AFTER`) is measured beyond what that one has
// loaded already. Each file is gzipped on its own, as each is read on its own.
// Every renderer entry is measured, so a new one with no baseline fails until
// one is recorded.
//
// Note that a build that uploads its source maps is not measured, because the
// upload plugin adds a debug-ID snippet of a few hundred bytes to every file,
// past a small bundle's slack. The release job runs `check.sh`, which builds
// the same source without the token and measures it, before it runs this one.
const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
const { metafile } = await rendererBuild;
const rendererEntries = [
  ...Object.keys(WINDOW_ENTRIES),
  ...Object.keys(SIDE_BUNDLE_ENTRIES),
  ...Object.keys(WORLD_BUNDLE_ENTRIES),
].map((name) => `renderer/${name}.js`);
const measured = Object.fromEntries(
  await Promise.all(
    [...new Set([...Object.keys(budget.gzipBytes), ...rendererEntries])].map(async (bundle) => {
      const before = new Set(
        (LOADED_AFTER[bundle] ?? []).flatMap((earlier) => loadedUpFront(metafile, earlier)),
      );
      const sizes = await Promise.all(
        loadedUpFront(metafile, bundle)
          .filter((file) => !before.has(file))
          .map(
            async (file) =>
              gzipSync(await fs.readFile(path.join(outputRoot, file)), { level: 9 }).length,
          ),
      );
      return [bundle, sizes.reduce((sum, bytes) => sum + bytes, 0)];
    }),
  ),
);

if (uploadsSourceMaps) {
  process.stdout.write("bundle budget not measured: this build carries Sentry's debug IDs\n");
} else if (process.env.LUKE_UPDATE_BUNDLE_BUDGET === "1") {
  await fs.writeFile(
    budgetFile,
    `${JSON.stringify({ ...budget, gzipBytes: measured }, undefined, 2)}\n`,
  );
  for (const [bundle, bytes] of Object.entries(measured)) {
    process.stdout.write(`bundle budget recorded: ${bundle} ${bytes} gzipped bytes\n`);
  }
} else {
  const unrecorded = Object.keys(measured).filter((bundle) => !(bundle in budget.gzipBytes));
  for (const bundle of unrecorded) {
    console.error(`error: ${bundle} has no baseline in bundle-budget.json`);
  }
  const exceeded = Object.entries(measured).flatMap(([bundle, bytes]) => {
    if (!(bundle in budget.gzipBytes)) return [];
    const ceiling = Math.floor(budget.gzipBytes[bundle] * (1 + budget.slack));
    return bytes > ceiling ? [{ bundle, bytes, ceiling }] : [];
  });
  if (exceeded.length > 0 || unrecorded.length > 0) {
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
