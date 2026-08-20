/**
 * The doors through which server-side code reaches the workspace packages.
 *
 * The relative paths are deliberate. Vercel's builder compiles every
 * TypeScript file a function's relative import graph reaches — including
 * these, across the workspace boundary — but it leaves `package.json`
 * untouched, so a package's own `exports` still names `./src/index.ts` after
 * compilation has replaced that file with `index.js`. A bare `@sidecar/*`
 * specifier therefore resolves to a file that no longer exists and the
 * function dies on load, while a relative import is extension-rewritten with
 * the rest of the graph and works. Client code keeps the bare specifier: Vite
 * bundles it at build time and never resolves it at run time.
 *
 * One door per package the server actually reaches. A package added to the
 * server's import graph needs its door here, and nothing local reports its
 * absence — the failure is a FUNCTION_INVOCATION_FAILED on a deployed route.
 */
export * from "../../../packages/analytics/src/index.js";
export * from "../../../packages/attention/src/index.js";
export * from "../../../packages/hosted/src/index.js";
export * from "../../../packages/realtime/src/index.js";
export * from "../../../packages/session/src/index.js";
export * from "../../../packages/wire/src/index.js";
