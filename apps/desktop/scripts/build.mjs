import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BRAND_ASSETS_DIRECTORY } from "@luke/brand/assets-directory";
import {
  EXCALIDRAW_UNUSED,
  EXCALIDRAW_UNUSED_MODULE,
  excalidrawLeftOut,
  HIGHLIGHT_WORKER_BUILD,
  LUCIDE_WHOLE,
  lucideWholeModule,
  panelDefines,
  panelStaticDirectories,
  REDIRECTED,
  redirectOf,
} from "@luke/panel/build-table";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build } from "esbuild";
import { bundleCeiling } from "./bundle-budget.mjs";
import { replayProjectKeyDefine, signingModeDefine } from "./package-config.mjs";
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

// The imports the panel's build table (`@luke/panel/build-table`) answers
// differently from how they are written: Streamdown's HTML parser and Pierre's
// diff writer, each redirected to a module of the panel's own, and the parts
// of Excalidraw the board never uses, each answered with an empty module.
// The table says why each is answered as it is; this is esbuild's shape of it.
const panelRedirects = {
  name: "panel-redirects",
  setup(build) {
    build.onResolve({ filter: REDIRECTED }, (args) => {
      const target = redirectOf(args.path, args.importer);
      return target === undefined ? undefined : { path: target };
    });
  },
};
const excalidrawTrim = {
  name: "excalidraw-trim",
  setup(build) {
    build.onResolve({ filter: EXCALIDRAW_UNUSED }, (args) =>
      excalidrawLeftOut(args.path, args.importer)
        ? { path: args.path, namespace: "excalidraw-unused" }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "excalidraw-unused" }, () => ({
      contents: EXCALIDRAW_UNUSED_MODULE,
      loader: "js",
    }));
  },
};

// A dynamic `import("lucide-react")` answered with the module of Lucide's
// `icons` alone (`@luke/panel/build-table`'s `LUCIDE_WHOLE`). The CommonJS file
// is read in a namespace of its own, so the resolver never takes it for the
// package and keeps answering the named imports with the ES build.
const LUCIDE_WHOLE_FILE = "lucide-whole-file";
const lucideWholeOnDemand = {
  name: "lucide-whole-on-demand",
  setup(build) {
    build.onResolve({ filter: /^lucide-react$/ }, (args) =>
      args.kind === "dynamic-import" ? { path: "icons", namespace: "lucide-whole" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "lucide-whole" }, () => ({
      contents: lucideWholeModule(LUCIDE_WHOLE_FILE),
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

// The stylesheets a bundle's entry imports for itself (`import "./index.css"`),
// each built on its own below to the file named here. esbuild writes a
// stylesheet a split chunk imports and never loads it, so the import is
// answered with a module that links the built file from beside the chunk
// that imports it, which is where the renderer's chunks all stand. A bundler
// that loads a chunk's stylesheets itself, as Vite does, needs none of this.
const WHITEBOARD_STYLESHEET = path.join(appRoot, "../../packages/panel/src/whiteboard/index.css");
const TERMINAL_STYLESHEET = path.join(appRoot, "../../packages/panel/src/terminal/index.css");
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
// dynamic `import()` of its own entry (`@luke/panel`'s `bundle-loader.ts`), so no
// window parses one before it is needed: the editors (TipTap), the whiteboard
// (Excalidraw), a File tab's tree (Pierre's tree), a Terminal tab's screen
// (xterm.js), a plan's diagrams (Mermaid), a Files changed diff (Pierre's
// diffs and Shiki), a call's avatar
// (Keyframe's SDK over LiveKit), and session replay's recorder (rrweb). Each is an entry rather than a chunk only so that
// it keeps a name of its own for the budget to read; what each reaches
// through dynamic imports of its own, a diagram type's layout or a language's
// grammar, is a chunk of its own, loaded when it is drawn.
const SIDE_BUNDLE_ENTRIES = {
  "plan-editor": "../../packages/panel/src/plan-editor/index.ts",
  whiteboard: "../../packages/panel/src/whiteboard/index.tsx",
  "file-tree": "../../packages/panel/src/file-tree/index.ts",
  terminal: "../../packages/panel/src/terminal/index.ts",
  diagram: "../../packages/panel/src/diagram/index.ts",
  "diff-view": "../../packages/panel/src/diff-view/index.ts",
  "avatar-session": "src/renderer/avatar-session/index.ts",
  "session-recorder": "src/renderer/session-recorder/index.ts",
};

// The worker Pierre's diffs highlights a Files changed list in, bundled as
// the panel's build table says (`HIGHLIGHT_WORKER_BUILD`) and handed to the
// diff bundle as text through `panelDefines`.
const highlightWorker = await build(HIGHLIGHT_WORKER_BUILD);
const highlightWorkerText = highlightWorker.outputFiles[0]?.text ?? "";

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
    ...Object.entries(SIDE_BUNDLE_ENTRIES).map(([name, source]) => [
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
    panelRedirects,
    lucideWholeOnDemand,
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
    ...panelDefines(highlightWorkerText),
    // The analytics project the screen recorder files into, from the
    // packaging environment rather than source, where secret scanners
    // cannot tell a published project key from a real secret, and only for a
    // Developer ID release build. A build without one records nothing at
    // all — the same kill switch the site's own counting has, so a local run
    // or an unconfigured build cannot record into production's project.
    ...replayProjectKeyDefine(process.env),
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

// The panel's static files, Excalidraw's fonts and the harness marks, copied
// beside the bundle, which is the desktop's asset base
// (`desktop-platform.ts`), so the panel loads nothing from the network and the
// bundle carries none of their bytes.
await Promise.all(
  panelStaticDirectories().map(({ from, to }) =>
    fs.cp(from, path.join(outputRoot, "renderer", to), { recursive: true }),
  ),
);

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
// fetched when that code first runs, and is left out. Each file is gzipped on
// its own, as each is read on its own.
// Every renderer entry is measured, so a new one with no baseline fails until
// one is recorded.
//
// Note that a build that uploads its source maps is not measured, because the
// upload plugin adds a debug-ID snippet of a few hundred bytes to every file,
// past a small bundle's slack. The release job runs `check.sh`, which builds
// the same source without the token and measures it, before it runs this one.
const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
const { metafile } = await rendererBuild;
const rendererEntries = [...Object.keys(WINDOW_ENTRIES), ...Object.keys(SIDE_BUNDLE_ENTRIES)].map(
  (name) => `renderer/${name}.js`,
);
const measured = Object.fromEntries(
  await Promise.all(
    [...new Set([...Object.keys(budget.gzipBytes), ...rendererEntries])].map(async (bundle) => {
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
  const withSentry = Boolean(process.env.SENTRY_AUTH_TOKEN);
  const exceeded = Object.entries(measured).flatMap(([bundle, bytes]) => {
    if (!(bundle in budget.gzipBytes)) return [];
    const ceiling = bundleCeiling(budget.gzipBytes[bundle], budget, withSentry);
    return bytes > ceiling ? [{ bundle, bytes, ceiling }] : [];
  });
  if (exceeded.length > 0 || unrecorded.length > 0) {
    for (const { bundle, bytes, ceiling } of exceeded) {
      console.error(
        `error: ${bundle} is ${bytes} gzipped bytes, over its ceiling of ${ceiling} (baseline ${budget.gzipBytes[bundle]} plus ${budget.slack * 100}%${withSentry ? `, or ${budget.sentrySlackBytes} bytes with Sentry` : ""})`,
      );
    }
    console.error(
      "Reduce the bundle, or record the new baseline with LUKE_UPDATE_BUNDLE_BUDGET=1 and say why in the pull request.",
    );
    process.exitCode = 1;
  }
}
