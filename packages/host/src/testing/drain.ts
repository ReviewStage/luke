import { setImmediate as immediate } from "node:timers/promises";

/**
 * Lets queued microtasks and immediates run. `ticks` is how many turns of
 * the immediate queue to allow, and a chain of N awaits needs N: a caller
 * states the length of the wait it is settling rather than guessing at a
 * round number.
 */
export async function drainMicrotasks(ticks = 30): Promise<void> {
  for (let turn = 0; turn < ticks; turn += 1) await immediate();
}
