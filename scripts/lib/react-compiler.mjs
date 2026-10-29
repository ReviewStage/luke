// react-compiler.mjs -- the React Compiler trial: the modules it compiles, its options, and the one transform every bundler and test config wraps.
//
// The web's Vite build (`apps/web/vite.config.ts`), the desktop renderer's
// esbuild (`apps/desktop/scripts/build.mjs`), and the panel's and ui's vitest
// configs each wrap `compileReact` in a plugin of their own shape, so the
// compiler is scoped and configured here once. It reads TypeScript and JSX and
// writes them back with its memoization added, leaving the types and the JSX
// to the bundler's own transform after it. `LUKE_REACT_COMPILER=0` turns it
// off everywhere, which is how the trial draws before against after.

import { transformAsync } from "@babel/core";
import reactCompilerModule from "babel-plugin-react-compiler";

// The plugin is CommonJS whose `default` export is the plugin itself, which
// Node hands an ES import as a property of the module's exports.
const reactCompiler = reactCompilerModule.default;

/**
 * The modules the compiler reads: the panel's and `@luke/ui`'s own source,
 * hooks in `.ts` files among them, and never a test or the tests' shared
 * scaffolding (`src/testing/`), which no bundle carries. Written with no
 * lookaround, so esbuild's filter takes it as it is.
 */
export const REACT_COMPILER_SCOPE = /[\\/]packages[\\/](?:panel|ui)[\\/]src[\\/].*\.tsx?$/;
const TEST = /\.test\.tsx?$|[\\/]src[\\/]testing[\\/]/;

/**
 * The modules left as written although the compiler reads them without a
 * complaint, because each relies on a redraw the compiler's memoization takes
 * away, which nothing the compiler checks can see: each is a fix owed before
 * the compiler could be adopted, and the trial's pull request names them.
 */
export const REACT_COMPILER_LEFT_AS_WRITTEN = [
  // Each reads a cache kept in module state during render (a picture, a
  // diagram's drawing, a workspace's photo, a link's standing, a server's
  // tools) and redraws on a count it never reads once the cache moves, so a
  // read the compiler memoizes on its key never sees what landed.
  "/packages/ui/src/picture-cache.ts",
  "/packages/panel/src/tasks/agent-pictures.tsx",
  "/packages/panel/src/tasks/plan-pictures.tsx",
  "/packages/panel/src/tasks/pull-request-pictures.tsx",
  "/packages/panel/src/diagram-drawing.ts",
  "/packages/panel/src/desktop/workspace-tile.tsx",
  "/packages/panel/src/tasks/use-link-standing.ts",
  "/packages/panel/src/integration-tools.ts",
  "/packages/panel/src/tasks/edit-composer.tsx",
  "/packages/panel/src/desktop/tab-switcher.tsx",
  // Each snapshots a counter kept in module state (`const asked = writesAsked`)
  // for a callback to compare once a write lands, and the compiler (1.0.0)
  // reads the counter itself in the snapshot's place, so the compare always
  // sees the newest: a miscompilation rather than a rule broken.
  "/packages/panel/src/tasks/file-view-settings.ts",
  "/packages/panel/src/copy-feedback.tsx",
  // `ListMotion` hands its player unchanged props on every commit so that its
  // `getSnapshotBeforeUpdate` runs; a memoized element skips the player.
  "/packages/ui/src/components/list-motion/list-motion.tsx",
];

/** Whether this process compiles at all, read once from its environment. */
const REACT_COMPILER_ON = process.env.LUKE_REACT_COMPILER !== "0";

/** Whether a module, by its path, is compiled. */
export function inReactCompilerScope(file) {
  return (
    REACT_COMPILER_ON &&
    REACT_COMPILER_SCOPE.test(file) &&
    !TEST.test(file) &&
    !file.includes("node_modules") &&
    !REACT_COMPILER_LEFT_AS_WRITTEN.some((left) => file.endsWith(left))
  );
}

/**
 * A module's source with the compiler's memoization added, and its source
 * map, inline where the bundler reads one only from a comment. Note that a
 * component or hook the compiler cannot prove keeps the Rules of React is
 * left as written (`panicThreshold: "none"`) and reported to `logger`, so a
 * bail-out never fails a build.
 */
export async function compileReact(code, file, { logger, inlineMap = false } = {}) {
  const result = await transformAsync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"] },
    plugins: [[reactCompiler, { target: "19", panicThreshold: "none", logger: logger ?? null }]],
    sourceMaps: inlineMap ? "inline" : true,
  });
  return { code: result?.code ?? code, map: result?.map ?? null };
}

/**
 * The transform as a Vite plugin, for the web's build and the panel's and
 * ui's tests: it runs before Vite's own TypeScript and JSX transform, which
 * reads what the compiler wrote.
 */
export function reactCompilerVite() {
  return {
    name: "react-compiler",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0];
      return inReactCompilerScope(file) ? compileReact(code, file) : undefined;
    },
  };
}
