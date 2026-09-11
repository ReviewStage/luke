/**
 * The scaffolding every test in this repository shares: a temporary directory
 * that cleans itself up, a stated microtask drain, and a clock the test
 * drives. `drainMicrotasks` and `FakeClock` live behind their own door
 * because they reach `node:fs` and `node:os`, which nothing that ships may
 * have to resolve, and in this package because the clock stands in for the
 * runtime's own `ScheduledTimer` and every test that needs one is above the
 * runtime already. `temporaryDirectory` itself lives in `@sidecar/wire/testing`,
 * which every package here already reaches, and is re-exported so this door
 * still hands it out.
 *
 * A test written on `it.effect` needs none of the three: `TestClock` is the
 * clock (see `../effect/timers.test.ts` for the pattern — `TestClock.adjust`
 * advances the same clock `timersFromRuntime` reads, so no fake stands beside
 * it), and `temporaryDirectoryScoped` is the directory, an `Effect` a scope
 * closes rather than a `TestContext` callback.
 */

export { temporaryDirectory } from "@sidecar/wire/testing";
export { drainMicrotasks } from "./drain.js";
export { FakeClock } from "./fake-clock.js";
export { temporaryDirectoryScoped } from "./temporary-directory.effect.js";
