import { Effect } from "effect";

/** The work is described here and run by whichever edge composed it. */
export function greeting(name: string): Effect.Effect<string> {
  return Effect.sync(() => `hello ${name}`);
}
