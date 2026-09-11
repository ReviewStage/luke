import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { build } from "esbuild";
import { signingModeDefine } from "./package-config.mjs";

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

/** How both renderer bundles are built. Only their entries and their defines differ. */
const RENDERER_BUNDLE = {
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome140",
  jsx: "automatic",
  minify: true,
  plugins: sentryPlugins(),
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: true,
  logLevel: "info",
};

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
      // The Google Calendar client secret rides into the bundle from the
      // packaging environment rather than sitting in source, where secret
      // scanners cannot tell a desktop client's published "secret" from a
      // real one; see google-calendar-oauth.ts.
      PACKAGED_GOOGLE_CALENDAR_CLIENT_SECRET: JSON.stringify(
        process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET ?? "",
      ),
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
    // The brain store's worker thread. It is a bundle of its own because
    // a worker starts from a file, and it is unpacked from the archive by the
    // packaging config for the same reason; see store-path.ts.
    entryPoints: [path.join(appRoot, "src/main/store-worker.ts")],
    outfile: path.join(outputRoot, "store-worker.js"),
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
    // inlines them into the single `styles.css` the renderer HTML links.
    entryPoints: [path.join(appRoot, "src/renderer/styles/index.css")],
    outfile: path.join(outputRoot, "renderer/styles.css"),
    bundle: true,
    target: "chrome140",
    minify: true,
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(appRoot, "src/renderer/index.tsx")],
    outfile: path.join(outputRoot, "renderer/renderer.js"),
    ...RENDERER_BUNDLE,
    define: {
      ...RENDERER_BUNDLE.define,
      // The analytics project the screen recorder files into, from the
      // packaging environment rather than source, on the calendar secret's
      // terms above. A build without one records nothing at all — the same
      // kill switch the site's own counting has, so a local run or an
      // unconfigured build cannot record into a stranger's project.
      PACKAGED_POSTHOG_PROJECT_API_KEY: JSON.stringify(process.env.POSTHOG_PROJECT_API_KEY ?? ""),
    },
  }),
  build({
    // The hidden voice window's own bundle. It is a second entry rather than
    // a role the panel's bundle branches on so that `App` and the
    // session-replay client are unreachable from it by construction: the
    // panel is the one surface that records, and a recording of a blank
    // hidden window would be a session nobody consented to. Nothing here
    // takes the recorder's project key, so a build could not configure one.
    entryPoints: [path.join(appRoot, "src/renderer/voice/index.tsx")],
    outfile: path.join(outputRoot, "renderer/voice.js"),
    ...RENDERER_BUNDLE,
  }),
]);

await Promise.all([
  fs.copyFile(
    path.join(appRoot, "src/renderer/index.html"),
    path.join(outputRoot, "renderer/index.html"),
  ),
  fs.copyFile(
    path.join(appRoot, "src/renderer/voice/index.html"),
    path.join(outputRoot, "renderer/voice.html"),
  ),
]);

await Promise.all(
  Object.entries(DOCK_ICON_IMAGES).map(([name, source]) =>
    fs.copyFile(path.join(brandRoot, "icon", source), path.join(outputRoot, "icon", name)),
  ),
);

// The panel's and the voice window's bundles are the two that a browser context
// parses at every window open, so their compressed size is a cost the user pays
// rather than one the build absorbs. The baseline is recorded rather than
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
