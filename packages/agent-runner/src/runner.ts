import { randomUUID, type UUID } from "node:crypto";
import type {
  AgentDefinition,
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
import { ClaudeCode, type ClaudeCodeSession, type ClaudeCodeShape } from "./claude-code.js";
import { runCodex } from "./codex.js";
import { type EventSink, makeEventSink } from "./events.js";
import {
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  RunnerFailed,
  type RunnerSelf,
} from "./launch.js";
import { readLines } from "./lines.js";
import { openMcpRelay } from "./mcp-relay.js";
import { SANDBOX_TOOL_ENV } from "./pins.js";
import { ProcessTable } from "./processes.js";
import {
  CLAUDE_CODE_TOOLS,
  CLAUDE_CODE_WORKER,
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  INSTALLED_SKILLS,
  type InputLine,
  InputLineSchema,
  RUNNER_CONTROL,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_HARNESS,
  RUNNER_RELEASE,
  RUNNER_UNANSWERED,
  RUNNER_WARM,
  RunnerConfigSchema,
  type RunnerEnd,
  type RunnerEndEvent,
  type RunnerWaiting,
  type RunnerWakeup,
} from "./protocol.js";
import { oneShotDueAt } from "./wakeups.js";

const MCP_SERVER = "workspace";

const WORKER: AgentDefinition = {
  description:
    "A read-only worker for one scoped job, such as a broad search, a comparison of approaches, or an investigation: it reads the checkout and the web and answers, and never edits, commits, or pushes.",
  prompt:
    "You are a read-only worker for an agent. Do the one job you were handed and answer with what it asks for. You are read-only in the checkout: never write, edit, move, or delete a file, never commit or push; run only commands that read, and use the connected services only to read from them.",
  model: "inherit",
  disallowedTools: ["Edit", "Write", "NotebookEdit", "Agent", `mcp__${MCP_SERVER}`],
};

const CLAUDE_EFFORTS: ReadonlySet<string> = new Set(Object.values(EFFORT));

function isClaudeEffort(effort: string): effort is Effort {
  return CLAUDE_EFFORTS.has(effort);
}

type InFlight = Omit<RunnerWaiting, "type">;

export interface RunnerInput {
  readonly lines: Stream.Stream<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly self?: RunnerSelf | undefined;
}

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(RunnerConfigSchema));
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

interface ResumePoint {
  readonly resume?: string;
  readonly at?: string;
}

const resumePointOf = Effect.fn("agent-runner/resumePointOf")(function* (
  claudeCode: ClaudeCodeShape,
  config: ClaudeCodeConfig,
) {
  const { resume, rewindBefore } = config;
  if (resume === undefined) return {} satisfies ResumePoint;
  if (rewindBefore === undefined) return { resume } satisfies ResumePoint;
  const unread: readonly string[] = [];
  const chain = yield* Effect.tryPromise(() => claudeCode.sessionChain(resume, config.cwd)).pipe(
    Effect.catch(() =>
      Effect.as(Effect.logWarning("agent-runner: the session to rewind could not be read"), unread),
    ),
  );
  const cut = chain.indexOf(rewindBefore);
  if (cut === 0) return {} satisfies ResumePoint;
  const at = cut > 0 ? chain[cut - 1] : undefined;
  return at === undefined ? ({ resume } satisfies ResumePoint) : { resume, at };
});

function queryOptions(
  config: ClaudeCodeConfig,
  env: RunnerInput["env"],
  servers: Readonly<Record<string, McpSdkServerConfigWithInstance>>,
  onStop: HookCallback,
  from: ResumePoint,
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
    allowedTools: [...CLAUDE_CODE_TOOLS.ADDED],
    disallowedTools: [...CLAUDE_CODE_TOOLS.DENIED],
    agents: { [CLAUDE_CODE_WORKER]: WORKER },
    env: { ...env, ...SANDBOX_TOOL_ENV, [RUNNER_ENV.BEARER]: undefined },
    mcpServers: { ...servers },
    sandbox: { enabled: false },
    hooks: { Stop: [{ hooks: [onStop] }] },
  };
  if (config.effort !== undefined) options.effort = config.effort;
  if (config.fast === true) options.settings = { fastMode: true };
  if (from.resume !== undefined) options.resume = from.resume;
  if (from.at !== undefined) options.resumeSessionAt = from.at;
  const manifest = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.MANIFEST);
  if (manifest !== undefined && config.installedSkills !== undefined) {
    options.plugins = [{ type: "local", path: config.installedSkills, skipMcpDiscovery: true }];
  }
  return options;
}

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
    session_id: "",
  };
  if (turnRunning) message.priority = "next";
  return message;
}

interface Launch {
  readonly session: ClaudeCodeSession;
  readonly prompts: Queue.Queue<SDKUserMessage, Cause.Done>;
  readonly sink: EventSink;
  readonly inFlight: MutableRef.MutableRef<InFlight | undefined>;
  readonly turnRunning: Ref.Ref<boolean>;
  readonly unanswered: Ref.Ref<ReadonlySet<string>>;
  readonly heard: Ref.Ref<number>;
  readonly stopping: Ref.Ref<boolean>;
  readonly waits: Ref.Ref<number>;
  readonly warmable: boolean;
  readonly warm: Ref.Ref<boolean>;
  readonly released: Ref.Ref<readonly RunnerWakeup[] | undefined>;
  readonly admission: Semaphore.Semaphore;
  readonly ended: Deferred.Deferred<RunnerEnd>;
  readonly failure: Ref.Ref<string>;
  readonly firstSequence: number;
}

function control(step: string, call: () => Promise<unknown>) {
  return Effect.tryPromise(call).pipe(
    Effect.timeoutOption(Duration.millis(RUNNER_CONTROL.ANSWER_MS)),
    Effect.flatMap((answer) =>
      Option.isSome(answer)
        ? Effect.succeed(true)
        : Effect.as(Effect.logWarning(`agent-runner: ${step} went unanswered`), false),
    ),
    Effect.catch(() => Effect.as(Effect.logWarning(`agent-runner: ${step} failed`), true)),
  );
}

const takeLine = Effect.fn("agent-runner/takeLine")(function* (launch: Launch, text: string) {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    return yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
  }
  const value = line.value;
  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      const content = value.content;
      const uuid = (value.uuid as UUID | undefined) ?? randomUUID();
      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          if ((yield* Ref.get(launch.released)) !== undefined) {
            return yield* Effect.logWarning(
              "agent-runner: skipped a message for a released launch",
            );
          }
          const running = yield* Ref.getAndSet(launch.turnRunning, true);
          yield* Ref.set(launch.warm, false);
          yield* Ref.update(launch.unanswered, (sent) => new Set(sent).add(uuid));
          yield* launch.sink.emit({ type: RUNNER_EVENT.ACCEPTED, uuid });
          yield* Queue.offer(launch.prompts, userMessage(uuid, content, running));
        }),
      );
    }
    case INPUT_LINE.STOP: {
      if (value.launch !== undefined && value.launch !== launch.firstSequence) {
        return yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
      }
      if (!(yield* Ref.get(launch.turnRunning))) {
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
        return;
      }
      yield* Ref.set(launch.stopping, true);
      if (!(yield* control("interrupt", () => launch.session.interrupt()))) {
        yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
      }
      return;
    }
    case INPUT_LINE.RETIRE: {
      return yield* launch.admission.withPermit(
        Effect.gen(function* () {
          if (!(yield* stillWarm(launch))) {
            return yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");
          }
          yield* Deferred.succeed(launch.ended, RUNNER_END.IDLED);
        }),
      );
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

const SDK_MESSAGE = {
  ASSISTANT: "assistant",
  STREAM_EVENT: "stream_event",
  USER: "user",
  RESULT: "result",
} as const satisfies Record<string, SDKMessage["type"]>;

const TURN_OUTPUT: ReadonlySet<SDKMessage["type"]> = new Set([
  SDK_MESSAGE.ASSISTANT,
  SDK_MESSAGE.STREAM_EVENT,
  SDK_MESSAGE.USER,
]);

type SdkResult = Extract<SDKMessage, { type: typeof SDK_MESSAGE.RESULT }>;

function promptsOf(result: SdkResult): readonly string[] | undefined {
  return (
    result.user_message_uuids ??
    (result.user_message_uuid === undefined ? undefined : [result.user_message_uuid])
  );
}

function stillUnanswered(sent: ReadonlySet<string>, result: SdkResult): ReadonlySet<string> {
  const left = new Set(sent);
  for (const uuid of promptsOf(result) ?? []) left.delete(uuid);
  return left;
}

const takeMessage = Effect.fn("agent-runner/takeMessage")(function* (
  launch: Launch,
  message: SDKMessage,
) {
  if (TURN_OUTPUT.has(message.type)) {
    yield* launch.admission.withPermit(
      Ref.set(launch.turnRunning, true).pipe(
        Effect.andThen(Ref.set(launch.warm, false)),
        Effect.andThen(Ref.update(launch.heard, (count) => count + 1)),
      ),
    );
  }
  yield* launch.sink.emit(message);
  if (message.type !== SDK_MESSAGE.RESULT) return;
  const inFlight = MutableRef.getAndSet(launch.inFlight, undefined);
  if (yield* Ref.get(launch.stopping)) {
    return yield* Deferred.succeed(launch.ended, RUNNER_END.STOPPED);
  }
  const left = stillUnanswered(yield* Ref.get(launch.unanswered), message);
  yield* Ref.set(launch.unanswered, left);
  if (left.size > 0) {
    if (promptsOf(message) === undefined) {
      yield* Effect.forkScoped(watchUnheard(launch, left, yield* Ref.get(launch.heard)));
    }
    return;
  }
  const waiting =
    inFlight !== undefined &&
    (inFlight.background_tasks.length > 0 || inFlight.session_crons.length > 0);
  if (inFlight === undefined) return yield* Deferred.succeed(launch.ended, RUNNER_END.TURN_ENDED);
  if (!waiting) {
    return launch.warmable
      ? yield* warmed(launch)
      : yield* Deferred.succeed(launch.ended, RUNNER_END.TURN_ENDED);
  }
  yield* Ref.set(launch.turnRunning, false);
  yield* launch.sink.emit({ type: RUNNER_EVENT.WAITING, ...inFlight });
  const wait = yield* Ref.updateAndGet(launch.waits, (count) => count + 1);
  yield* Effect.forkScoped(watchWait(launch, wait, inFlight));
});

const stillWarm = Effect.fn("agent-runner/stillWarm")(function* (launch: Launch) {
  return (
    (yield* Ref.get(launch.warm)) &&
    !(yield* Ref.get(launch.turnRunning)) &&
    (yield* Ref.get(launch.unanswered)).size === 0 &&
    !(yield* Ref.get(launch.stopping)) &&
    !(yield* Deferred.isDone(launch.ended))
  );
});

const warmed = Effect.fn("agent-runner/warmed")(function* (launch: Launch) {
  const wait = yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.unanswered)).size > 0) return undefined;
      yield* Ref.set(launch.turnRunning, false);
      yield* Ref.set(launch.warm, true);
      yield* launch.sink.emit({ type: RUNNER_EVENT.IDLE });
      return yield* Ref.updateAndGet(launch.waits, (count) => count + 1);
    }),
  );
  if (wait === undefined) return;
  yield* Effect.forkScoped(watchWarm(launch, wait));
});

const watchWarm = Effect.fn("agent-runner/watchWarm")(function* (launch: Launch, wait: number) {
  yield* Effect.sleep(Duration.millis(RUNNER_WARM.IDLE_CAP_MS));
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.waits)) !== wait || !(yield* stillWarm(launch))) return;
      yield* Deferred.succeed(launch.ended, RUNNER_END.IDLED);
    }),
  );
});

const UNHEARD_FAILURE = "the CLI never took up a message a result left";

function endFailed(launch: Launch, failure: string) {
  return Effect.gen(function* () {
    if (yield* Deferred.isDone(launch.ended)) return;
    yield* Ref.set(launch.failure, failure);
    yield* Deferred.succeed(launch.ended, RUNNER_END.FAILED);
  });
}

const watchUnheard = Effect.fn("agent-runner/watchUnheard")(function* (
  launch: Launch,
  held: ReadonlySet<string>,
  heardAt: number,
) {
  yield* Effect.sleep(Duration.millis(RUNNER_UNANSWERED.SILENCE_MS));
  yield* launch.admission.withPermit(
    Effect.gen(function* () {
      if ((yield* Ref.get(launch.heard)) !== heardAt) return;
      const unanswered = yield* Ref.get(launch.unanswered);
      if (![...held].some((uuid) => unanswered.has(uuid))) return;
      yield* Effect.logWarning(`agent-runner: ${UNHEARD_FAILURE}`);
      yield* endFailed(launch, UNHEARD_FAILURE);
    }),
  );
});

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
  for (const integration of config.integrations ?? []) {
    if (integration.name === MCP_SERVER) continue;
    servers[integration.name] = yield* openMcpRelay(integration.name, integration.url, bearer);
  }
  const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const from = yield* resumePointOf(claudeCode, config);
  const session = claudeCode.query({
    prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
    options: queryOptions(config, context.env, servers, onStop, from),
  });
  const launch: Launch = {
    session,
    prompts,
    sink,
    inFlight,
    turnRunning: yield* Ref.make(false),
    unanswered: yield* Ref.make<ReadonlySet<string>>(new Set()),
    heard: yield* Ref.make(0),
    stopping: yield* Ref.make(false),
    waits: yield* Ref.make(0),
    warmable: config.warm === true,
    warm: yield* Ref.make(false),
    released: yield* Ref.make<readonly RunnerWakeup[] | undefined>(undefined),
    admission: yield* Semaphore.make(1),
    ended: yield* Deferred.make<RunnerEnd>(),
    failure: yield* Ref.make(""),
    firstSequence: config.firstSequence,
  };

  const inputLoop = Effect.gen(function* () {
    for (;;) yield* takeLine(launch, yield* Queue.take(lines));
  }).pipe(
    Effect.catchIf(Cause.isDone, () => Queue.end(prompts)),
    Effect.asVoid,
  );
  const outputLoop = Stream.fromAsyncIterable(session, (cause) => cause).pipe(
    Stream.runForEach((message) => takeMessage(launch, message)),
    Effect.matchEffect({
      onSuccess: () => Deferred.succeed(launch.ended, RUNNER_END.INPUT_CLOSED),
      onFailure: (cause) =>
        endFailed(launch, cause instanceof Error ? cause.message : String(cause)),
    }),
  );
  const reading = [
    yield* Effect.forkScoped(inputLoop),
    yield* sink.undelivered.pipe(
      Effect.andThen(Deferred.succeed(launch.ended, RUNNER_END.FAILED)),
      Effect.forkScoped,
    ),
  ];
  const posting = yield* Effect.forkScoped(outputLoop);

  const end = yield* Deferred.await(launch.ended);
  yield* Fiber.interruptAll(reading);
  session.close();
  yield* Fiber.interrupt(posting);
  const wakeups = yield* Ref.get(launch.released);
  const failure = yield* Ref.get(launch.failure);
  return (
    wakeups === undefined ? { end, failure } : { end, failure, wakeups }
  ) satisfies LaunchOutcome;
});

export const runAgent = Effect.fn("agent-runner/runAgent")(function* (input: RunnerInput) {
  const bearerValue = input.env[RUNNER_ENV.BEARER];
  if (bearerValue === undefined || bearerValue === "") {
    return yield* new RunnerFailed({ detail: `${RUNNER_ENV.BEARER} is not set` });
  }
  const bearer = Redacted.make(bearerValue);
  const tokens = [
    RUNNER_ENV.CLAUDE_TOKEN,
    RUNNER_ENV.API_KEY,
    RUNNER_ENV.OPENAI_API_KEY,
    RUNNER_ENV.CODEX_TOKEN,
  ].flatMap((name) => {
    const value = input.env[name];
    return value === undefined || value === "" ? [] : [Redacted.make(value)];
  });
  const secrets = [bearer, ...tokens];

  const lines = yield* Queue.unbounded<string, Cause.Done>();
  const readsLines = yield* Deferred.make<boolean>();
  const read = yield* Ref.make(0);
  yield* input.lines.pipe(
    Stream.runForEach((text) =>
      Effect.andThen(
        Ref.update(read, (count) => count + 1),
        Queue.offer(lines, text),
      ),
    ),
    Effect.andThen(Ref.get(read)),
    Effect.flatMap((count) => (count === 0 ? Effect.succeed(false) : Deferred.await(readsLines))),
    Effect.flatMap((reads) => (reads ? Effect.void : Queue.end(lines))),
    Effect.forkScoped,
  );
  const first = yield* Queue.take(lines).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "stdin closed before the config line" })),
  );
  const config = yield* decodeConfig(first).pipe(
    Effect.mapError(() => new RunnerFailed({ detail: "the config line is not a runner config" })),
  );
  yield* Deferred.succeed(readsLines, config.linesUrl !== undefined);

  const sink = yield* makeEventSink({
    url: config.eventsUrl,
    bearer,
    firstSequence: config.firstSequence,
    secrets,
  });
  if (config.linesUrl !== undefined) {
    const read = { url: config.linesUrl, bearer, launch: config.firstSequence };
    yield* Effect.forkScoped(readLines(read, lines));
  }
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
  yield* end === RUNNER_END.STOPPED ? sink.drainStopped : sink.drain;
  return end;
});
