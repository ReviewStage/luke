/**
 * eve-sandbox-sweep.ts -- the scheduled sweep's stop of an eve coding agent's sandbox left running with no turn, Terminal, or watched browser to hold it.
 *
 * eve opens a coding agent's sandbox and the store hook stops it as each
 * turn ends (`apps/dev/hooks/store.ts`), unless a developer's Terminal or
 * a watched Browser tab holds it, when the lease sweep stops it once the
 * lease lapses (`terminal-lease-sweep.ts`). A sandbox whose turn-end stop
 * never ran, because the function died first, a step before it threw, or
 * eve never told the hook the turn ended, has nothing else to stop it, and
 * bills its memory until Vercel's own timeout. This sweep is that stop: it
 * pages through the project's running sandboxes, from the oldest and the
 * newest on alternate minutes, keeps the ones named as eve names a
 * session's sandbox, and maps each by its session tag to the one coding
 * agent whose eve conversation runs in that session. It stops a sandbox
 * whose agent's newest turn ended longer ago than a grace, which leaves the
 * hook's own stop to go first, and which no lease holds.
 *
 * Every doubt keeps the sandbox running. A sandbox no agent, or more than
 * one, can be named for is left and counted, never stopped, and so is one
 * whose agent has a turn queued or running: a turn whose end is never
 * coming is settled by the abandoned-turn sweep, which runs ahead of this
 * one, and only then is its sandbox stopped. The run's standing is read
 * again after the sandbox is read afresh, and the lease last, so a message
 * or a Terminal that came since keeps the sandbox; what lands between that
 * read and the stop is the same narrow window the hook's own stop has. The
 * stop is as a native sandbox's: the repository's credential taken off the
 * firewall, then the session stopped, its filesystem kept for a later
 * resume; where the credential would not come off, the sandbox is left for
 * the next sweep.
 *
 * Every call is bounded so the sweep's minute holds: a few pages of the
 * list, a set number of sandboxes read against the store, taken from a
 * window that moves along the list from one sweep to the next, and a set
 * number of stops. What is asked of Vercel is a page, a tag, and a session; what is
 * logged of a failure is its status.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readEveRunStanding } from "@luke/database/models/coding-agent-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { Duration, Effect, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { OPEN_INTERNET_POLICY } from "../agents/terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type ListOrder,
  RUNNING_STATUS,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";
import { listOrderAt } from "./native-sandbox-sweep.js";

/**
 * The name eve gives a session's own Vercel sandbox (eve 0.74.0's
 * `vercelSessionName`); its templates are `eve-sbx-tpl-vercel-`, which this
 * leaves out, and a native agent's are Luke's own `luke-agent-`.
 */
export const EVE_SESSION_SANDBOX_NAME = "eve-sbx-vercel-";

export const EVE_SANDBOX_SWEEP = {
  /**
   * How long after its agent's newest turn ended a sandbox waits for the
   * store hook's own stop before the sweep stops it. Note that it is longer
   * than the native sweep's two minutes, because the hook writes the
   * branch, relays the end, reads the lease, and takes the credential off
   * before it stops, each a round trip; an orphan idles at most this long
   * past its turn.
   */
  GRACE: Duration.minutes(5),
  /** The most pages of running sandboxes one sweep reads, each the API's widest. */
  MAX_PAGES: 4,
  /** The most eve sandboxes one sweep reads against the store; the rest wait for a later sweep's window. */
  MAX_SANDBOXES: 40,
  /** The most sandboxes one sweep stops. */
  MAX_STOPS: 10,
  CONCURRENCY: 5,
} as const;

/**
 * What one sweep of the running eve sandboxes came to: sandboxes stopped,
 * ones a lease holds, ones whose stop Vercel did not confirm, ones left for
 * the next minute past the bound, and ones no single coding agent could be
 * named for, which are left running.
 */
export interface EveSandboxSweepOutcome {
  stopped: number;
  held: number;
  failed: number;
  deferred: number;
  unmapped: number;
}

const NOTHING_SWEPT: EveSandboxSweepOutcome = {
  stopped: 0,
  held: 0,
  failed: 0,
  deferred: 0,
  unmapped: 0,
};

const SANDBOX_ENDING = {
  STOPPED: "stopped",
  HELD: "held",
  FAILED: "failed",
  /** Its agent's turn goes on, or ended within the grace, or the sandbox moved on since the list. */
  LEFT: "left",
  /** Stoppable, but past the sweep's bound of stops. */
  DEFERRED: "deferred",
  /** No coding agent, or more than one, runs in its session. */
  UNMAPPED: "unmapped",
} as const;

type SandboxEnding = (typeof SANDBOX_ENDING)[keyof typeof SANDBOX_ENDING];

/** A running sandbox eve opened for a session: the session its tag names, and the sandbox session it runs. */
interface EveSandbox {
  readonly sessionId: string;
  readonly running: string;
}

/** A count of stops taken, shared by the sandboxes one sweep reads at once. */
interface StopBudget {
  remaining: number;
}

function eveSandboxOf(sandbox: ListedSandbox): EveSandbox | undefined {
  if (!sandbox.name.startsWith(EVE_SESSION_SANDBOX_NAME)) return undefined;
  // A page may name a sandbox that stopped since it was asked for, as Vercel recovers overdue sessions.
  if (sandbox.status !== RUNNING_STATUS || sandbox.currentSessionId === undefined) return undefined;
  const sessionId = sandbox.tags?.[SESSION_TAG];
  if (sessionId === undefined) return undefined;
  return { sessionId, running: sandbox.currentSessionId };
}

/**
 * The running eve sandboxes on at most `MAX_PAGES` pages, in the order
 * listed. A first page Vercel did not answer fails the list; a later one
 * ends it at the pages already read, whose sandboxes are no less the
 * sweep's to read.
 */
const runningEveSandboxes = (api: VercelSandboxApi, order: ListOrder) =>
  Effect.gen(function* () {
    const found: EveSandbox[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < EVE_SANDBOX_SWEEP.MAX_PAGES; page += 1) {
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
        const eve = eveSandboxOf(sandbox);
        if (eve !== undefined) found.push(eve);
      }
      cursor = listed.next;
      if (cursor === undefined) break;
    }
    return found;
  });

/**
 * The `MAX_SANDBOXES` of the listed ones this sweep reads against the store:
 * a window that moves on by its own width each time a sweep lists from the
 * same end, wrapping round. Note that it moves, because the sandboxes that
 * keep running, every agent at work and every one a lease holds, would
 * otherwise fill a window fixed at either end for as long as they ran, and
 * an orphan listed past it would never be read. Every eve sandbox on the
 * pages either end lists is so read within a few minutes, with no cursor
 * kept between sweeps.
 */
function windowAt(found: readonly EveSandbox[], now: Date): readonly EveSandbox[] {
  const width = EVE_SANDBOX_SWEEP.MAX_SANDBOXES;
  if (found.length <= width) return found;
  // The list's end alternates by the minute (`listOrderAt`), so each end's sweeps come every other minute.
  const sweepsFromThisEnd = Math.floor(now.getTime() / 120_000);
  const start = (sweepsFromThisEnd * width) % found.length;
  return [...found.slice(start), ...found.slice(0, start)].slice(0, width);
}

/** Whether the sandbox, read afresh, has moved on from the list: gone, down, or in another session. Vercel not answering counts as moved on. */
const movedOn = (api: VercelSandboxApi, sandbox: EveSandbox) =>
  Effect.map(
    api.listTagged(sandbox.sessionId),
    ([fresh]) =>
      fresh === undefined ||
      fresh.status !== RUNNING_STATUS ||
      fresh.currentSessionId !== sandbox.running,
  ).pipe(Effect.orElseSucceed(() => true));

/** Whether the agent's newest turn ended longer ago than the grace; a turn queued or running has not ended. */
const endedPastGrace = (standing: { readonly endedAt: Date | null }, now: Date) => {
  const endedBefore = now.getTime() - Duration.toMillis(EVE_SANDBOX_SWEEP.GRACE);
  return standing.endedAt !== null && standing.endedAt.getTime() <= endedBefore;
};

/**
 * One running eve sandbox dealt with: stopped where one coding agent runs
 * in its session, that agent's turn ended past the grace, the sandbox is
 * still in the session listed, and no lease holds it; left otherwise.
 */
const endSandbox = (
  api: VercelSandboxApi,
  sandbox: EveSandbox,
  now: Date,
  budget: StopBudget,
): Effect.Effect<SandboxEnding, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.gen(function* () {
    const standing = yield* readEveRunStanding(sandbox.sessionId);
    if (Option.isNone(standing)) return SANDBOX_ENDING.UNMAPPED;
    if (!endedPastGrace(standing.value, now)) return SANDBOX_ENDING.LEFT;
    if (yield* movedOn(api, sandbox)) return SANDBOX_ENDING.LEFT;
    const again = yield* readEveRunStanding(sandbox.sessionId);
    if (Option.isNone(again) || !endedPastGrace(again.value, now)) return SANDBOX_ENDING.LEFT;
    if (yield* sandboxHeld(again.value.conversationId, now)) return SANDBOX_ENDING.HELD;
    if (budget.remaining <= 0) return SANDBOX_ENDING.DEFERRED;
    budget.remaining -= 1;
    // The credential comes off first, and a sandbox it would not come off is left up for the next sweep rather than stopped with it.
    const stopped = yield* Effect.result(
      Effect.andThen(
        api.updateNetworkPolicy(sandbox.running, OPEN_INTERNET_POLICY),
        api.stopSession(sandbox.running),
      ),
    );
    if (Result.isFailure(stopped)) {
      yield* Effect.logWarning(
        `an orphaned eve sandbox was not stopped: ${stopped.failure.message}`,
      );
      return SANDBOX_ENDING.FAILED;
    }
    return SANDBOX_ENDING.STOPPED;
  });

/**
 * Stops the running eve sandboxes whose agent's turn ended and which no
 * lease holds, a sweep's worth, `CONCURRENCY` at a time. A list Vercel did
 * not answer sweeps nothing this minute rather than failing the sweeps
 * after it.
 */
export const sweepEveSandboxes = /* @__PURE__ */ Effect.fn("web/sweepEveSandboxes")(function* (
  now: Date,
): Effect.fn.Return<
  EveSandboxSweepOutcome,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient
> {
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const listed = yield* Effect.result(runningEveSandboxes(api, listOrderAt(now)));
  if (Result.isFailure(listed)) {
    yield* Effect.logWarning(`the running sandboxes were not listed: ${listed.failure.message}`);
    return NOTHING_SWEPT;
  }
  const budget: StopBudget = { remaining: EVE_SANDBOX_SWEEP.MAX_STOPS };
  const endings = yield* Effect.forEach(
    windowAt(listed.success, now),
    (sandbox) => endSandbox(api, sandbox, now, budget),
    { concurrency: EVE_SANDBOX_SWEEP.CONCURRENCY },
  );
  const count = (ending: SandboxEnding) => endings.filter((each) => each === ending).length;
  const unmapped = count(SANDBOX_ENDING.UNMAPPED);
  // A sandbox no agent can be named for is left running; the count says how many, so a leak of that kind shows.
  if (unmapped > 0)
    yield* Effect.logInfo(`${unmapped} running eve sandboxes named no coding agent`);
  return {
    stopped: count(SANDBOX_ENDING.STOPPED),
    held: count(SANDBOX_ENDING.HELD),
    failed: count(SANDBOX_ENDING.FAILED),
    deferred: count(SANDBOX_ENDING.DEFERRED),
    unmapped,
  };
});
