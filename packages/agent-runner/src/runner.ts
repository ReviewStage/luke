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
  McpSdkServerConfigWithInstance,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Fiber,
  MutableRef,
  Option,
  Queue,
  Redacted,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { ClaudeCode, type ClaudeCodeSession } from "./claude-code.js";
import { runCodex } from "./codex.js";
import { type EventSink, makeEventSink } from "./events.js";
import {
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  RunnerFailed,
  type RunnerSelf,
} from "./launch.js";
import { openMcpRelay } from "./mcp-relay.js";
import { ProcessTable } from "./processes.js";
import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  InputLineSchema,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_RELEASE,
  RunnerConfigSchema,
  type RunnerEnd,
  type RunnerEndEvent,
  type RunnerWaiting,
  type RunnerWakeup,
} from "./protocol.js";
import { oneShotDueAt } from "./wakeups.js";

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
  servers: Readonly<Record<string, McpSdkServerConfigWithInstance>>,
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
    // the runner uses; Node leaves an undefined one unset.
    env: { ...env, [RUNNER_ENV.BEARER]: undefined },
    // Note that the SDK puts an HTTP server's config, headers and all, in the
    // CLI's argv, which any process in the sandbox can read, so Luke's is an
    // SDK server the runner relays over the CLI's own stdio (`mcp-relay.ts`), as is each integration's.
    mcpServers: { ...servers },
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
  // Note that a headless CLI runs fast mode only where its flag settings opt in.
  if (config.fast === true) options.settings = { fastMode: true };
  if (config.resume !== undefined) options.resume = config.resume;
  // The member's installed skills load as a local plugin, which leaves the checkout and the
  // settings Claude Code reads (`project` alone) as they stand; Luke holds its MCP servers.
  const manifest = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.MANIFEST);
  if (manifest !== undefined && config.installedSkills !== undefined) {
    options.plugins = [{ type: "local", path: config.installedSkills, skipMcpDiscovery: true }];
  }
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
  /** How many waits the launch has posted, so a wait's release is dropped once a newer one began. */
  readonly waits: Ref.Ref<number>;
  /** The wakeups a released wait left for Luke to deliver; none until it is released. */
  readonly released: Ref.Ref<readonly RunnerWakeup[] | undefined>;
  /** Held while a message is taken into the launch and while a wait is released, so no message lands in a launch a release ends. */
  readonly admission: Semaphore.Semaphore;
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
      const content = value.content;
      // SAFETY: a line's uuid is checked against the UUID pattern as the line is read.
      const uuid = (value.uuid as UUID | undefined) ?? randomUUID();
      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          // A launch a released wait ended takes nothing more: the line stays unaccepted, for Luke's next send to relaunch on.
          if ((yield* Ref.get(launch.released)) !== undefined) {
            return yield* Effect.logWarning(
              "agent-runner: skipped a message for a released launch",
            );
          }
          const running = yield* Ref.getAndSet(launch.turnRunning, true);
          yield* Ref.update(launch.unanswered, (sent) => new Set(sent).add(uuid));
          // Posted ahead of the hand-off, so it is numbered before anything the CLI says of the message.
          yield* launch.sink.emit({ type: RUNNER_EVENT.ACCEPTED, uuid });
          yield* Queue.offer(launch.prompts, userMessage(uuid, content, running));
        }),
      );
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
      const { model, effort, fast } = value;
      if (model !== undefined) yield* control("setModel", () => launch.session.setModel(model));
      if (effort !== undefined && !isClaudeEffort(effort)) {
        yield* Effect.logWarning("agent-runner: skipped an effort Claude Code does not take");
      }
      const settings = {
        ...(effort !== undefined && isClaudeEffort(effort) ? { effortLevel: effort } : undefined),
        ...(fast === undefined ? undefined : { fastMode: fast }),
      };
      if (Object.keys(settings).length > 0) {
        yield* control("applyFlagSettings", () => launch.session.applyFlagSettings(settings));
      }
      return;
    }
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
  // Marked before the message is posted, which may yield, and under the admission a release
  // takes, so a wait is not released once the CLI has begun a turn of its own.
  if (TURN_OUTPUT.has(message.type)) {
    yield* launch.admission.withPermit(Ref.set(launch.turnRunning, true));
  }
  yield* launch.sink.emit(message);
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
  const wait = yield* Ref.updateAndGet(launch.waits, (count) => count + 1);
  yield* Effect.forkScoped(watchWait(launch, wait, inFlight));
});

/** The wakeups a wait's one-shot tasks come due at, earliest first; none where one's time cannot be told, which holds the wait. */
function wakeupsOf(inFlight: InFlight, now: Date): RunnerWakeup[] | undefined {
  const wakeups: RunnerWakeup[] = [];
  for (const task of inFlight.session_crons) {
    if (task.recurring) continue;
    const at = oneShotDueAt(task.schedule, now);
    if (at === undefined) return undefined;
    wakeups.push({ at: at.toISOString(), prompt: task.prompt });
  }
  return wakeups.sort((one, other) => Date.parse(one.at) - Date.parse(other.at));
}

/**
 * One wait watched for its release (`RUNNER_RELEASE`): once it has lasted
 * `SETTLE_MS`, it ends the launch where nothing is in flight but scheduled
 * tasks, every one-shot's time can be told and the earliest is still that
 * far off, any recurring task's wait has outlasted `IDLE_CAP_MS`, and no
 * process of the agent's runs (`processes.ts`); and it looks again every
 * `RECHECK_MS` until a turn starts, a newer wait begins, or the earliest
 * wakeup is near enough for the CLI to fire it. A background task is the
 * agent's own process, so a wait with one is never released.
 */
const watchWait = Effect.fn("agent-runner/watchWait")(function* (
  launch: Launch,
  wait: number,
  inFlight: InFlight,
) {
  if (inFlight.background_tasks.length > 0) return;
  const processes = yield* ProcessTable;
  const startedAt = yield* Clock.currentTimeMillis;
  const wakeups = wakeupsOf(inFlight, new Date(startedAt));
  if (wakeups === undefined) return;
  const earliest = wakeups[0] === undefined ? undefined : Date.parse(wakeups[0].at);
  const recurring = inFlight.session_crons.some((task) => task.recurring);
  yield* Effect.sleep(Duration.millis(RUNNER_RELEASE.SETTLE_MS));
  for (;;) {
    const now = yield* Clock.currentTimeMillis;
    if (earliest !== undefined && earliest - now < RUNNER_RELEASE.SETTLE_MS) return;
    const held = recurring && now - startedAt < RUNNER_RELEASE.IDLE_CAP_MS;
    if (!held && !(yield* processes.agentProcessRuns)) {
      // Decided and ended under the admission, so neither a message nor a turn the CLI began
      // lands between the check and the end.
      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          const current =
            (yield* Ref.get(launch.waits)) === wait &&
            !(yield* Ref.get(launch.turnRunning)) &&
            !(yield* Ref.get(launch.stopping)) &&
            !(yield* Deferred.isDone(launch.ended));
          if (!current) return;
          yield* Ref.set(launch.released, wakeups);
          yield* Deferred.succeed(launch.ended, RUNNER_END.RELEASED);
        }),
      );
    }
    if ((yield* Ref.get(launch.waits)) !== wait || (yield* Ref.get(launch.turnRunning))) return;
    yield* Effect.sleep(Duration.millis(RUNNER_RELEASE.RECHECK_MS));
  }
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
  const servers: Record<string, McpSdkServerConfigWithInstance> = {
    [MCP_SERVER]: yield* openMcpRelay(MCP_SERVER, config.mcpUrl, bearer),
  };
  // Each integration the agent is handed is a server of its own, its tools named `mcp__<connection>__<tool>`.
  for (const integration of config.integrations ?? []) {
    if (integration.name === MCP_SERVER) continue;
    servers[integration.name] = yield* openMcpRelay(integration.name, integration.url, bearer);
  }
  const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const session = claudeCode.query({
    prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
    options: queryOptions(config, context.env, servers, onStop),
  });
  const launch: Launch = {
    session,
    prompts,
    sink,
    inFlight,
    turnRunning: yield* Ref.make(false),
    unanswered: yield* Ref.make<ReadonlySet<string>>(new Set()),
    stopping: yield* Ref.make(false),
    waits: yield* Ref.make(0),
    released: yield* Ref.make<readonly RunnerWakeup[] | undefined>(undefined),
    admission: yield* Semaphore.make(1),
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
  const wakeups = yield* Ref.get(launch.released);
  return (
    wakeups === undefined ? { end, failure } : { end, failure, wakeups }
  ) satisfies LaunchOutcome;
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
  const tokens = [RUNNER_ENV.CLAUDE_TOKEN, RUNNER_ENV.API_KEY, RUNNER_ENV.OPENAI_API_KEY].flatMap(
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
  const outcome: LaunchOutcome =
    config.harness === RUNNER_HARNESS.CODEX
      ? yield* runCodex({ ...context, config })
      : yield* runClaudeCode({ ...context, config });
  const { end, failure, wakeups } = outcome;
  const last: RunnerEndEvent = {
    type: RUNNER_EVENT.END,
    reason: end,
    ...(failure === "" ? undefined : { detail: failure }),
    ...(wakeups === undefined ? undefined : { wakeups }),
  };
  yield* sink.emit(last);
  yield* sink.drain;
  return end;
});
