import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputRoot = path.join(appRoot, "dist");

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(path.join(outputRoot, "renderer"), { recursive: true });

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

await Promise.all([
  fs.copyFile(
    path.join(appRoot, "src/renderer/index.html"),
    path.join(outputRoot, "renderer/index.html"),
  ),
  fs.copyFile(
    path.join(appRoot, "src/renderer/styles.css"),
    path.join(outputRoot, "renderer/styles.css"),
  ),
]);
