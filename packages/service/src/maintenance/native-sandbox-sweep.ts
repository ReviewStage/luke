/**
 * native-sandbox-sweep.ts -- the scheduled sweep's settle of a native agent's turn whose runner died mid-turn.
 *
 * A native harness's sandbox (Claude Code's or Codex's, which we open
 * ourselves, `coder-host/runner-sessions.ts`) is stopped when its runner
 * ends: the events route calls `runnerEnded` on the runner's END, and one
 * whose stop failed there, or whose runner died without its END, stops on
 * Vercel's own timeout. This sweep pages through the project's running
 * sandboxes, from the oldest and the newest on alternate minutes, keeps the
 * ones named as we name a native sandbox and carrying an agent's tag, and
 * reads a window of them that moves along the list from one sweep to the
 * next.
 *
 * A runner that exited while its run's turn still runs died without its END
 * (it drains its END to us before it exits): the sweep settles that turn
 * as failed (`settleRunnerLostTurns`), so the agent offers Continue rather
 * than running for a day. The turn keeps how the runner ended, its exit code
 * and the redacted tail of its stderr, after the fixed sentence, and the
 * settle is logged as an error under the agent's ids and reported as an
 * issue, each with the exit code alone. Every credential then comes off its
 * firewall, as at any turn's end, since the sandbox stops on its timeout with
 * its policy saved. Nothing is relaunched or stopped.
 *
 * Every call is bounded so the sweep's minute holds: a few pages of the
 * list, and a set number of sandboxes read against the store, taken from a
 * window that moves along the list from one sweep to the next. What is asked
 * of Vercel is a page, a name, a session, and a dead runner's stderr; what is
 * logged of a failure is its status, and of a dead runner its exit. Note that
 * the stderr is kept in the turn's row alone, never a log line or a report,
 * because those reach Sentry, where a short secret the redaction cannot
 * recognize would outlive the turn.
 */

import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  RUNNER_LOST_DETAIL,
  runningTurnIds,
  settleRunnerLostTurns,
} from "@repo/database/models/abandoned-turns";
import {
  type NativeRunStanding,
  readNativeRunStanding,
  readNativeRunStandings,
} from "@repo/database/models/agent-store";
import { type StoreWriter, storeWriter } from "@repo/database/models/writer";
import { redactCredentials } from "@repo/features/credential-redaction";
import { TURN_FAILURE } from "@repo/features/turn-run";
import { Cause, Data, Effect, ErrorReporter, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { holdingRunnerIfFree } from "../agents/coder-host/runner-lease.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  runnerTag,
  SANDBOX_NAME,
  SANDBOX_NAME_BEFORE_RENAME,
  taggedRunner,
} from "../agents/machine/vercel-machine.js";
import { FAILURE_CHARS } from "../agents/native-events/runner-moments.js";
import { sandboxFirewall } from "../agents/sandbox-firewall.js";
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
import { listOrderAt, listRunningSandboxes, windowAt } from "./sandbox-sweep-list.js";

export const NATIVE_SANDBOX_SWEEP = {
  /** The most pages of running sandboxes one sweep reads, each the API's widest. */
  MAX_PAGES: 4,
  /** The most native sandboxes one sweep reads against the store; the rest wait for a later sweep's window. */
  MAX_SANDBOXES: 40,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the running native sandboxes came to: the ones whose runner died mid-turn, its turn settled failed. */
export interface NativeSandboxSweepOutcome {
  lost: number;
}

const NOTHING_SWEPT: NativeSandboxSweepOutcome = { lost: 0 };

const SANDBOX_ENDING = {
  /** Its runner still runs, or its run ended, or a call holds its agent's runner lease, or it is no native agent's the store knows. */
  LEFT: "left",
  /** Its runner exited while its run's turn still ran, which the sweep settled failed. */
  LOST: "lost",
} as const;

type SandboxEnding = (typeof SANDBOX_ENDING)[keyof typeof SANDBOX_ENDING];

/** A running sandbox we opened for a native agent: its name, the session we minted for it, the sandbox session it runs, and the agent its tag names. */
interface NativeSandbox {
  readonly name: string;
  readonly sessionId: string;
  readonly running: string;
  readonly agentId: string;
}

function nativeSandboxOf(sandbox: ListedSandbox): NativeSandbox | undefined {
  if (
    !sandbox.name.startsWith(SANDBOX_NAME) &&
    !sandbox.name.startsWith(SANDBOX_NAME_BEFORE_RENAME)
  )
    return undefined;
  // A page may name a sandbox that stopped since it was asked for, as Vercel recovers overdue sessions.
  if (sandbox.status !== SANDBOX_STATUS.RUNNING || sandbox.currentSessionId === undefined)
    return undefined;
  const agentId = runnerTag(sandbox.tags, "AGENT");
  const sessionId = sandbox.tags?.[SESSION_TAG];
  if (agentId === undefined || sessionId === undefined) return undefined;
  return { name: sandbox.name, sessionId, running: sandbox.currentSessionId, agentId };
}

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
    const session = yield* api.session({ name: fresh.name, sessionId: runner.sandboxSessionId });
    const exit = yield* session.commandExit(runner.commandId);
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
  api.session({ name: sandbox.name, sessionId: sandbox.running }).pipe(
    Effect.flatMap((session) => session.commandStderrTail(commandId)),
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
 * whatever the agent, since the ids and exit ride as attributes rather than
 * in its message; its stderr stays in the turn's row.
 */
class RunnerLost extends Data.TaggedError("RunnerLost")<{
  readonly agentId: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly turnIds: readonly string[];
  readonly sandboxSessionId: string;
  readonly exitCode: string;
}> {
  override get message(): string {
    return RUNNER_LOST_DETAIL;
  }

  override readonly [ErrorReporter.attributes] = {
    agentId: this.agentId,
    conversationId: this.conversationId,
    turnIds: this.turnIds.join(","),
    sessionId: this.sessionId,
    sandboxSessionId: this.sandboxSessionId,
    exitCode: this.exitCode,
    failure: TURN_FAILURE.MODEL,
    reason: this._tag,
  };
}

/**
 * The turns of a run whose runner died mid-turn settled failed with how it
 * ended, read before the store is read again so the settle follows that
 * read at once. The turns it failed are logged once as an error under the
 * agent's ids and reported as an issue, since nothing the user did ends a
 * run this way; a turn its Stop canceled is neither.
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
    const detail = runnerLostDetail(runner.exit, runner.stderr);
    const turnIds = yield* settleRunnerLostTurns(
      writer,
      conversationId,
      now.getTime(),
      detail,
      lostTurns,
    );
    // Note that a turn canceled by its Stop, or one the writer refused, is no runner lost to report.
    if (turnIds.length === 0) return;
    const lost = new RunnerLost({
      agentId: sandbox.agentId,
      conversationId,
      turnIds,
      sessionId: sandbox.sessionId,
      sandboxSessionId: sandbox.running,
      exitCode: String(runner.exit),
    });
    yield* Effect.logError(`${RUNNER_LOST_DETAIL}: exit ${lost.exitCode}`).pipe(
      Effect.annotateLogs({
        agentId: sandbox.agentId,
        conversationId,
        turnId: turnIds.join(","),
        sessionId: sandbox.sessionId,
        sandboxSessionId: sandbox.running,
        failure: TURN_FAILURE.MODEL,
        reason: lost._tag,
        exitCode: lost.exitCode,
      }),
    );
    yield* ErrorReporter.report(Cause.fail(lost));
  });

/** The conversation of the run where it still has a turn queued or running. */
const goingOf = (standing: Option.Option<NativeRunStanding>): Option.Option<string> =>
  Option.isSome(standing) && standing.value.endedAt === null
    ? Option.some(standing.value.conversationId)
    : Option.none();

/** Whether the run of the sandbox's agent still has a turn queued or running, read from the store again. */
const runGoesOn = (sandbox: NativeSandbox) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), goingOf);

/**
 * One running native sandbox dealt with: its run's open turns settled
 * failed where its runner exited while the run still goes on, and every
 * credential taken off its firewall, and left otherwise. The run and the
 * runner are read again under the agent's runner lease, held through the
 * clear, so a message relaunching the runner keeps its turn and the
 * credentials its launch sets; a lease another call holds leaves the
 * sandbox for a later sweep.
 */
const endSandbox = (
  api: VercelSandboxApi,
  writer: Pick<StoreWriter, "consume">,
  sandbox: NativeSandbox,
  standing: Option.Option<NativeRunStanding>,
  now: Date,
): Effect.Effect<
  SandboxEnding,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const going = goingOf(standing);
    if (Option.isNone(going)) return SANDBOX_ENDING.LEFT;
    const exited = yield* exitedRunner(api, sandbox);
    if (exited === undefined) return SANDBOX_ENDING.LEFT;
    // The turns open once the runner was seen gone, so a turn queued since is not failed for it.
    const lostTurns = new Set(yield* runningTurnIds(going.value));
    const stderr = yield* lostRunnerStderr(api, sandbox, exited.commandId);
    const settled = holdingRunnerIfFree(
      sandbox.agentId,
      Effect.gen(function* () {
        // Read again just before the settle, so a message that relaunched the runner since keeps its turn.
        if (Option.isNone(yield* runGoesOn(sandbox))) return SANDBOX_ENDING.LEFT;
        if ((yield* exitedRunner(api, sandbox))?.commandId !== exited.commandId) {
          return SANDBOX_ENDING.LEFT;
        }
        yield* settledLostRunner(
          writer,
          sandbox,
          going.value,
          lostTurns,
          { ...exited, stderr },
          now,
        );
        // Note that the credentials come off as at any turn's end, because the sandbox then stops on its
        // timeout with its policy saved, and a later resume would wear them again.
        yield* sandboxFirewall(api)
          .clear({ name: sandbox.name, sessionId: sandbox.running })
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning(
                `a lost runner's credentials stayed on its sandbox: ${failure.message}`,
              ),
            ),
          );
        return SANDBOX_ENDING.LOST;
      }),
    );
    return Option.getOrElse(yield* settled, (): SandboxEnding => SANDBOX_ENDING.LEFT);
  });

/**
 * Settles the turns of the running native sandboxes whose runner died
 * mid-turn, a sweep's worth, `CONCURRENCY` at a time. A list Vercel did not
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
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const window = windowAt(listed.success, NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES, now);
    // The window's runs are read once for the lot; a sandbox reads its own again only just before it settles.
    const standings = yield* readNativeRunStandings(window.map((sandbox) => sandbox.agentId));
    const endings = yield* Effect.forEach(
      window,
      (sandbox) =>
        endSandbox(
          api,
          writer,
          sandbox,
          Option.fromUndefinedOr(standings.get(sandbox.agentId)),
          now,
        ),
      { concurrency: NATIVE_SANDBOX_SWEEP.CONCURRENCY },
    );
    return { lost: endings.filter((each) => each === SANDBOX_ENDING.LOST).length };
  },
);
