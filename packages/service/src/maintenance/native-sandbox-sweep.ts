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
 * grace (which leaves the END's own stop to go first), whose agent's runner
 * lease no call holds (a message relaunching the agent holds it, as the
 * END's stop does), and on which no developer's Terminal holds a lease.
 * eve's sandboxes are never looked at past their name, and a run still
 * going, or waiting on a wakeup (whose turn stays running), keeps its
 * sandbox. A runner still up after its run ended
 * is warm (`CODER.RUNNER_WARM`), or a newer launch a message started since:
 * once the run has stood idle past the warm window, the sweep asks it to end
 * (`retireWarmRunner`), which a runner that took a message since declines,
 * and its END stops the sandbox. The stop is as the END's: the repository's credential taken off the firewall,
 * then the session stopped, its filesystem kept for a later resume; where the
 * credential would not come off, the sandbox is left for the next sweep.
 *
 * A runner that exited while its run's turn still runs died without its END
 * (it drains its END to Luke before it exits): the sweep settles that turn
 * as failed (`settleRunnerLostTurns`), so the agent offers Continue rather
 * than running for a day, and its sandbox is stopped once the grace passes,
 * as any ended run's is. The turn keeps how the runner ended, its exit code
 * and the redacted tail of its stderr, after the fixed sentence, and the
 * settle is logged as an error under the agent's ids and reported as an
 * issue. Nothing is relaunched.
 *
 * Every call is bounded so the sweep's minute holds: a few pages of the
 * list, a set number of sandboxes read against the store, taken from a
 * window that moves along the list from one sweep to the next, and a set
 * number of stops. What is asked of Vercel is a page, a name, a session, and
 * a dead runner's stderr; what is logged of a failure is its status, and of a
 * dead runner its exit and its stderr's redacted tail.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  RUNNER_LOST_DETAIL,
  runningTurnIds,
  settleRunnerLostTurns,
} from "@luke/database/models/abandoned-turns";
import { readNativeRunStanding } from "@luke/database/models/agent-store";
import { sandboxHeld } from "@luke/database/models/sandbox-terminal-lease";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { redactCredentials } from "@luke/features/credential-redaction";
import { TURN_FAILURE } from "@luke/features/turn-run";
import { Cause, Data, Duration, Effect, ErrorReporter, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { CODER } from "../agents/coder-host/bounds.js";
import { holdingRunnerIfFree } from "../agents/coder-host/runner-lease.js";
import { retireWarmRunner } from "../agents/coder-host/runner-sessions.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { RUNNER_TAG, SANDBOX_NAME, taggedRunner } from "../agents/machine/vercel-machine.js";
import { FAILURE_CHARS } from "../agents/native-events/runner-moments.js";
import {
  COMMAND_GONE,
  type CommandExit,
  deploymentOidcToken,
  type ListedSandbox,
  SANDBOX_STATUS,
  SESSION_TAG,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";
import {
  listOrderAt,
  listRunningSandboxes,
  type StopBudget,
  stopWithinBudget,
  windowAt,
} from "./sandbox-sweep-list.js";

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

/** What one sweep of the running native sandboxes came to: sandboxes stopped, warm runners retired, ones a Terminal holds, ones whose stop Vercel did not confirm, ones left for the next minute past the bound, and ones whose runner died mid-turn, its turn settled failed. */
export interface NativeSandboxSweepOutcome {
  stopped: number;
  retired: number;
  held: number;
  failed: number;
  deferred: number;
  lost: number;
}

const NOTHING_SWEPT: NativeSandboxSweepOutcome = {
  stopped: 0,
  retired: 0,
  held: 0,
  failed: 0,
  deferred: 0,
  lost: 0,
};

const SANDBOX_ENDING = {
  STOPPED: "stopped",
  /** Its runner was warm past `CODER.RUNNER_WARM`, and was asked to end, which its END's stop follows. */
  RETIRED: "retired",
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

/** Where a listed sandbox's runner stands, read afresh. */
const RUNNER_STANDING = {
  /** The sandbox is gone, down, or in another session; Vercel not answering counts as this. */
  MOVED_ON: "moved_on",
  /** Its runner still runs: warm past its run's turn, or a newer launch a message started since. */
  RUNNING: "running",
  /** Its runner exited, or none is tagged in its session. */
  EXITED: "exited",
} as const;

type RunnerStanding = (typeof RUNNER_STANDING)[keyof typeof RUNNER_STANDING];

const runnerStanding = (
  api: VercelSandboxApi,
  sandbox: NativeSandbox,
): Effect.Effect<RunnerStanding> =>
  Effect.gen(function* () {
    const [fresh] = yield* api.listTagged(sandbox.sessionId);
    if (
      fresh === undefined ||
      fresh.status !== SANDBOX_STATUS.RUNNING ||
      fresh.currentSessionId !== sandbox.running
    ) {
      return RUNNER_STANDING.MOVED_ON;
    }
    const runner = taggedRunner(fresh);
    if (runner === undefined || runner.sandboxSessionId !== sandbox.running) {
      return RUNNER_STANDING.EXITED;
    }
    const exit = yield* api.commandExit(runner.sandboxSessionId, runner.commandId);
    return exit === null ? RUNNER_STANDING.RUNNING : RUNNER_STANDING.EXITED;
  }).pipe(Effect.orElseSucceed((): RunnerStanding => RUNNER_STANDING.MOVED_ON));

/** A runner that exited: its command, and its exit code, or gone where Vercel no longer knows the command. */
interface ExitedRunner {
  readonly commandId: string;
  readonly exit: Exclude<CommandExit, null>;
}

/**
 * The runner that exited, where the sandbox, read afresh, still runs the
 * session it was listed in and the runner its tags name there has exited,
 * or Vercel no longer knows its command. None for a runner not yet tagged
 * (a launch under way, which clears the runner's tags first), or where
 * Vercel does not answer.
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
    return exit === null ? undefined : { commandId: runner.commandId, exit };
  }).pipe(Effect.orElseSucceed(() => undefined));

/**
 * What a runner that died mid-turn printed on stderr before it went, its
 * tail redacted (`commandStderrTail`); none where it printed nothing, and
 * none, with a warning, where Vercel did not answer within its wait, so a
 * slow read costs the sweep's minute no more than that and the exit code is
 * kept all the same.
 */
const lostRunnerStderr = (api: VercelSandboxApi, sandbox: NativeSandbox, commandId: string) =>
  api
    .commandStderrTail(sandbox.running, commandId)
    .pipe(
      Effect.catch((unavailable) =>
        Effect.as(
          Effect.logWarning(`a lost runner's stderr was not read: ${unavailable.message}`).pipe(
            Effect.annotateLogs({ agentId: sandbox.agentId, sandboxSessionId: sandbox.running }),
          ),
          undefined,
        ),
      ),
    );

/** A lost runner's turn's failure detail: the fixed sentence the status words match on, then how the runner ended, redacted and bounded as a runner's own failure is. */
function runnerLostDetail(exit: ExitedRunner["exit"], stderr: string | undefined): string {
  const ended = `exit ${exit === COMMAND_GONE ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`;
  return `${RUNNER_LOST_DETAIL}: ${redactCredentials(ended)}`.slice(0, FAILURE_CHARS);
}

/**
 * A runner that died mid-turn without its END, reported as one issue
 * whatever the agent, since the ids, exit, and stderr ride as attributes
 * rather than in its message.
 */
class RunnerLost extends Data.TaggedError("RunnerLost")<{
  readonly agentId: string;
  readonly conversationId: string;
  readonly turnIds: readonly string[];
  readonly sandboxSessionId: string;
  readonly exitCode: string;
  readonly stderr: string;
}> {
  override get message(): string {
    return RUNNER_LOST_DETAIL;
  }

  override readonly [ErrorReporter.attributes] = {
    agentId: this.agentId,
    conversationId: this.conversationId,
    turnIds: this.turnIds.join(","),
    sandboxSessionId: this.sandboxSessionId,
    exitCode: this.exitCode,
    stderr: this.stderr,
    failure: TURN_FAILURE.MODEL,
  };
}

/**
 * The turns of a run whose runner died mid-turn settled failed with how it
 * ended, read before the store is read again so the settle follows that
 * read at once. The turns it failed are logged once as an error under the
 * agent's ids and reported as an issue, since nothing the user did ends a
 * run this way; a turn its Stop cancelled is neither.
 */
const settledLostRunner = (
  writer: Pick<StoreWriter, "consume">,
  sandbox: NativeSandbox,
  conversationId: string,
  lostTurns: ReadonlySet<string>,
  runner: ExitedRunner & { readonly stderr: string | undefined },
  now: Date,
) =>
  Effect.gen(function* () {
    const { stderr } = runner;
    const detail = runnerLostDetail(runner.exit, stderr);
    const turnIds = yield* settleRunnerLostTurns(
      writer,
      conversationId,
      now.getTime(),
      detail,
      lostTurns,
    );
    // Note that a turn cancelled by its Stop, or one the writer refused, is no runner lost to report.
    if (turnIds.length === 0) return;
    const lost = new RunnerLost({
      agentId: sandbox.agentId,
      conversationId,
      turnIds,
      sandboxSessionId: sandbox.running,
      exitCode: String(runner.exit),
      stderr: stderr === undefined ? "none" : redactCredentials(stderr),
    });
    yield* Effect.logError(detail).pipe(
      Effect.annotateLogs({
        agentId: sandbox.agentId,
        conversationId,
        turnId: turnIds.join(","),
        sandboxSessionId: sandbox.running,
        failure: TURN_FAILURE.MODEL,
        exitCode: lost.exitCode,
      }),
    );
    yield* ErrorReporter.report(Cause.fail(lost));
  });

/** Whether the run of the sandbox's agent still has a turn queued or running, read from the store. */
const runGoesOn = (sandbox: NativeSandbox) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), (standing) =>
    Option.isSome(standing) && standing.value.endedAt === null
      ? Option.some(standing.value.conversationId)
      : Option.none(),
  );

/** The run of the sandbox's agent where it ended longer ago than the wait given, the grace where none is, read from the store: its conversation and its starter. */
const runEnded = (
  sandbox: NativeSandbox,
  now: Date,
  wait: Duration.Duration = NATIVE_SANDBOX_SWEEP.GRACE,
) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), (standing) => {
    if (Option.isNone(standing)) return Option.none();
    const { endedAt } = standing.value;
    const endedBefore = now.getTime() - Duration.toMillis(wait);
    return endedAt === null || endedAt.getTime() > endedBefore ? Option.none() : standing;
  });

/**
 * A runner still up after its run ended, asked to end once the run has
 * stood idle past `CODER.RUNNER_WARM`, and left warm before that.
 * `retireWarmRunner` reads the runner again under its lease, and the runner
 * ends only where it is still warm, so a message sent since keeps it. A
 * retire Vercel did not take is left for the next sweep.
 */
const retiredPastWarm = (api: VercelSandboxApi, sandbox: NativeSandbox, now: Date) =>
  Effect.gen(function* () {
    const ended = yield* runEnded(sandbox, now, CODER.RUNNER_WARM);
    if (Option.isNone(ended)) return SANDBOX_ENDING.LEFT;
    const retired = yield* Effect.result(
      retireWarmRunner({ ...sandbox, userId: ended.value.userId }),
    );
    if (Result.isFailure(retired)) {
      yield* Effect.logWarning(`a warm native runner was not retired: ${retired.failure._tag}`);
      return SANDBOX_ENDING.FAILED;
    }
    return retired.success ? SANDBOX_ENDING.RETIRED : SANDBOX_ENDING.LEFT;
  });

/**
 * An ended sandbox stopped under its agent's runner lease, and left where
 * another call holds the lease, as a message that resumed the sandbox holds
 * it through its relaunch, before any runner is tagged in it. Once the lease
 * is held, the runner and the run's end are read again, so a launch that
 * finished meanwhile keeps the sandbox, and the Terminal's hold is read last.
 */
const stoppedUnderLease = (
  api: VercelSandboxApi,
  sandbox: NativeSandbox,
  now: Date,
  budget: StopBudget,
) =>
  Effect.map(
    holdingRunnerIfFree(
      sandbox.agentId,
      Effect.gen(function* () {
        const runner = yield* runnerStanding(api, sandbox);
        if (runner !== RUNNER_STANDING.EXITED) return SANDBOX_ENDING.LEFT;
        const ended = yield* runEnded(sandbox, now);
        if (Option.isNone(ended)) return SANDBOX_ENDING.LEFT;
        if (yield* sandboxHeld(ended.value.conversationId, now)) return SANDBOX_ENDING.HELD;
        return yield* stopWithinBudget(api, sandbox.running, budget, "an ended native sandbox");
      }),
    ),
    Option.getOrElse((): SandboxEnding => SANDBOX_ENDING.LEFT),
  );

/**
 * One running native sandbox dealt with: stopped where its run ended past
 * the grace, no newer runner runs in it, no call holds its agent's runner
 * lease, and no Terminal holds it, and left otherwise. The run's end is read
 * again under the runner lease, and the Terminal's last, so a message or a
 * Terminal that came since keeps the sandbox; what lands between that read
 * and the stop is the same narrow window the run's own END stop has.
 */
const endSandbox = (
  api: VercelSandboxApi,
  writer: Pick<StoreWriter, "consume">,
  sandbox: NativeSandbox,
  now: Date,
  budget: StopBudget,
): Effect.Effect<
  SandboxEnding,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const going = yield* runGoesOn(sandbox);
    if (Option.isSome(going)) {
      const exited = yield* exitedRunner(api, sandbox);
      if (exited === undefined) return SANDBOX_ENDING.LEFT;
      // The turns open once the runner was seen gone, so a turn queued since is not failed for it.
      const lostTurns = new Set(yield* runningTurnIds(going.value));
      const stderr = yield* lostRunnerStderr(api, sandbox, exited.commandId);
      // Read again just before the settle, so a message that relaunched the runner since keeps its turn.
      if (Option.isNone(yield* runGoesOn(sandbox))) return SANDBOX_ENDING.LEFT;
      if ((yield* exitedRunner(api, sandbox))?.commandId !== exited.commandId) {
        return SANDBOX_ENDING.LEFT;
      }
      yield* settledLostRunner(writer, sandbox, going.value, lostTurns, { ...exited, stderr }, now);
      return SANDBOX_ENDING.LOST;
    }
    if (Option.isNone(yield* runEnded(sandbox, now))) return SANDBOX_ENDING.LEFT;
    const runner = yield* runnerStanding(api, sandbox);
    if (runner === RUNNER_STANDING.MOVED_ON) return SANDBOX_ENDING.LEFT;
    if (runner === RUNNER_STANDING.RUNNING) return yield* retiredPastWarm(api, sandbox, now);
    return yield* stoppedUnderLease(api, sandbox, now, budget);
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
      retired: count(SANDBOX_ENDING.RETIRED),
      held: count(SANDBOX_ENDING.HELD),
      failed: count(SANDBOX_ENDING.FAILED),
      deferred: count(SANDBOX_ENDING.DEFERRED),
      lost: count(SANDBOX_ENDING.LOST),
    };
  },
);
