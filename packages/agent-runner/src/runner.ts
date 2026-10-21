/**
 * runner.ts -- one launch of a Luke agent: the bearer and the config line read, the harness the config names run (Claude Code here, Codex in `codex.ts`), and the launch's last event posted; for Claude Code, `query()` started in streaming input mode, Luke's lines fed to it, its messages posted out, and the launch ended when the agent's turn is.
 *
 * Two loops run side by side. The input loop reads Luke's stdin lines and
 * acts on each at once: a message joins the prompt stream, a stop calls
 * `interrupt()`, a model change calls `setModel()` or `applyFlagSettings()`.
 * It never waits on the session's output, so a stop reaches the CLI even
 * while a long foreground command holds the turn (P00 found exactly this).
 * The output loop posts every SDK message, in order, and decides when the
 * launch is over.
 *
 * When the turn ends. A `result` closes one model turn, but the agent's turn,
 * its whole run, can outlive it: Claude Code ends a model turn while a
 * background command runs or a `ScheduleWakeup` is set, and starts another
 * when either comes back (P00's first turn does both). The Stop hook, which
 * runs before each `result`, reports that work (`background_tasks`,
 * `session_crons`), so the runner ends the launch at a `result` only when
 * the last Stop hook reported none, and otherwise posts a WAITING event and
 * keeps the CLI up. Nor does a launch end while a message Luke sent during
 * a turn is still unanswered: the CLI runs it as its next turn. A `result`
 * after a stop ends the launch whatever is pending, and so does one no Stop
 * hook came before, such as an error's. A stop interrupts whichever turn is
 * running, a wakeup's included, and ends a launch with none at once.
 */

import { randomUUID, type UUID } from "node:crypto";
import type {
  HookCallback,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  MutableRef,
  Option,
  Queue,
  Redacted,
  Ref,
  Schema,
  Stream,
} from "effect";
import { ClaudeCode, type ClaudeCodeSession } from "./claude-code.js";
import { runCodex } from "./codex.js";
import { type EventSink, makeEventSink } from "./events.js";
import { type LaunchContext, type LaunchOutcome, RunnerFailed, type RunnerSelf } from "./launch.js";
import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  type InputLine,
  InputLineSchema,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RunnerConfigSchema,
  type RunnerEnd,
  type RunnerEndEvent,
  type RunnerWaiting,
} from "./protocol.js";

/** The name the Luke MCP server is registered under, so its tools reach the model as `mcp__luke__<tool>`. */
const MCP_SERVER = "luke";

/**
 * The variables no command the agent runs may see: the plan's token, every
 * other way the CLI could be handed one, and the runner's own bearer. Denied
 * rather than masked, as P00 found, because no command the agent runs has a
 * reason to reach Anthropic or Luke as the agent.
 */
const DENIED_VARIABLES = [
  RUNNER_ENV.CLAUDE_TOKEN,
  RUNNER_ENV.BEARER,
  RUNNER_ENV.API_KEY,
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
] as const;

const CLAUDE_EFFORTS: ReadonlySet<string> = new Set(Object.values(EFFORT));

/** Whether a model line's effort is one the CLI takes. */
function isClaudeEffort(effort: string): effort is Effort {
  return CLAUDE_EFFORTS.has(effort);
}

/** What the last Stop hook reported still in flight. */
type InFlight = Omit<RunnerWaiting, "type">;

/** What a launch reads from its process: its stdin as lines, and its environment. */
export interface RunnerInput {
  readonly lines: Stream.Stream<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The runner's own bundle as a command, which Codex runs for its token. */
  readonly self?: RunnerSelf | undefined;
}

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(RunnerConfigSchema));
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

/** The documented options a launch runs `query()` with (the plan's P05). */
function queryOptions(
  config: ClaudeCodeConfig,
  env: RunnerInput["env"],
  bearer: Redacted.Redacted,
  onStop: HookCallback,
): Options {
  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.executable,
    model: config.model,
    systemPrompt: { type: "preset", preset: "claude_code", append: config.append },
    settingSources: ["project"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    // The CLI's environment is the runner's own, less the bearer, which only
    // the runner and the MCP header use; Node leaves an undefined one unset.
    env: { ...env, [RUNNER_ENV.BEARER]: undefined },
    mcpServers: {
      [MCP_SERVER]: {
        type: "http",
        url: config.mcpUrl,
        headers: { Authorization: `Bearer ${Redacted.value(bearer)}` },
      },
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      // Note that the sandbox's VM masks /proc/kcore and /proc/keys, so the
      // kernel refuses bubblewrap a fresh /proc and every command failed; the
      // host /proc is bound instead, where another process's environ, the
      // CLI's and its token included, is still refused, as under Codex.
      enableWeakerNestedSandbox: true,
      network: { allowedDomains: [...config.allowedDomains] },
      credentials: { envVars: DENIED_VARIABLES.map((name) => ({ name, mode: "deny" })) },
    },
    hooks: { Stop: [{ hooks: [onStop] }] },
  };
  if (config.effort !== undefined) options.effort = config.effort;
  if (config.resume !== undefined) options.resume = config.resume;
  return options;
}

/** A message line as the SDK takes it: from the human, and queued behind the running turn where one runs. */
function userMessage(
  uuid: UUID,
  content: Extract<InputLine, { type: "message" }>["content"],
  turnRunning: boolean,
): SDKUserMessage {
  const message: SDKUserMessage = {
    type: "user",
    message: { role: "user", content: [...content] },
    parent_tool_use_id: null,
    origin: { kind: "human" },
    uuid,
    // Note that the CLI keeps its own session id, so a prompt names none.
    session_id: "",
  };
  if (turnRunning) message.priority = "next";
  return message;
}

/** The launch's state, shared by its two loops. */
interface Launch {
  readonly session: ClaudeCodeSession;
  readonly prompts: Queue.Queue<SDKUserMessage, Cause.Done>;
  readonly sink: EventSink;
  readonly inFlight: MutableRef.MutableRef<InFlight | undefined>;
  /** Whether the CLI is in a turn: from a message Luke sent, or from the CLI's own output, a wakeup's turn included. */
  readonly turnRunning: Ref.Ref<boolean>;
  /** The messages Luke sent that no `result` has answered yet, by their uuid. */
  readonly unanswered: Ref.Ref<ReadonlySet<string>>;
  readonly stopping: Ref.Ref<boolean>;
  readonly ended: Deferred.Deferred<RunnerEnd>;
  /** The launch's first event number, which a turn-scoped stop names. */
  readonly firstSequence: number;
}

/** Calls one of the session's control requests, reporting a failure rather than ending the launch on it. */
function control(step: string, call: () => Promise<void>) {
  return Effect.tryPromise(call).pipe(
    Effect.catch(() => Effect.logWarning(`agent-runner: ${step} failed`)),
    Effect.asVoid,
  );
}

/** One of Luke's lines, acted on at once. */
const takeLine = Effect.fn("agent-runner/takeLine")(function* (launch: Launch, text: string) {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    // Note that we never echo the line, because a message carries the user's words.
    return yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
  }
  const value = line.value;
  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      const running = yield* Ref.getAndSet(launch.turnRunning, true);
      // SAFETY: a line's uuid is checked against the UUID pattern as the line is read.
      const uuid = (value.uuid as UUID | undefined) ?? randomUUID();
      yield* Ref.update(launch.unanswered, (sent) => new Set(sent).add(uuid));
      // Posted ahead of the hand-off, so it is numbered before anything the CLI says of the message.
      yield* launch.sink.emit({ type: RUNNER_EVENT.ACCEPTED, uuid });
      yield* Queue.offer(launch.prompts, userMessage(uuid, value.content, running));
      return;
    }
    case INPUT_LINE.STOP: {
      // A stop for another launch's turn is not this launch's to take.
      if (value.launch !== undefined && value.launch !== launch.firstSequence) {
        return yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
      }
      // A stop with no turn running has nothing to interrupt: the launch,
      // waiting or idle, ends here.
      if (!(yield* Ref.get(launch.turnRunning))) {
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
        return;
      }
      yield* Ref.set(launch.stopping, true);
      yield* control("interrupt", async () => {
        await launch.session.interrupt();
      });
      return;
    }
    case INPUT_LINE.MODEL: {
      const { model, effort } = value;
      if (model !== undefined) yield* control("setModel", () => launch.session.setModel(model));
      if (effort !== undefined && !isClaudeEffort(effort)) {
        yield* Effect.logWarning("agent-runner: skipped an effort Claude Code does not take");
      } else if (effort !== undefined) {
        yield* control("applyFlagSettings", () =>
          launch.session.applyFlagSettings({ effortLevel: effort }),
        );
      }
      return;
    }
    case INPUT_LINE.TOKEN:
      // Note that the CLI's setup-token outlives any launch, so a token line
      // is Codex's alone; never echoed, since it carries one.
      return yield* Effect.logWarning("agent-runner: a Claude Code launch skipped a token line");
  }
});

/** The SDK message types the runner acts on, as the SDK spells them. */
const SDK_MESSAGE = {
  ASSISTANT: "assistant",
  STREAM_EVENT: "stream_event",
  USER: "user",
  RESULT: "result",
} as const satisfies Record<string, SDKMessage["type"]>;

/** The message types that say the CLI is in a turn, whoever started it. */
const TURN_OUTPUT: ReadonlySet<SDKMessage["type"]> = new Set([
  SDK_MESSAGE.ASSISTANT,
  SDK_MESSAGE.STREAM_EVENT,
  SDK_MESSAGE.USER,
]);

/**
 * The messages Luke sent that a `result` leaves unanswered. A result names
 * every prompt its turn consumed, folded ones included; one that names none
 * (a delivery failure, or an older CLI) is taken to answer them all, so a
 * launch never outwaits a prompt the CLI will not answer.
 */
function stillUnanswered(
  sent: ReadonlySet<string>,
  result: Extract<SDKMessage, { type: typeof SDK_MESSAGE.RESULT }>,
): ReadonlySet<string> {
  const answered =
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? undefined : [result.user_message_uuid]);
  if (answered === undefined) return new Set();
  const left = new Set(sent);
  for (const uuid of answered) left.delete(uuid);
  return left;
}

/** One SDK message, posted, and whether it ends the launch. */
const takeMessage = Effect.fn("agent-runner/takeMessage")(function* (
  launch: Launch,
  message: SDKMessage,
) {
  yield* launch.sink.emit(message);
  if (TURN_OUTPUT.has(message.type)) yield* Ref.set(launch.turnRunning, true);
  if (message.type !== SDK_MESSAGE.RESULT) return;
  const inFlight = MutableRef.getAndSet(launch.inFlight, undefined);
  if (yield* Ref.get(launch.stopping)) {
    return yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
  }
  // A message Luke sent during the turn that the turn did not take runs as
  // the CLI's next turn, so the launch goes on until it is answered.
  const left = stillUnanswered(yield* Ref.get(launch.unanswered), message);
  yield* Ref.set(launch.unanswered, left);
  if (left.size > 0) return;
  const waiting =
    inFlight !== undefined &&
    (inFlight.background_tasks.length > 0 || inFlight.session_crons.length > 0);
  if (!waiting) return yield* Deferred.succeed(launch.ended, RUNNER_END.TURN_ENDED);
  yield* Ref.set(launch.turnRunning, false);
  yield* launch.sink.emit({ type: RUNNER_EVENT.WAITING, ...inFlight });
});

/**
 * One Claude Code launch, from its config to the moment its CLI is closed.
 * Answers why it ended, and the CLI's failure where it failed.
 */
const runClaudeCode = Effect.fn("agent-runner/runClaudeCode")(function* (
  context: LaunchContext<ClaudeCodeConfig>,
) {
  const claudeCode = yield* ClaudeCode;
  const { config, lines, sink, bearer } = context;
  const inFlight = MutableRef.make<InFlight | undefined>(undefined);
  const onStop: HookCallback = async (hook) => {
    if (hook.hook_event_name === "Stop") {
      MutableRef.set(inFlight, {
        background_tasks: hook.background_tasks ?? [],
        session_crons: hook.session_crons ?? [],
      });
    }
    return { continue: true };
  };
  const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const session = claudeCode.query({
    prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
    options: queryOptions(config, context.env, bearer, onStop),
  });
  const launch: Launch = {
    session,
    prompts,
    sink,
    inFlight,
    turnRunning: yield* Ref.make(false),
    unanswered: yield* Ref.make<ReadonlySet<string>>(new Set()),
    stopping: yield* Ref.make(false),
    ended: yield* Deferred.make<RunnerEnd>(),
    firstSequence: config.firstSequence,
  };

  // Luke closing stdin ends the prompt stream, and the CLI ends once it has
  // answered what it was given.
  const inputLoop = Effect.gen(function* () {
    for (;;) yield* takeLine(launch, yield* Queue.take(lines));
  }).pipe(
    Effect.catchIf(Cause.isDone, () => Queue.end(prompts)),
    Effect.asVoid,
  );
  let failure = "";
  const outputLoop = Stream.fromAsyncIterable(session, (cause) => cause).pipe(
    Stream.runForEach((message) => takeMessage(launch, message)),
    Effect.matchEffect({
      onSuccess: () => Deferred.succeed(launch.ended, RUNNER_END.INPUT_CLOSED),
      onFailure: (cause) => {
        failure = cause instanceof Error ? cause.message : String(cause);
        return Deferred.succeed(launch.ended, RUNNER_END.FAILED);
      },
    }),
  );
  const loops = [
    yield* Effect.forkScoped(inputLoop),
    yield* Effect.forkScoped(outputLoop),
    yield* sink.undelivered.pipe(
      Effect.andThen(Deferred.succeed(launch.ended, RUNNER_END.FAILED)),
      Effect.forkScoped,
    ),
  ];

  // The loops stop before the session closes, so nothing it emits on the
  // way down is numbered after the launch's last event.
  const end = yield* Deferred.await(launch.ended);
  yield* Fiber.interruptAll(loops);
  session.close();
  return { end, failure } satisfies LaunchOutcome;
});

/**
 * One launch, from its config line to its last event. Answers why it ended;
 * fails where it never started, or where Luke would not take its events.
 */
export const runAgent = Effect.fn("agent-runner/runAgent")(function* (input: RunnerInput) {
  const bearerValue = input.env[RUNNER_ENV.BEARER];
  if (bearerValue === undefined || bearerValue === "") {
    return yield* new RunnerFailed({ detail: `${RUNNER_ENV.BEARER} is not set` });
  }
  const bearer = Redacted.make(bearerValue);
  const tokens = [RUNNER_ENV.CLAUDE_TOKEN, RUNNER_ENV.API_KEY, RUNNER_ENV.CODEX_TOKEN].flatMap(
    (name) => {
      const value = input.env[name];
      return value === undefined || value === "" ? [] : [Redacted.make(value)];
    },
  );
  const secrets = [bearer, ...tokens];

  // Stdin is read in a loop of its own from the first line on, so nothing
  // the session does can hold up a line Luke wrote.
  const lines = yield* Queue.unbounded<string, Cause.Done>();
  yield* input.lines.pipe(Stream.runIntoQueue(lines), Effect.forkScoped);
  const first = yield* Queue.take(lines).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "stdin closed before the config line" })),
  );
  const config = yield* decodeConfig(first).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "the config line is not a runner config" })),
  );

  const sink = yield* makeEventSink({
    url: config.eventsUrl,
    bearer,
    firstSequence: config.firstSequence,
    secrets,
  });
  const context = { lines, env: input.env, bearer, sink, self: input.self };
  const { end, failure } =
    config.harness === RUNNER_HARNESS.CODEX
      ? yield* runCodex({ ...context, config })
      : yield* runClaudeCode({ ...context, config });
  const last: RunnerEndEvent =
    failure === ""
      ? { type: RUNNER_EVENT.END, reason: end }
      : { type: RUNNER_EVENT.END, reason: end, detail: failure };
  yield* sink.emit(last);
  yield* sink.drain;
  return end;
});
