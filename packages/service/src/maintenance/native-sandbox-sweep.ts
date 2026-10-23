/**
 * native-sandbox-sweep.ts -- the scheduled sweep's stop of a native agent's sandbox whose run ended and which no Terminal holds.
 *
 * A native harness's sandbox (Claude Code's or Codex's, which Luke opens
 * itself, `coder-host/runner-sessions.ts`) is stopped when its runner
 * ends: the events route calls `runnerEnded` on the runner's END. A stop
 * that failed there is logged and not retried, so the sandbox would idle
 * until its timeout. This sweep retries it: it pages through the project's
 * running sandboxes, from the oldest and the newest on alternate minutes, keeps the ones named as Luke names a
 * native sandbox and carrying an agent's tag, reads a window of them that
 * moves along the list from one sweep to the next, and stops each whose
 * conversation is native, whose newest turn ended longer ago than a short
 * grace (which leaves the END's own stop to go first), and on which no
 * developer's Terminal holds a lease. eve's sandboxes are never looked at
 * past their name, and a run still going, or waiting on a wakeup (whose turn
 * stays running), keeps its sandbox, as does one a newer runner runs in. The
 * stop is as the END's: the repository's credential taken off the firewall,
 * then the session stopped, its filesystem kept for a later resume; where the
 * credential would not come off, the sandbox is left for the next sweep.
 *
 * A runner that exited while its run's turn still runs died without its END
 * (it drains its END to Luke before it exits): the sweep settles that turn
 * as failed (`settleRunnerLostTurns`), so the agent offers Continue rather
 * than running for a day, and its sandbox is stopped once the grace passes,
 * as any ended run's is. Nothing is relaunched.
 *
 * Every call is bounded so the sweep's minute holds: a few pages of the
 * list, a set number of sandboxes read against the store, taken from a
 * window that moves along the list from one sweep to the next, and a set
 * number of stops. What is asked of Vercel is a page, a name, and a session; what
 * is logged of a failure is its status.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import { readNativeRunStanding } from "@luke/database/models/coding-agent-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { Duration, Effect, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { RUNNER_TAG, SANDBOX_NAME, taggedRunner } from "../agents/coder-host/runner-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";

import {
  deploymentOidcToken,
  type ListedSandbox,
  OPEN_INTERNET_POLICY,
  SANDBOX_STATUS,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";
import { listOrderAt, listRunningSandboxes, windowAt } from "./sandbox-sweep-list.js";

export const NATIVE_SANDBOX_SWEEP = {
  /** How long after its run's newest turn ended a sandbox waits for the END's own stop before the sweep stops it. */
  GRACE: Duration.minutes(2),
  /** The most pages of running sandboxes one sweep reads, each the API's widest. */
  MAX_PAGES: 4,
  /** The most native sandboxes one sweep reads against the store; the rest wait for a later sweep's window. */
  MAX_SANDBOXES: 40,
  /** The most sandboxes one sweep stops. */
  MAX_STOPS: 10,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the running native sandboxes came to: sandboxes stopped, ones a Terminal holds, ones whose stop Vercel did not confirm, ones left for the next minute past the bound, and ones whose runner died mid-turn, its turn settled failed. */
export interface NativeSandboxSweepOutcome {
  stopped: number;
  held: number;
  failed: number;
  deferred: number;
  lost: number;
}

const NOTHING_SWEPT: NativeSandboxSweepOutcome = {
  stopped: 0,
  held: 0,
  failed: 0,
  deferred: 0,
  lost: 0,
};

const SANDBOX_ENDING = {
  STOPPED: "stopped",
  HELD: "held",
  FAILED: "failed",
  /** Its run goes on, or ended within the grace, or it is no native agent's the store knows. */
  LEFT: "left",
  /** Stoppable, but past the sweep's bound of stops. */
  DEFERRED: "deferred",
  /** Its runner exited while its run's turn still ran, which the sweep settled failed. */
  LOST: "lost",
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
  if (sandbox.status !== SANDBOX_STATUS.RUNNING || sandbox.currentSessionId === undefined)
    return undefined;
  const agentId = sandbox.tags?.[RUNNER_TAG.AGENT];
  const sessionId = sandbox.tags?.[SESSION_TAG];
  if (agentId === undefined || sessionId === undefined) return undefined;
  return { sessionId, running: sandbox.currentSessionId, agentId };
}

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
      fresh.status !== SANDBOX_STATUS.RUNNING ||
      fresh.currentSessionId !== sandbox.running
    ) {
      return true;
    }
    const runner = taggedRunner(fresh);
    if (runner === undefined || runner.sandboxSessionId !== sandbox.running) return false;
    return (yield* api.commandExit(runner.sandboxSessionId, runner.commandId)) === null;
  }).pipe(Effect.orElseSucceed(() => true));

/**
 * The command of the runner that exited, where the sandbox, read afresh,
 * still runs the session it was listed in and the runner its tags name
 * there has exited, or Vercel no longer knows its command. None for a
 * runner not yet tagged (a launch under way, which clears the runner's tags
 * first), or where Vercel does not answer.
 */
const exitedRunner = (api: VercelSandboxApi, sandbox: NativeSandbox) =>
  Effect.gen(function* () {
    const [fresh] = yield* api.listTagged(sandbox.sessionId);
    if (fresh?.status !== SANDBOX_STATUS.RUNNING || fresh.currentSessionId !== sandbox.running) {
      return undefined;
    }
    const runner = taggedRunner(fresh);
    if (runner === undefined || runner.sandboxSessionId !== sandbox.running) return undefined;
    const exit = yield* api.commandExit(runner.sandboxSessionId, runner.commandId);
    return exit === null ? undefined : runner.commandId;
  }).pipe(Effect.orElseSucceed(() => undefined));

/** A count of stops taken, shared by the sandboxes one sweep reads at once. */
interface StopBudget {
  remaining: number;
}

/** Whether the run of the sandbox's agent still has a turn queued or running, read from the store. */
const runGoesOn = (sandbox: NativeSandbox) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), (standing) =>
    Option.isSome(standing) && standing.value.endedAt === null
      ? Option.some(standing.value.conversationId)
      : Option.none(),
  );

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
  writer: Pick<StoreWriter, "consume">,
  sandbox: NativeSandbox,
  now: Date,
  budget: StopBudget,
): Effect.Effect<SandboxEnding, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.gen(function* () {
    const going = yield* runGoesOn(sandbox);
    if (Option.isSome(going)) {
      const exited = yield* exitedRunner(api, sandbox);
      if (exited === undefined) return SANDBOX_ENDING.LEFT;
      // Read again just before the settle, so a message that relaunched the runner since keeps its turn.
      if (Option.isNone(yield* runGoesOn(sandbox))) return SANDBOX_ENDING.LEFT;
      if ((yield* exitedRunner(api, sandbox)) !== exited) return SANDBOX_ENDING.LEFT;
      yield* settleRunnerLostTurns(writer, going.value, now.getTime());
      return SANDBOX_ENDING.LOST;
    }
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
    const listed = yield* Effect.result(
      listRunningSandboxes(api, listOrderAt(now), NATIVE_SANDBOX_SWEEP.MAX_PAGES, nativeSandboxOf),
    );
    if (Result.isFailure(listed)) {
      yield* Effect.logWarning(`the running sandboxes were not listed: ${listed.failure.message}`);
      return NOTHING_SWEPT;
    }
    const budget: StopBudget = { remaining: NATIVE_SANDBOX_SWEEP.MAX_STOPS };
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const endings = yield* Effect.forEach(
      windowAt(listed.success, NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES, now),
      (sandbox) => endSandbox(api, writer, sandbox, now, budget),
      { concurrency: NATIVE_SANDBOX_SWEEP.CONCURRENCY },
    );
    const count = (ending: SandboxEnding) => endings.filter((each) => each === ending).length;
    return {
      stopped: count(SANDBOX_ENDING.STOPPED),
      held: count(SANDBOX_ENDING.HELD),
      failed: count(SANDBOX_ENDING.FAILED),
      deferred: count(SANDBOX_ENDING.DEFERRED),
      lost: count(SANDBOX_ENDING.LOST),
    };
  },
);
