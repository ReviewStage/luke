/**
 * native-sandbox-sweep.ts -- the scheduled sweep's stop of a native agent's sandbox whose run ended and which no Terminal holds.
 *
 * A native harness's sandbox (Claude Code's or Codex's, which Luke opens
 * itself, `coder-host/claude-code-sessions.ts`) is stopped when its runner
 * ends: the events route calls `runnerEnded` on the runner's END. A stop
 * that failed there is logged and not retried, so the sandbox would idle
 * until its timeout. This sweep retries it: it pages through the project's
 * running sandboxes, oldest first, keeps the ones named as Luke names a
 * native sandbox and carrying an agent's tag, and stops each whose
 * conversation is native, whose newest turn ended longer ago than a short
 * grace (which leaves the END's own stop to go first), and on which no
 * developer's Terminal holds a lease. eve's sandboxes are never looked at
 * past their name, and a run still going, or waiting on a wakeup (whose turn
 * stays running), keeps its sandbox. The stop is as the END's: the
 * repository's credential taken off the firewall, then the session stopped,
 * its filesystem kept for a later resume.
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
import { NATIVE_NAME, RUNNER_TAG } from "../agents/coder-host/claude-code-sessions.js";
import { OPEN_INTERNET_POLICY } from "../agents/terminal/agent-sandbox.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  RUNNING_STATUS,
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

/** A running sandbox Luke opened for a native agent: the session it runs and the agent its tag names. */
interface NativeSandbox {
  readonly running: string;
  readonly agentId: string;
}

function nativeSandboxOf(sandbox: ListedSandbox): NativeSandbox | undefined {
  if (!sandbox.name.startsWith(NATIVE_NAME.SANDBOX)) return undefined;
  // A page may name a sandbox that stopped since it was asked for, as Vercel recovers overdue sessions.
  if (sandbox.status !== RUNNING_STATUS || sandbox.currentSessionId === undefined) return undefined;
  const agentId = sandbox.tags?.[RUNNER_TAG.AGENT];
  if (agentId === undefined) return undefined;
  return { running: sandbox.currentSessionId, agentId };
}

/** The running native sandboxes, oldest first, from at most `MAX_PAGES` pages and no more than `MAX_SANDBOXES`; answers whether some were left past the bound. */
const runningNativeSandboxes = (api: VercelSandboxApi) =>
  Effect.gen(function* () {
    const found: NativeSandbox[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < NATIVE_SANDBOX_SWEEP.MAX_PAGES; page += 1) {
      const listed = yield* api.listRunning(cursor);
      for (const sandbox of listed.sandboxes) {
        const native = nativeSandboxOf(sandbox);
        if (native !== undefined) found.push(native);
      }
      cursor = listed.next;
      if (cursor === undefined || found.length >= NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES) break;
    }
    return found.slice(0, NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES);
  });

/** A count of stops taken, shared by the sandboxes one sweep reads at once. */
interface StopBudget {
  remaining: number;
}

/** One running native sandbox dealt with: stopped where its run ended past the grace and no Terminal holds it, and left otherwise. */
const endSandbox = (
  api: VercelSandboxApi,
  sandbox: NativeSandbox,
  now: Date,
  budget: StopBudget,
): Effect.Effect<SandboxEnding, QueryError | Schema.SchemaError, DatabaseServices> =>
  Effect.gen(function* () {
    const standing = yield* readNativeRunStanding(sandbox.agentId);
    if (Option.isNone(standing)) return SANDBOX_ENDING.LEFT;
    const { conversationId, endedAt } = standing.value;
    const endedBefore = now.getTime() - Duration.toMillis(NATIVE_SANDBOX_SWEEP.GRACE);
    if (endedAt === null || endedAt.getTime() > endedBefore) return SANDBOX_ENDING.LEFT;
    // Read last, just before the stop, so a developer who opened a Terminal since the run ended keeps the sandbox.
    if (yield* sandboxHeld(conversationId, now)) return SANDBOX_ENDING.HELD;
    if (budget.remaining <= 0) return SANDBOX_ENDING.DEFERRED;
    budget.remaining -= 1;
    const stopped = yield* Effect.result(
      Effect.andThen(
        Effect.ignore(api.updateNetworkPolicy(sandbox.running, OPEN_INTERNET_POLICY)),
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
    const listed = yield* Effect.result(runningNativeSandboxes(api));
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
