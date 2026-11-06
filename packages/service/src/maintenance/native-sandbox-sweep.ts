import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  RUNNER_LOST_DETAIL,
  runningTurnIds,
  settleRunnerLostTurns,
} from "@repo/database/models/abandoned-turns";
import { readAgentRunnerRecord } from "@repo/database/models/agent-runner-record";
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
  agentTag,
  SANDBOX_NAME,
  SANDBOX_NAME_BEFORE_RENAME,
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
  MAX_PAGES: 4,
  MAX_SANDBOXES: 40,
  CONCURRENCY: 5,
} as const;

export interface NativeSandboxSweepOutcome {
  lost: number;
}

const NOTHING_SWEPT: NativeSandboxSweepOutcome = { lost: 0 };

const SANDBOX_ENDING = {
  LEFT: "left",
  LOST: "lost",
} as const;

type SandboxEnding = (typeof SANDBOX_ENDING)[keyof typeof SANDBOX_ENDING];

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
  if (sandbox.status !== SANDBOX_STATUS.RUNNING || sandbox.currentSessionId === undefined)
    return undefined;
  const agentId = agentTag(sandbox.tags);
  const sessionId = sandbox.tags?.[SESSION_TAG];
  if (agentId === undefined || sessionId === undefined) return undefined;
  return { name: sandbox.name, sessionId, running: sandbox.currentSessionId, agentId };
}

interface ExitedRunner {
  readonly commandId: string;
  readonly exit: Exclude<CommandExit, null>;
}

const recordedCommand = (sandbox: NativeSandbox, userId: string) =>
  Effect.map(readAgentRunnerRecord(userId, sandbox.sessionId), (record) =>
    Option.match(record, {
      onNone: () => undefined,
      onSome: (each) =>
        each.sandboxName === sandbox.name && each.sandboxSessionId === sandbox.running
          ? (each.commandId ?? undefined)
          : undefined,
    }),
  );

const exitedRunner = (api: VercelSandboxApi, sandbox: NativeSandbox, userId: string) =>
  Effect.gen(function* () {
    const commandId = yield* recordedCommand(sandbox, userId);
    if (commandId === undefined) return undefined;
    return yield* Effect.gen(function* () {
      const [fresh] = yield* api.listTagged(sandbox.sessionId);
      if (fresh?.status !== SANDBOX_STATUS.RUNNING || fresh.currentSessionId !== sandbox.running) {
        return undefined;
      }
      const session = yield* api.session({ name: fresh.name, sessionId: sandbox.running });
      const exit = yield* session.commandExit(commandId);
      return exit === null ? undefined : ({ commandId, exit } satisfies ExitedRunner);
    }).pipe(Effect.orElseSucceed(() => undefined));
  });

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

function runnerLostDetail(exit: ExitedRunner["exit"], stderr: string | undefined): string {
  const ended = `exit ${exit === COMMAND_GONE ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`;
  return `${RUNNER_LOST_DETAIL}: ${redactCredentials(ended)}`.slice(0, FAILURE_CHARS);
}

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

const goingOf = (standing: Option.Option<NativeRunStanding>): Option.Option<string> =>
  Option.isSome(standing) && standing.value.endedAt === null
    ? Option.some(standing.value.conversationId)
    : Option.none();

const runGoesOn = (sandbox: NativeSandbox) =>
  Effect.map(readNativeRunStanding(sandbox.agentId), goingOf);

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
    if (Option.isNone(going) || Option.isNone(standing)) return SANDBOX_ENDING.LEFT;
    const { userId } = standing.value;
    const exited = yield* exitedRunner(api, sandbox, userId);
    if (exited === undefined) return SANDBOX_ENDING.LEFT;
    const lostTurns = new Set(yield* runningTurnIds(going.value));
    const stderr = yield* lostRunnerStderr(api, sandbox, exited.commandId);
    const settled = holdingRunnerIfFree(
      sandbox.agentId,
      Effect.gen(function* () {
        if (Option.isNone(yield* runGoesOn(sandbox))) return SANDBOX_ENDING.LEFT;
        if ((yield* exitedRunner(api, sandbox, userId))?.commandId !== exited.commandId) {
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
