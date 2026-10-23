/**
 * sandbox-sweep-list.ts -- how the scheduled sandbox sweeps read the project's running sandboxes: which end of the list, how many pages, and which of them to read this minute; and how each stops one within its bound.
 *
 * The native and the eve sweeps list the same Vercel project and bound a
 * minute the same way: a few pages of the running sandboxes, and a set
 * number of them read against the store. What Vercel's list documents, and
 * what this relies on (https://vercel.com/docs/rest-api/sandboxes/list-sandboxes):
 * a list sorted by creation takes `sortOrder` of `asc` or `desc`, a page
 * answers an opaque `pagination.next` to pass back as `cursor`, and
 * overdue running sessions are recovered before a page is returned, so an
 * entry may no longer be running by the time it is read.
 */

import { Effect, Result } from "effect";
import { OPEN_INTERNET_POLICY } from "../agents/terminal/agent-sandbox.js";
import {
  LIST_ORDER,
  type ListedSandbox,
  type ListOrder,
  type VercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";

/** How a stop within a sweep's bound ended: stopped, refused by Vercel, or left for the next sweep past the bound. */
const BUDGETED_STOP = {
  STOPPED: "stopped",
  FAILED: "failed",
  DEFERRED: "deferred",
} as const;

type BudgetedStop = (typeof BUDGETED_STOP)[keyof typeof BUDGETED_STOP];

/** A count of stops taken, shared by the sandboxes one sweep reads at once. */
export interface StopBudget {
  remaining: number;
}

/** How long an end of the list is listed from before the other end is: a sweep runs each minute, and the order alternates. */
const ORDER_PERIOD_MS = 60_000;

/**
 * The order a sweep lists in: oldest first on an even minute and newest
 * first on an odd one, so the running sandboxes past one end's pages are
 * reached from the other's.
 */
export function listOrderAt(now: Date): ListOrder {
  return Math.floor(now.getTime() / ORDER_PERIOD_MS) % 2 === 0
    ? LIST_ORDER.OLDEST_FIRST
    : LIST_ORDER.NEWEST_FIRST;
}

/**
 * The sandboxes `pick` keeps from at most `maxPages` pages of the running
 * ones, in the order listed. All the pages are read, whatever they hold, so
 * `windowAt` has the whole list to take its window from. A first page
 * Vercel did not answer fails the list; a later one ends it at the pages
 * already read, whose sandboxes are no less the sweep's to read.
 */
export const listRunningSandboxes = <Kept>(
  api: VercelSandboxApi,
  order: ListOrder,
  maxPages: number,
  pick: (sandbox: ListedSandbox) => Kept | undefined,
) =>
  Effect.gen(function* () {
    const found: Kept[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const asked = yield* Effect.result(api.listRunning(cursor, order));
      if (Result.isFailure(asked)) {
        if (page === 0) return yield* asked.failure;
        yield* Effect.logWarning(
          `a later page of the running sandboxes was not listed: ${asked.failure.message}`,
        );
        break;
      }
      const listed = asked.success;
      for (const sandbox of listed.sandboxes) {
        const kept = pick(sandbox);
        if (kept !== undefined) found.push(kept);
      }
      cursor = listed.next;
      if (cursor === undefined) break;
    }
    return found;
  });

/**
 * The `width` of the listed ones a sweep reads against the store: a window
 * that moves on by its own width each time a sweep lists from the same end,
 * wrapping round. Note that it moves, because the sandboxes that keep
 * running, every agent at work and every one a lease holds, would
 * otherwise fill a window fixed at either end for as long as they ran, and
 * one listed past it would never be read. Every sandbox on the pages either
 * end lists is so read within a few minutes, with no cursor kept between
 * sweeps.
 */
export function windowAt<Listed>(found: readonly Listed[], width: number, now: Date): Listed[] {
  if (found.length <= width) return [...found];
  // The list's end alternates by the minute (`listOrderAt`), so each end's sweeps come every other minute.
  const sweepsFromThisEnd = Math.floor(now.getTime() / (2 * ORDER_PERIOD_MS));
  const start = (sweepsFromThisEnd * width) % found.length;
  return [...found.slice(start), ...found.slice(0, start)].slice(0, width);
}

/**
 * One running sandbox stopped, where the sweep's bound of stops still has
 * room; past it the sandbox is deferred to the next sweep. A stop Vercel
 * refuses is logged under the words naming the sandbox, and answered failed.
 */
export const stopWithinBudget = (
  api: VercelSandboxApi,
  running: string,
  budget: StopBudget,
  named: string,
): Effect.Effect<BudgetedStop> =>
  Effect.gen(function* () {
    if (budget.remaining <= 0) return BUDGETED_STOP.DEFERRED;
    budget.remaining -= 1;
    // The credential comes off first, and a sandbox it would not come off is left up for the next sweep rather than stopped with it.
    const stopped = yield* Effect.result(
      Effect.andThen(
        api.updateNetworkPolicy(running, OPEN_INTERNET_POLICY),
        api.stopSession(running),
      ),
    );
    if (Result.isFailure(stopped)) {
      yield* Effect.logWarning(`${named} was not stopped: ${stopped.failure.message}`);
      return BUDGETED_STOP.FAILED;
    }
    return BUDGETED_STOP.STOPPED;
  });
