/**
 * The one door through which server-side code reaches `@sidecar/core`.
 *
 * The relative path is deliberate. Vercel's builder compiles every TypeScript
 * file a function's relative import graph reaches — including these, across
 * the workspace boundary — but it leaves `package.json` untouched, so the
 * package's own `exports` still names `./src/index.ts` after compilation has
 * replaced that file with `index.js`. A bare `@sidecar/core` specifier
 * therefore resolves to a file that no longer exists and the function dies on
 * load, while a relative import is extension-rewritten with the rest of the
 * graph and works. Client code keeps the bare specifier: Vite bundles it at
 * build time and never resolves it at run time.
 */
export * from "../../../packages/sidecar-core/src/index.js";
