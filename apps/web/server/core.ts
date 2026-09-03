/**
 * The doors through which server-side code reaches the workspace packages.
 *
 * The relative paths are deliberate. Vercel's builder compiles every
 * TypeScript file a function's relative import graph reaches — including
 * these, across the workspace boundary — but it leaves `package.json`
 * untouched. A package's `exports` therefore has to name a target that is
 * still correct after compilation has turned `index.ts` into `index.js`,
 * which is why every package here exports `./src/index.js`: post-compile it
 * is literally the file, and pre-compile every toolchain in this repository
 * substitutes the `.ts` back. Client code keeps the bare specifier: Vite
 * bundles it at build time and never resolves it at run time.
 *
 * One door per package in the *transitive* closure, not just the ones the
 * server names. A package the server reaches only through another package's
 * imports still needs its file compiled, and nothing local reports its
 * absence — the failure is a FUNCTION_INVOCATION_FAILED on a deployed route.
 * The two forms differ by what the server does with the package: `export *`
 * for the ones whose names server code uses, a bare side-effect import for
 * the ones reached only through another package, so a package pulled in for
 * compilation alone cannot silently collide with a name a door above it
 * already exports.
 */
import "../../../packages/credentials/src/credential-providers.js";
import "../../../packages/guide/src/index.js";
import "../../../packages/issues/src/index.js";

export * from "../../../packages/acts/src/index.js";
export * from "../../../packages/analytics/src/index.js";
export * from "../../../packages/brain/src/index.js";
export * from "../../../packages/hosted/src/index.js";
// Both the acts table and the protocol name a function call; the protocol's
// carries the call id the wire hands back, and is the one server code reads.
export type { RealtimeFunctionCall } from "../../../packages/realtime/src/index.js";
export * from "../../../packages/realtime/src/index.js";
export * from "../../../packages/session/src/index.js";
export * from "../../../packages/wire/src/index.js";
