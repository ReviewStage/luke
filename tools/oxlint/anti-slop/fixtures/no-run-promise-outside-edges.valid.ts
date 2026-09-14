import { Effect } from "effect";
import { runWeb } from "../../../../apps/web/server/runtime.js";

/** The work is described here and run by whichever edge composed it. */
export function greeting(name: string): Effect.Effect<string> {
  return Effect.sync(() => `hello ${name}`);
}

/** Handing the web edge's runner on is not running one: only a call would run one. */
export function webRunner(): typeof runWeb {
  return runWeb;
}
