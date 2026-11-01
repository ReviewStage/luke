/**
 * clock.ts -- the shot profiles' one clock: every canned timestamp is counted back from the moment this module loaded.
 *
 * Throwaway: the changelog screenshots' staging, never committed. Imports
 * nothing, so it can be read by any shot module at load without a cycle.
 */

/** The launch, as the shots count from it. */
export const LAUNCHED_AT = Date.now();

const MINUTE_MS = 60_000;

/** Epoch milliseconds `minutes` before launch. */
export function ago(minutes: number): number {
  return LAUNCHED_AT - Math.round(minutes * MINUTE_MS);
}

/** Epoch milliseconds `hours` before launch. */
export function hoursAgo(hours: number): number {
  return ago(hours * 60);
}

/** Epoch milliseconds `days` before launch. */
export function daysAgo(days: number): number {
  return ago(days * 24 * 60);
}

/** Epoch milliseconds `seconds` before launch. */
export function secondsAgo(seconds: number): number {
  return LAUNCHED_AT - Math.round(seconds * 1000);
}
