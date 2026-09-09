/**
 * The scaffolding every test in this repository shares: a temporary directory
 * that cleans itself up, a stated microtask drain, and a clock the test
 * drives. They live behind their own door because they reach `node:fs` and
 * `node:os`, which nothing that ships may have to resolve, and in this package
 * because the clock stands in for the runtime's own `ScheduledTimer` and every
 * test that needs one is above the runtime already.
 */
export { drainMicrotasks } from "./drain.js";
export { FakeClock } from "./fake-clock.js";
export { temporaryDirectory } from "./temporary-directory.js";
