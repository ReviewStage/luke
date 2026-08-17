import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = path.resolve(appRoot, "../../design/brand");
// The menu bar item and the Dock icon are the two pieces of artwork the app
// cannot inline: macOS takes a NativeImage read from a file, not markup. Both
// menu bar scales travel, because `nativeImage` finds the `@2x` file by looking
// beside the one it was given. The Dock takes one large PNG per mode — macOS
// recolors the template item itself, but the Dock tile has to be swapped by
// hand as the theme changes, which is why there are two.
const MENU_BAR_IMAGES = ["lukeTemplate.png", "lukeTemplate@2x.png"];
const DOCK_ICON_IMAGES = {
  "luke-icon-light.png": "luke-icon-light-512.png",
  "luke-icon-dark.png": "luke-icon-dark-512.png",
};

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "menubar"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "icon"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(appRoot, "src/main.ts")],
    outfile: path.join(outputRoot, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    define: {
      // The Google Calendar client secret rides into the bundle from the
      // packaging environment rather than sitting in source, where secret
      // scanners cannot tell a desktop client's published "secret" from a
      // real one; see google-calendar-oauth.ts.
      PACKAGED_GOOGLE_CALENDAR_CLIENT_SECRET: JSON.stringify(
        process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET ?? "",
      ),
    },
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [path.join(appRoot, "src/preload.ts")],
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
    },
    sourcemap: true,
    logLevel: "info",
  }),
]);

await fs.copyFile(
  path.join(appRoot, "src/renderer/index.html"),
  path.join(outputRoot, "renderer/index.html"),
);

await Promise.all([
  ...MENU_BAR_IMAGES.map((name) =>
    fs.copyFile(path.join(brandRoot, "menubar", name), path.join(outputRoot, "menubar", name)),
  ),
  ...Object.entries(DOCK_ICON_IMAGES).map(([name, source]) =>
    fs.copyFile(path.join(brandRoot, "icon", source), path.join(outputRoot, "icon", name)),
  ),
]);
