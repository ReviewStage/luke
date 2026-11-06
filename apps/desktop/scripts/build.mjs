import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_ASSETS_DIRECTORY } from "@repo/brand/assets-directory";
import {
  HIGHLIGHT_WORKER_BUILD,
  LUCIDE_WHOLE,
  lucideWholeModule,
  panelDefines,
  panelStaticDirectories,
  REDIRECTED,
  redirectOf,
} from "@repo/panel/build-table";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build } from "esbuild";
import { replayProjectKeyDefine, signingModeDefine } from "./package-config.mjs";
import { tailwindPlugin } from "./tailwind.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = BRAND_ASSETS_DIRECTORY;
const appVersion = JSON.parse(
  await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
).version;
const sentryRelease = `Vespin@${appVersion}`;
const uploadsSourceMaps =
  Boolean(process.env.SENTRY_AUTH_TOKEN) && process.env.GITHUB_EVENT_NAME !== "workflow_dispatch";
const DOCK_ICON_IMAGES = {
  "icon-light.png": "icon-light-512.png",
  "icon-dark.png": "icon-dark-512.png",
};

const panelRedirects = {
  name: "panel-redirects",
  setup(build) {
    build.onResolve({ filter: REDIRECTED }, (args) => {
      const target = redirectOf(args.path, args.importer);
      return target === undefined ? undefined : { path: target };
    });
  },
};

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

const TERMINAL_STYLESHEET = path.join(appRoot, "../../packages/panel/src/terminal/index.css");
const SIDE_STYLESHEETS = new Map([[TERMINAL_STYLESHEET, "terminal.css"]]);
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

function git(...args) {
  return execFileSync("git", args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function nearestRef() {
  try {
    const ref = git("name-rev", "--name-only", "--no-undefined", "HEAD");
    return ref.replace(/^remotes\/[^/]+\//u, "").replace(/\^0$/u, "");
  } catch {
    return undefined;
  }
}

function worktreeFolder() {
  const gitDirectory = git("rev-parse", "--absolute-git-dir");
  const commonDirectory = path.resolve(appRoot, git("rev-parse", "--git-common-dir"));
  if (gitDirectory === commonDirectory) return undefined;
  return path.basename(git("rev-parse", "--show-toplevel"));
}

function buildCommit() {
  try {
    const commit = {
      sha: git("rev-parse", "--short", "HEAD"),
      dirty: git("status", "--porcelain") !== "",
    };
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    const named = branch === "HEAD" ? (nearestRef() ?? worktreeFolder()) : branch;
    if (named !== undefined) commit.branch = named;
    return commit;
  } catch {
    return null;
  }
}

async function assertModuleEntry(document, entry) {
  const html = await fs.readFile(path.join(outputRoot, "renderer", document), "utf8");
  if (!html.includes(`<script type="module" src="${entry}"></script>`)) {
    throw new Error(`${document} must load ${entry} with <script type="module">`);
  }
}

function sentryPlugins() {
  if (!uploadsSourceMaps) return [];
  return [
    sentryEsbuildPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "stage-review",
      project: "vespin-desktop",
      release: { name: sentryRelease },
      errorHandler: (error) => {
        console.warn(
          `warning: Sentry source-map upload failed, so the build goes on without it: ${error.message}`,
        );
      },
    }),
  ];
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "icon"), { recursive: true });

const WINDOW_ENTRIES = {
  panel: { source: "src/renderer/index.tsx", document: "index.html" },
};

const SIDE_BUNDLE_ENTRIES = {
  "description-editor": "../../packages/panel/src/description-editor/index.ts",
  "file-tree": "../../packages/panel/src/file-tree/index.ts",
  terminal: "../../packages/panel/src/terminal/index.ts",
  diagram: "../../packages/panel/src/diagram/index.ts",
  "diff-view": "../../packages/panel/src/diff-view/index.ts",
  "session-recorder": "src/renderer/session-recorder/index.ts",
};

const highlightWorker = await build(HIGHLIGHT_WORKER_BUILD);
const highlightWorkerText = highlightWorker.outputFiles[0]?.text ?? "";

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
  target: "chrome140",
  jsx: "automatic",
  minify: true,
  conditions: ["production"],
  plugins: [panelRedirects, lucideWholeOnDemand, sideStylesheetsLinked, ...sentryPlugins()],
  sourcemap: "external",
  logLevel: "info",
  define: {
    ...panelDefines(highlightWorkerText),
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
      ...signingModeDefine(process.env),
    },
    sourcemap: "external",
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(appRoot, "src/utility/task-code.ts")],
    outfile: path.join(outputRoot, "task-code.js"),
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
    entryPoints: [path.join(appRoot, "src/renderer/styles/index.css")],
    outfile: path.join(outputRoot, "renderer/styles.css"),
    bundle: true,
    target: "chrome140",
    plugins: [tailwindPlugin()],
    minify: true,
    sourcemap: "external",
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
]);

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
  panelStaticDirectories().map(({ from, to }) =>
    fs.cp(from, path.join(outputRoot, "renderer", to), { recursive: true }),
  ),
);

await Promise.all(
  Object.entries(DOCK_ICON_IMAGES).map(([name, source]) =>
    fs.copyFile(path.join(brandRoot, "icon", source), path.join(outputRoot, "icon", name)),
  ),
);
