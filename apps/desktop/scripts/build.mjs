import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build } from "esbuild";
import { signingModeDefine } from "./package-config.mjs";
import { tailwindPlugin } from "./tailwind.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = path.resolve(appRoot, "../../design/brand");
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

// Excalidraw's fonts, copied beside the whiteboard bundle so the panel loads
// nothing from the network. Xiaolai is left out: it is 13 MB of CJK glyphs,
// and the system's own font draws those characters instead.
const EXCALIDRAW_FONTS = path.join(
  path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw"))),
  "fonts",
);
const EXCALIDRAW_FONTS_LEFT_OUT = new Set(["Xiaolai"]);

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

await Promise.all([
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
      // Whether this bundle rides in a Developer ID release, which is what
      // decides the name — and so the state directory and Keychain entry —
      // the run answers to; see app-identity.ts.
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
  build({
    entryPoints: [path.join(appRoot, "src/renderer/index.tsx")],
    outfile: path.join(outputRoot, "renderer/renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    jsx: "automatic",
    minify: true,
    plugins: sentryPlugins(),
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
]);

await Promise.all(
  (await fs.readdir(EXCALIDRAW_FONTS))
    .filter((family) => !EXCALIDRAW_FONTS_LEFT_OUT.has(family))
    .map((family) =>
      fs.cp(path.join(EXCALIDRAW_FONTS, family), path.join(outputRoot, "renderer/fonts", family), {
        recursive: true,
      }),
    ),
);

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
const budget = JSON.parse(await fs.readFile(budgetFile, "utf8"));
const measured = Object.fromEntries(
  await Promise.all(
    Object.keys(budget.gzipBytes).map(async (bundle) => [
      bundle,
      gzipSync(await fs.readFile(path.join(outputRoot, bundle)), { level: 9 }).length,
    ]),
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
