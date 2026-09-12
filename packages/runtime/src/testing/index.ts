/**
 * The scaffolding every test in this repository shares: a temporary directory
 * that cleans itself up. `temporaryDirectory` itself lives in
 * `@sidecar/wire/testing`, which every package here already reaches, and is
 * re-exported so this door still hands it out. `temporaryDirectoryScoped` is
 * the same guarantee as an `Effect` a scope closes, rather than a
 * `TestContext` callback.
 *
 * A test written on `it.effect` reaches for `TestClock` directly for its
 * clock (see `../effect/timers.test.ts` for the pattern) rather than a fake
 * clock of its own, and settles a wait through the predicate it is actually
 * waiting on rather than a fixed microtask drain.
 */

export { temporaryDirectory } from "@sidecar/wire/testing";
export { temporaryDirectoryScoped } from "./temporary-directory.effect.js";
