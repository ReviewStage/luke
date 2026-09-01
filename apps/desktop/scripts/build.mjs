import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { signingModeDefine } from "./package-config.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = path.resolve(appRoot, "../../design/brand");
// The Dock takes one large PNG per mode and swaps them as the theme changes.
const DOCK_ICON_IMAGES = {
  "luke-icon-light.png": "luke-icon-light-512.png",
  "luke-icon-dark.png": "luke-icon-dark-512.png",
};

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
    external: ["better-sqlite3", "electron"],
    define: {
      // The Google Calendar client secret rides into the bundle from the
      // packaging environment rather than sitting in source, where secret
      // scanners cannot tell a desktop client's published "secret" from a
      // real one; see google-calendar-oauth.ts.
      PACKAGED_GOOGLE_CALENDAR_CLIENT_SECRET: JSON.stringify(
        process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET ?? "",
      ),
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
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    jsx: "automatic",
    minify: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      // The analytics project the screen recorder files into, from the
      // packaging environment rather than source, on the calendar secret's
      // terms above. A build without one records nothing at all — the same
      // kill switch the site's own counting has, so a local run or an
      // unconfigured build cannot record into a stranger's project.
      PACKAGED_POSTHOG_PROJECT_API_KEY: JSON.stringify(process.env.POSTHOG_PROJECT_API_KEY ?? ""),
    },
    sourcemap: true,
    logLevel: "info",
  }),
]);

await fs.copyFile(
  path.join(appRoot, "src/renderer/index.html"),
  path.join(outputRoot, "renderer/index.html"),
);
await fs.cp(path.join(appRoot, "drizzle/session-index"), path.join(outputRoot, "session-index"), {
  recursive: true,
});

await Promise.all([
  ...Object.entries(DOCK_ICON_IMAGES).map(([name, source]) =>
    fs.copyFile(path.join(brandRoot, "icon", source), path.join(outputRoot, "icon", name)),
  ),
]);
