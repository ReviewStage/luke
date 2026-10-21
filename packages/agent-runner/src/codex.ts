/**
 * codex.ts -- one launch of Codex for a Luke agent: `codex app-server` spawned with the ChatGPT plan's provider, the thread started or resumed, Luke's lines turned into turns, steers, interrupts and restarts, every notification posted out, and the launch ended when the agent's turn is.
 *
 * One controller fiber owns the launch's state and acts on one signal at a
 * time: a line Luke wrote, or what app-server reported (a message a turn
 * took, a turn completed, the process gone). Notifications are posted by the
 * reader as Codex writes them, so their order is Codex's own; the controller
 * only decides. A request it sends is awaited where it is sent, and whatever
 * app-server reports meanwhile waits its turn in the signal queue, so a
 * steered message is always recorded as sent before the notification that
 * says the turn took it.
 *
 * When the launch ends (Codex's end-of-run rule). A launch ends at the
 * `turn/completed` of the turn it is running, on its own thread, once no
 * message Luke sent is left unanswered. Each `turn/start` and `turn/steer`
 * carries a `clientUserMessageId`, which Codex echoes as the `clientId` of
 * the `userMessage` item a turn takes it in, and which is Luke's own id for
 * the line where a message goes alone. As app-server takes a line (its
 * `turn/start` or `turn/steer` answered), the launch posts ACCEPTED naming
 * the line, as Claude Code's launch does, once for each line a merged turn
 * carries; a message no such item has
 * named by the turn's end (a steer the turn accepted too late to take, one
 * app-server refused because the turn had just ended, one that arrived in
 * between) is sent again, merged into one, as the next turn of the same
 * launch, which ends at that turn's completion by the same rule. Codex's
 * turn holds its own waits (its unified exec polls a long command inside the
 * turn, as P16 found), so nothing outlives `turn/completed` the way Claude
 * Code's background work outlives a `result`. A completed turn ends the
 * launch as `turn_ended`; one interrupted after Luke's stop as `stopped`; a
 * failed turn, or one interrupted without a stop, as `failed`, with the
 * turn's error, so it shows as interrupted and Continue resumes the thread. A
 * stop with no turn running ends the launch at once; so does stdin closing
 * with none, while one running is let finish. App-server exiting, or Luke
 * refusing the events, ends it as `failed`.
 *
 * Tokens. App-server reads the plan's access token from its environment once,
 * as it starts, so a refreshed token (a token line) is taken by restarting
 * app-server with it and resuming the thread, which OpenAI documents as the
 * renewal. The restart happens only between turns: just before the next
 * `turn/start` this launch sends, never during a turn. Every token the launch
 * holds is withheld from every event it posts.
 */

import { randomUUID } from "node:crypto";
import { Effect, Exit, Option, Queue, Redacted, Schema, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AppServer,
  AppServerError,
  type AppServerListener,
  spawnAppServer,
} from "./app-server.js";
import type { ThreadStartParams, TurnStatus, UserInput } from "./codex-protocol/v2/index.js";
import type { LaunchContext, LaunchOutcome } from "./launch.js";
import {
  CODEX_EFFORT,
  type CodexConfig,
  type CodexEffort,
  type ContentBlock,
  INPUT_LINE,
  InputLineSchema,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  type RunnerEnd,
} from "./protocol.js";

/**
 * OpenAI's documented provider for a ChatGPT plan's token
 * (developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
 */
const CHATGPT_PROVIDER = {
  ID: "openai_chatgpt_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://api.openai.com/v1",
} as const;

/** The name the Luke MCP server is registered under in Codex's config. */
const MCP_SERVER = "luke";

/**
 * Who the runner tells app-server it is. OpenAI asks that the name match the
 * `agent_name_hint` the sign-in sent, which is `Luke`. The version is the
 * package's, which the bundle's build writes in (`--define`); an unbundled
 * runner, such as the tests', says `dev`.
 */
const CLIENT_INFO = {
  name: "Luke",
  title: "Luke",
  version: process.env.LUKE_RUNNER_VERSION ?? "dev",
} as const;

/** The JSON-RPC methods the runner sends, and the notifications it acts on. */
const METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
  TURN_INTERRUPT: "turn/interrupt",
  TURN_COMPLETED: "turn/completed",
  ITEM_STARTED: "item/started",
} as const;

/** What the controller acts on, one at a time. */
const SIGNAL = {
  LINE: "line",
  INPUT_CLOSED: "input_closed",
  MESSAGE_TAKEN: "message_taken",
  TURN_COMPLETED: "turn_completed",
  EXITED: "exited",
  UNDELIVERED: "undelivered",
} as const;

type Signal =
  | { readonly kind: typeof SIGNAL.LINE; readonly text: string }
  | { readonly kind: typeof SIGNAL.INPUT_CLOSED }
  | { readonly kind: typeof SIGNAL.MESSAGE_TAKEN; readonly clientId: string }
  | {
      readonly kind: typeof SIGNAL.TURN_COMPLETED;
      readonly turnId: string;
      readonly status: TurnStatus;
      readonly error: string | undefined;
    }
  | { readonly kind: typeof SIGNAL.EXITED; readonly stderrTail: string }
  | { readonly kind: typeof SIGNAL.UNDELIVERED };

/**
 * A message Luke sent, as Codex takes it, under the id Codex echoes when a
 * turn takes it: Luke's own id for the line where it goes alone. `lines` are
 * the ids of Luke's lines it carries, one for a line, several for a merged
 * next turn.
 */
interface Outgoing {
  readonly clientId: string;
  readonly input: readonly UserInput[];
  readonly lines: readonly string[];
}

/** The fields of an answer the controller reads. */
const ThreadAnswerSchema = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) });
const TurnAnswerSchema = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) });
const decodeThreadAnswer = Schema.decodeUnknownOption(ThreadAnswerSchema);
const decodeTurnAnswer = Schema.decodeUnknownOption(TurnAnswerSchema);
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));

const CODEX_EFFORTS: ReadonlySet<string> = new Set(Object.values(CODEX_EFFORT));

/** Whether a model line's effort is one Codex takes. */
function isCodexEffort(effort: string): effort is CodexEffort {
  return CODEX_EFFORTS.has(effort);
}

/** A TOML basic string, as Codex's `-c key=value` reads one. */
function toml(value: string): string {
  return JSON.stringify(value);
}

/**
 * App-server's argv: the documented ChatGPT-plan provider, the Luke MCP
 * server with its bearer read from the environment and its tools approved up
 * front (under `approval_policy = "never"` Codex 0.163.0 otherwise fails
 * every MCP call, as P16 found), the sandbox with network on, and commands
 * inheriting the core variables without the token or the bearer. Nothing in
 * argv is secret.
 */
function appServerArgs(config: CodexConfig): string[] {
  const provider = `model_providers.${CHATGPT_PROVIDER.ID}`;
  const mcp = `mcp_servers.${MCP_SERVER}`;
  const overrides: (readonly [string, string])[] = [
    ["model_provider", toml(CHATGPT_PROVIDER.ID)],
    [`${provider}.name`, toml(CHATGPT_PROVIDER.NAME)],
    [`${provider}.base_url`, toml(CHATGPT_PROVIDER.BASE_URL)],
    [`${provider}.env_key`, toml(RUNNER_ENV.CODEX_TOKEN)],
    [`${provider}.wire_api`, toml("responses")],
    [`${provider}.requires_openai_auth`, "false"],
    [`${provider}.supports_websockets`, "false"],
    [`${mcp}.url`, toml(config.mcpUrl)],
    [`${mcp}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
    [`${mcp}.default_tools_approval_mode`, toml("approve")],
    ["approval_policy", toml("never")],
    ["sandbox_mode", toml("workspace-write")],
    ["sandbox_workspace_write.network_access", "true"],
    ["shell_environment_policy.inherit", toml("core")],
    ["shell_environment_policy.ignore_default_excludes", "false"],
    [
      "shell_environment_policy.exclude",
      `[${toml(RUNNER_ENV.CODEX_TOKEN)}, ${toml(RUNNER_ENV.BEARER)}]`,
    ],
  ];
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...overrides.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
  ];
}

/** A message line's blocks as Codex's `UserInput`: text as text, a base64 image as a data URL. */
function userInput(content: readonly ContentBlock[]): UserInput[] {
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text, text_elements: [] }
      : { type: "image", url: `data:${block.source.media_type};base64,${block.source.data}` },
  );
}

/** The launch's state, owned by the controller alone. */
interface CodexLaunch {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  server: AppServer;
  serverScope: Scope.Closeable;
  threadId: string;
  /** The turn this launch is running on its thread, once app-server named it. */
  turnId: string | undefined;
  /** Messages a turn was handed and has not yet taken, by the id Codex echoes. */
  readonly sent: Map<string, Outgoing>;
  /** Messages for the next turn. */
  waiting: Outgoing[];
  /** Luke's lines this launch has said app-server took, each said once. */
  readonly accepted: Set<string>;
  /** A refreshed token, taken by a restart before the next turn starts. */
  nextToken: string | undefined;
  model: string;
  effort: CodexEffort | undefined;
  stopping: boolean;
}

/** Ends the launch: the outcome the controller's loop stops on. */
function ended(end: RunnerEnd, failure = ""): LaunchOutcome {
  return { end, failure };
}

/** Where the listener reads the launch's thread from: known once the thread is open, or given to resume. */
interface ThreadSeen {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  threadId: string | undefined;
}

/** What app-server reports, posted in order and turned into the controller's signals. */
function listenerFor(seen: ThreadSeen): AppServerListener {
  return {
    onNotification: (notification) =>
      Effect.gen(function* () {
        yield* seen.context.sink.emit(notification);
        if (notification.method === METHOD.TURN_COMPLETED) {
          const { threadId, turn } = notification.params;
          if (threadId !== seen.threadId) return;
          yield* Queue.offer(seen.signals, {
            kind: SIGNAL.TURN_COMPLETED,
            turnId: turn.id,
            status: turn.status,
            error: turn.error?.message,
          });
          return;
        }
        if (notification.method !== METHOD.ITEM_STARTED) return;
        const { threadId, item } = notification.params;
        if (threadId !== seen.threadId || item.type !== "userMessage" || item.clientId === null) {
          return;
        }
        yield* Queue.offer(seen.signals, { kind: SIGNAL.MESSAGE_TAKEN, clientId: item.clientId });
      }),
    onExit: (stderrTail) =>
      Queue.offer(seen.signals, { kind: SIGNAL.EXITED, stderrTail }).pipe(Effect.asVoid),
  };
}

/**
 * Starts app-server in a scope of its own and opens the thread on it:
 * `thread/resume` where there is a thread to continue, `thread/start`
 * otherwise. Answers the server, its scope, and the thread's id.
 */
const openAppServer = Effect.fn("agent-runner/openAppServer")(function* (
  launch: Pick<CodexLaunch, "context" | "signals" | "model">,
  token: string,
  threadId: string | undefined,
) {
  const { config, env } = launch.context;
  const serverScope = yield* Scope.make();
  // Note that the listener reads the thread's id from here, because a new
  // thread's notifications arrive before `thread/start` answers.
  const seen: ThreadSeen = { context: launch.context, signals: launch.signals, threadId };
  const server = yield* spawnAppServer(
    {
      executable: config.executable,
      args: appServerArgs(config),
      cwd: config.cwd,
      // Note that Claude Code's token, were it set, is no business of Codex's.
      env: { ...env, [RUNNER_ENV.CLAUDE_TOKEN]: undefined, [RUNNER_ENV.CODEX_TOKEN]: token },
    },
    listenerFor(seen),
  ).pipe(Scope.provide(serverScope));
  const opened = Effect.gen(function* () {
    yield* server.request(METHOD.INITIALIZE, { clientInfo: CLIENT_INFO, capabilities: null });
    yield* server.notify(METHOD.INITIALIZED);
    const thread = {
      cwd: config.cwd,
      model: launch.model,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      developerInstructions: config.developerInstructions,
    } satisfies ThreadStartParams;
    const answer =
      threadId === undefined
        ? yield* server.request(METHOD.THREAD_START, thread)
        : yield* server.request(METHOD.THREAD_RESUME, { ...thread, threadId, excludeTurns: true });
    const opened = decodeThreadAnswer(answer);
    if (Option.isNone(opened)) {
      return yield* new AppServerError({
        method: METHOD.THREAD_START,
        detail: "no thread in the answer",
      });
    }
    seen.threadId = opened.value.thread.id;
    return opened.value.thread.id;
  });
  const openedThread = yield* opened.pipe(
    Effect.tapError(() => Scope.close(serverScope, Exit.void)),
  );
  return { server, serverScope, threadId: openedThread };
});

/** Restarts app-server with the refreshed token and resumes the thread, between turns. */
const restart = Effect.fn("agent-runner/restart")(function* (launch: CodexLaunch, token: string) {
  yield* Scope.close(launch.serverScope, Exit.void);
  const reopened = yield* openAppServer(launch, token, launch.threadId);
  launch.server = reopened.server;
  launch.serverScope = reopened.serverScope;
  launch.nextToken = undefined;
});

/**
 * Says each of Luke's lines a message carries was taken by app-server, as
 * Claude Code's launch says a line was handed to the SDK, so Luke ties the
 * line to the turn that runs it. A line said once is not said again when a
 * message is sent again in the next turn.
 */
const accepted = Effect.fn("agent-runner/codex/accepted")(function* (
  launch: CodexLaunch,
  outgoing: Outgoing,
) {
  for (const uuid of outgoing.lines) {
    if (launch.accepted.has(uuid)) continue;
    launch.accepted.add(uuid);
    yield* launch.context.sink.emit({ type: RUNNER_EVENT.ACCEPTED, uuid });
  }
});

/** Starts the next turn with the messages given, merged into one, restarting first for a refreshed token. */
const startTurn = Effect.fn("agent-runner/startTurn")(function* (
  launch: CodexLaunch,
  messages: readonly Outgoing[],
) {
  if (launch.nextToken !== undefined) yield* restart(launch, launch.nextToken);
  const outgoing: Outgoing =
    messages.length === 1 && messages[0] !== undefined
      ? messages[0]
      : {
          clientId: randomUUID(),
          input: messages.flatMap((message) => message.input),
          lines: messages.flatMap((message) => message.lines),
        };
  const answer = decodeTurnAnswer(
    yield* launch.server.request(METHOD.TURN_START, {
      threadId: launch.threadId,
      clientUserMessageId: outgoing.clientId,
      input: [...outgoing.input],
      model: launch.model,
      effort: launch.effort ?? null,
    }),
  );
  if (Option.isNone(answer)) {
    return yield* new AppServerError({
      method: METHOD.TURN_START,
      detail: "no turn in the answer",
    });
  }
  launch.turnId = answer.value.turn.id;
  launch.sent.set(outgoing.clientId, outgoing);
  yield* accepted(launch, outgoing);
});

/** One of Luke's lines, acted on; answers the launch's outcome where the line ends it. */
const takeLine = Effect.fn("agent-runner/codex/takeLine")(function* (
  launch: CodexLaunch,
  text: string,
) {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    // Note that we never echo the line: a message carries the user's words, a token line a secret.
    yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
    return undefined;
  }
  const value = line.value;
  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      // Note that Luke's id for the line is the id Codex echoes, so a turn that takes it names it.
      const uuid = value.uuid ?? randomUUID();
      const outgoing: Outgoing = { clientId: uuid, input: userInput(value.content), lines: [uuid] };
      if (launch.turnId === undefined) {
        yield* startTurn(launch, [outgoing]);
        return undefined;
      }
      // A steer app-server refuses (the turn has just ended) waits for the next turn.
      const steered = yield* launch.server
        .request(METHOD.TURN_STEER, {
          threadId: launch.threadId,
          expectedTurnId: launch.turnId,
          clientUserMessageId: outgoing.clientId,
          input: [...outgoing.input],
        })
        .pipe(Effect.option);
      if (Option.isNone(steered)) {
        launch.waiting.push(outgoing);
        return undefined;
      }
      launch.sent.set(outgoing.clientId, outgoing);
      yield* accepted(launch, outgoing);
      return undefined;
    }
    case INPUT_LINE.STOP: {
      if (launch.turnId === undefined) return ended(RUNNER_END.STOPPED);
      launch.stopping = true;
      yield* launch.server
        .request(METHOD.TURN_INTERRUPT, { threadId: launch.threadId, turnId: launch.turnId })
        .pipe(Effect.catch(() => Effect.logWarning("agent-runner: turn/interrupt failed")));
      return undefined;
    }
    case INPUT_LINE.MODEL: {
      if (value.model !== undefined) launch.model = value.model;
      if (value.effort !== undefined && isCodexEffort(value.effort)) launch.effort = value.effort;
      else if (value.effort !== undefined) {
        yield* Effect.logWarning("agent-runner: skipped an effort Codex does not take");
      }
      return undefined;
    }
    case INPUT_LINE.TOKEN: {
      yield* launch.context.sink.withhold(Redacted.make(value.accessToken));
      launch.nextToken = value.accessToken;
      return undefined;
    }
  }
});

/** The turn this launch ran completed: the launch ends, or its unanswered messages start the next turn. */
const takeTurnCompleted = Effect.fn("agent-runner/codex/takeTurnCompleted")(function* (
  launch: CodexLaunch,
  signal: Extract<Signal, { kind: typeof SIGNAL.TURN_COMPLETED }>,
) {
  if (signal.turnId !== launch.turnId) return undefined;
  launch.turnId = undefined;
  if (launch.stopping) return ended(RUNNER_END.STOPPED);
  if (signal.status === "failed")
    return ended(RUNNER_END.FAILED, signal.error ?? "the turn failed");
  if (signal.status === "interrupted") {
    return ended(RUNNER_END.FAILED, signal.error ?? "the turn was interrupted");
  }
  const unanswered = [...launch.sent.values(), ...launch.waiting];
  launch.sent.clear();
  launch.waiting = [];
  if (unanswered.length > 0) {
    yield* startTurn(launch, unanswered);
    return undefined;
  }
  // What Luke wrote before the turn completed, still queued behind the
  // completion, is acted on before the launch is called over, so a
  // follow-up already sent starts the next turn rather than being dropped.
  for (;;) {
    const queued = yield* Queue.poll(launch.signals);
    if (Option.isNone(queued)) break;
    const done = yield* takeSignal(launch, queued.value);
    if (done !== undefined) return done;
  }
  return launch.turnId === undefined ? ended(RUNNER_END.TURN_ENDED) : undefined;
});

/** One signal, acted on; answers the launch's outcome where it ends the launch. */
function takeSignal(
  launch: CodexLaunch,
  signal: Signal,
): Effect.Effect<
  LaunchOutcome | undefined,
  AppServerError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  switch (signal.kind) {
    case SIGNAL.LINE:
      return takeLine(launch, signal.text);
    case SIGNAL.INPUT_CLOSED: {
      // A turn still running is let finish; the launch ends with it.
      const idle = launch.turnId === undefined && launch.waiting.length === 0;
      return Effect.succeed(idle ? ended(RUNNER_END.INPUT_CLOSED) : undefined);
    }
    case SIGNAL.MESSAGE_TAKEN:
      launch.sent.delete(signal.clientId);
      return Effect.succeed(undefined);
    case SIGNAL.TURN_COMPLETED:
      return takeTurnCompleted(launch, signal);
    case SIGNAL.EXITED:
      return Effect.succeed(
        ended(RUNNER_END.FAILED, `app-server exited: ${signal.stderrTail.trim()}`.trim()),
      );
    case SIGNAL.UNDELIVERED:
      return Effect.succeed(ended(RUNNER_END.FAILED));
  }
}

/**
 * One Codex launch, from its config to the moment app-server is ended.
 * Answers why it ended, and the failure where it failed.
 */
export const runCodex = Effect.fn("agent-runner/runCodex")(function* (
  context: LaunchContext<CodexConfig>,
) {
  const { config, sink } = context;
  const token = context.env[RUNNER_ENV.CODEX_TOKEN];
  if (token === undefined || token === "") {
    return ended(RUNNER_END.FAILED, `${RUNNER_ENV.CODEX_TOKEN} is not set`);
  }
  const signals = yield* Queue.unbounded<Signal>();
  yield* sink.undelivered.pipe(
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.UNDELIVERED })),
    Effect.forkScoped,
  );
  const opened = yield* openAppServer(
    { context, signals, model: config.model },
    token,
    config.threadId,
  ).pipe(Effect.result);
  if (opened._tag === "Failure") {
    return ended(RUNNER_END.FAILED, `${opened.failure.method}: ${opened.failure.detail}`);
  }
  const launch: CodexLaunch = {
    context,
    signals,
    ...opened.success,
    turnId: undefined,
    sent: new Map(),
    waiting: [],
    accepted: new Set(),
    nextToken: undefined,
    model: config.model,
    effort: config.effort,
    stopping: false,
  };

  // Luke's lines join the signals in a loop of their own, so a line is
  // never held up behind what the controller is waiting on.
  yield* Stream.fromQueue(context.lines).pipe(
    Stream.runForEach((text) => Queue.offer(signals, { kind: SIGNAL.LINE, text })),
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.INPUT_CLOSED })),
    Effect.forkScoped,
  );
  const outcome = yield* Effect.gen(function* () {
    for (;;) {
      const done = yield* takeSignal(launch, yield* Queue.take(signals));
      if (done !== undefined) return done;
    }
  }).pipe(
    Effect.catch((error: AppServerError) =>
      Effect.succeed(ended(RUNNER_END.FAILED, `${error.method}: ${error.detail}`)),
    ),
  );
  // App-server ends before the launch's last event, so nothing it emits on
  // the way down is numbered after it.
  yield* Scope.close(launch.serverScope, Exit.void);
  return outcome;
});
