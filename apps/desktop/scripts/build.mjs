import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");
const brandRoot = path.resolve(appRoot, "../../design/brand");
// The menu bar item is the one piece of artwork the app cannot inline: macOS
// takes a NativeImage read from a file, not markup. Both scales travel, because
// `nativeImage` finds the `@2x` file by looking beside the one it was given.
const MENU_BAR_IMAGES = ["lukeTemplate.png", "lukeTemplate@2x.png"];

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });
await fs.mkdir(path.join(outputRoot, "menubar"), { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(appRoot, "src/main.ts")],
    outfile: path.join(outputRoot, "main.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
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

await Promise.all(
  MENU_BAR_IMAGES.map((name) =>
    fs.copyFile(path.join(brandRoot, "menubar", name), path.join(outputRoot, "menubar", name)),
  ),
);
