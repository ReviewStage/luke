/**
 * native-sandbox-sweep.ts -- the scheduled sweep's stop of a native agent's sandbox whose run ended and which no Terminal holds.
 *
 * A native harness's sandbox (Claude Code's or Codex's, which Luke opens
 * itself, `coder-host/runner-sessions.ts`) is stopped when its runner
 * ends: the events route calls `runnerEnded` on the runner's END. A stop
 * that failed there is logged and not retried, so the sandbox would idle
 * until its timeout. This sweep retries it: it pages through the project's
 * running sandboxes, from the oldest and the newest on alternate minutes, keeps the ones named as Luke names a
 * native sandbox and carrying an agent's tag, and stops each whose
 * conversation is native, whose newest turn ended longer ago than a short
 * grace (which leaves the END's own stop to go first), and on which no
 * developer's Terminal holds a lease. eve's sandboxes are never looked at
 * past their name, and a run still going, or waiting on a wakeup (whose turn
 * stays running), keeps its sandbox, as does one a newer runner runs in. The
 * stop is as the END's: the repository's credential taken off the firewall,
 * then the session stopped, its filesystem kept for a later resume; where the
 * credential would not come off, the sandbox is left for the next sweep.
 *
 * Every call is bounded so the sweep's minute holds: a few pages of the
 * list, a set number of sandboxes read against the store, and a set number
 * of stops. What is asked of Vercel is a page, a name, and a session; what
 * is logged of a failure is its status.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readNativeRunStanding } from "@luke/database/models/coding-agent-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { Duration, Effect, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { RUNNER_TAG, SANDBOX_NAME, taggedRunner } from "../agents/coder-host/runner-sessions.js";
import { OPEN_INTERNET_POLICY } from "../agents/terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  LIST_ORDER,
  type ListedSandbox,
  type ListOrder,
  RUNNING_STATUS,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";

export const NATIVE_SANDBOX_SWEEP = {
  /** How long after its run's newest turn ended a sandbox waits for the END's own stop before the sweep stops it. */
  GRACE: Duration.minutes(2),
  /** The most pages of running sandboxes one sweep reads, each the API's widest. */
  MAX_PAGES: 4,
  /** The most native sandboxes one sweep reads against the store; the rest wait for the next minute. */
  MAX_SANDBOXES: 40,
  /** The most sandboxes one sweep stops. */
  MAX_STOPS: 10,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the running native sandboxes came to: sandboxes stopped, ones a Terminal holds, ones whose stop Vercel did not confirm, and ones left for the next minute past the bound. */
export interface NativeSandboxSweepOutcome {
  stopped: number;
  held: number;
  failed: number;
  deferred: number;
}

const NOTHING_SWEPT: NativeSandboxSweepOutcome = { stopped: 0, held: 0, failed: 0, deferred: 0 };

const SANDBOX_ENDING = {
  STOPPED: "stopped",
  HELD: "held",
  FAILED: "failed",
  /** Its run goes on, or ended within the grace, or it is no native agent's the store knows. */
  LEFT: "left",
  /** Stoppable, but past the sweep's bound of stops. */
  DEFERRED: "deferred",
} as const;

type SandboxEnding = (typeof SANDBOX_ENDING)[keyof typeof SANDBOX_ENDING];

/** A running sandbox Luke opened for a native agent: the session Luke minted for it, the sandbox session it runs, and the agent its tag names. */
interface NativeSandbox {
  readonly sessionId: string;
  readonly running: string;
  readonly agentId: string;
}

function nativeSandboxOf(sandbox: ListedSandbox): NativeSandbox | undefined {
  if (!sandbox.name.startsWith(SANDBOX_NAME)) return undefined;
  // A page may name a sandbox that stopped since it was asked for, as Vercel recovers overdue sessions.
  if (sandbox.status !== RUNNING_STATUS || sandbox.currentSessionId === undefined) return undefined;
  const agentId = sandbox.tags?.[RUNNER_TAG.AGENT];
  const sessionId = sandbox.tags?.[SESSION_TAG];
  if (agentId === undefined || sessionId === undefined) return undefined;
  return { sessionId, running: sandbox.currentSessionId, agentId };
}

/**
 * The order a sweep lists in: oldest first on an even minute and newest
 * first on an odd one, so the running sandboxes past one end's bound are
 * reached from the other's within two minutes.
 */
export function listOrderAt(now: Date): ListOrder {
  return Math.floor(now.getTime() / 60_000) % 2 === 0
    ? LIST_ORDER.OLDEST_FIRST
    : LIST_ORDER.NEWEST_FIRST;
}

/** The running native sandboxes, from at most `MAX_PAGES` pages and no more than `MAX_SANDBOXES`. */
const runningNativeSandboxes = (api: VercelSandboxApi, order: ListOrder) =>
  Effect.gen(function* () {
    const found: NativeSandbox[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < NATIVE_SANDBOX_SWEEP.MAX_PAGES; page += 1) {
      const listed = yield* api.listRunning(cursor, order);
      for (const sandbox of listed.sandboxes) {
        const native = nativeSandboxOf(sandbox);
        if (native !== undefined) found.push(native);
      }
      cursor = listed.next;
      if (cursor === undefined || found.length >= NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES) break;
    }
    return found.slice(0, NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES);
  });

/**
 * Whether the sandbox, read afresh, has moved on from the list: gone, down,
 * in another session, or running a runner that has not exited. A runner
 * exits as its run ends, so one still up after the run ended is a newer
 * launch a message started since. Vercel not answering counts as moved on.
 */
const movedOn = (api: VercelSandboxApi, sandbox: NativeSandbox) =>
  Effect.gen(function* () {
    const [fresh] = yield* api.listTagged(sandbox.sessionId);
    if (
      fresh === undefined ||
      fresh.status !== RUNNING_STATUS ||
      fresh.currentSessionId !== sandbox.running
    ) {
      return true;
    }
    const runner = taggedRunner(fresh);
    if (runner === undefined || runner.sandboxSessionId !== sandbox.running) return false;
    return (yield* api.commandExit(runner.sandboxSessionId, runner.commandId)) === null;
  }).pipe(Effect.orElseSucceed(() => true));

/** A count of stops taken, shared by the sandboxes one sweep reads at once. */
interface StopBudget {
  remaining: number;
}

/** Whether the run of the sandbox's agent ended past the grace, read from the store. */
const runEnded = (sandbox: NativeSandbox, now: Date) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), (standing) => {
    if (Option.isNone(standing)) return Option.none();
    const { conversationId, endedAt } = standing.value;
    const endedBefore = now.getTime() - Duration.toMillis(NATIVE_SANDBOX_SWEEP.GRACE);
    return endedAt === null || endedAt.getTime() > endedBefore
      ? Option.none()
      : Option.some(conversationId);
  });

/**
 * One running native sandbox dealt with: stopped where its run ended past
 * the grace, no newer runner runs in it, and no Terminal holds it, and left
 * otherwise. The run's end is read again after the sandbox, and the lease
 * last, so a message or a Terminal that came since keeps the sandbox; what
 * lands between that read and the stop is the same narrow window the run's
 * own END stop has.
 */
const endSandbox = (
  api: VercelSandboxApi,
  sandbox: NativeSandbox,
  now: Date,
  budget: StopBudget,
): Effect.Effect<SandboxEnding, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.gen(function* () {
    if (Option.isNone(yield* runEnded(sandbox, now))) return SANDBOX_ENDING.LEFT;
    if (yield* movedOn(api, sandbox)) return SANDBOX_ENDING.LEFT;
    const ended = yield* runEnded(sandbox, now);
    if (Option.isNone(ended)) return SANDBOX_ENDING.LEFT;
    if (yield* sandboxHeld(ended.value, now)) return SANDBOX_ENDING.HELD;
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
        `an ended native sandbox was not stopped: ${stopped.failure.message}`,
      );
      return SANDBOX_ENDING.FAILED;
    }
    return SANDBOX_ENDING.STOPPED;
  });

/**
 * Stops the running native sandboxes whose run ended and which no Terminal
 * holds, a sweep's worth, `CONCURRENCY` at a time. A list Vercel did not
 * answer sweeps nothing this minute rather than failing the sweeps after it.
 */
export const sweepNativeSandboxes = /* @__PURE__ */ Effect.fn("web/sweepNativeSandboxes")(
  function* (
    now: Date,
  ): Effect.fn.Return<
    NativeSandboxSweepOutcome,
    QueryError | Schema.SchemaError,
    DatabaseServices | HttpClient.HttpClient
  > {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const listed = yield* Effect.result(runningNativeSandboxes(api, listOrderAt(now)));
    if (Result.isFailure(listed)) {
      yield* Effect.logWarning(`the running sandboxes were not listed: ${listed.failure.message}`);
      return NOTHING_SWEPT;
    }
    const budget: StopBudget = { remaining: NATIVE_SANDBOX_SWEEP.MAX_STOPS };
    const endings = yield* Effect.forEach(
      listed.success,
      (sandbox) => endSandbox(api, sandbox, now, budget),
      { concurrency: NATIVE_SANDBOX_SWEEP.CONCURRENCY },
    );
    const count = (ending: SandboxEnding) => endings.filter((each) => each === ending).length;
    return {
      stopped: count(SANDBOX_ENDING.STOPPED),
      held: count(SANDBOX_ENDING.HELD),
      failed: count(SANDBOX_ENDING.FAILED),
      deferred: count(SANDBOX_ENDING.DEFERRED),
    };
  },
);
