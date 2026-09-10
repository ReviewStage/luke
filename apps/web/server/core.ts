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
 *
 * A door here reaches its package for the compiler, not the resolver: it
 * satisfies Vercel's relative import graph, never a bare specifier `apps/web`
 * code imports, so `apps/web`'s `package.json` need not declare a dependency
 * on a package reached only through this file.
 */
import "../../../packages/credentials/src/credential-providers.js";
import "../../../packages/guide/src/index.js";
import "../../../packages/live/src/index.js";
import "../../../packages/memory/src/index.js";
import "../../../packages/runtime/src/index.js";

export * from "../../../packages/actions/src/index.js";
// The action table and the session package both name the action vocabulary: the
// table's is the whole of it and the session package's is the advertised
// subset of the same strings, proven identical where the table declares it. A
// star export from two doors carries neither, so the whole one is named here.
/** @public No file imports the type by name, but without this door the two star exports collide on it. */
export { ACTION_KIND, type ActionKind } from "../../../packages/actions/src/index.js";
export * from "../../../packages/analytics/src/index.js";
export * from "../../../packages/brain/src/index.js";
export * from "../../../packages/brain/src/store/shapes.js";
export * from "../../../packages/hosted/src/index.js";
export * from "../../../packages/realtime/src/index.js";
export * from "../../../packages/runtime/src/vocabulary.js";
export * from "../../../packages/session/src/index.js";
export * from "../../../packages/session/src/ui-messages/index.js";
export * from "../../../packages/wire/src/index.js";
