/**
 * The scaffolding every test in this repository shares: a temporary directory
 * that cleans itself up, a stated microtask drain, and a clock the test
 * drives. They live behind their own door because they reach `node:fs` and
 * `node:os`, which a renderer bundle drawing the panel's fixture snapshot
 * must never have to resolve.
 */
export { drainMicrotasks } from "./drain.js";
export { FakeClock } from "./fake-clock.js";
export { temporaryDirectory } from "./temporary-directory.js";
