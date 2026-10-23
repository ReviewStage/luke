// node-bundles.mjs -- how main's and the preload's bundles are built: the esbuild options `build.mjs` builds them with, which a test builds them with too.
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MAIN_ENTRY = path.join(appRoot, "src/main/index.ts");
export const PRELOAD_ENTRY = path.join(appRoot, "src/preload/index.ts");

// Both are evaluated whole as the app launches, main before the app is ready
// and the preload before every window's page, so both are minified. Names are
// kept, since a minified one would change what a stack, an error's `name`, or
// a class's `constructor.name` reads at run time; Sentry reads the rest back
// through the source map written beside each file, which the upload files
// under the release (`sentryPlugins` in `build.mjs`).
export const NODE_BUNDLE = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  minify: true,
  keepNames: true,
  sourcemap: "external",
  logLevel: "info",
};
