import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Duration, Effect, Exit, Option, Queue, Schema, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AppServer,
  AppServerError,
  type AppServerListener,
  spawnAppServer,
} from "./app-server.js";
import { CODEX_BUNDLED_MODELS_JSON } from "./codex-protocol/bundled-models.js";
import type {
  SandboxPolicy,
  ThreadStartParams,
  TurnStatus,
  UserInput,
} from "./codex-protocol/v2/index.js";
import {
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  type RunnerSelf,
  runsOnHost,
} from "./launch.js";
import { CODEX_PIN, SANDBOX_TOOL_ENV } from "./pins.js";
import {
  CODEX_EFFORT,
  CODEX_ERROR_INFO,
  CODEX_PLAN_BACKEND,
  CODEX_TOKEN_COMMAND,
  type CodexConfig,
  type CodexEffort,
  type CodexPlanBackend,
  type ContentBlock,
  codexErrorKind,
  INPUT_LINE,
  INSTALLED_SKILLS,
  InputLineSchema,
  RUNNER_END,
  RUNNER_ENV,
  RUNNER_EVENT,
  RUNNER_WARM,
  type RunnerEnd,
} from "./protocol.js";

const CHATGPT_PROVIDER = {
  ID: "openai_chatgpt_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://api.openai.com/v1",
} as const;

const CHATGPT_BACKEND_PROVIDER = {
  ID: "chatgpt_backend_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://chatgpt.com/backend-api/codex",
  HEADER: { ACCOUNT: "ChatGPT-Account-ID", VERSION: "version" },
} as const;

const TOKEN_COMMAND = {
  TIMEOUT_MS: 30_000,
  REFRESH_INTERVAL_MS: 300_000,
} as const;

const MCP_SERVER = "workspace";

const MCP_TOOL_TIMEOUT_SECONDS = 600;

const INTEGRATION_STARTUP_TIMEOUT_SECONDS = 20;

const CLIENT_INFO = {
  name: "Vespin",
  title: "Vespin",
  version: process.env.APP_RUNNER_VERSION ?? "dev",
} as const;

const METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  SKILLS_EXTRA_ROOTS_SET: "skills/extraRoots/set",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_TURNS_LIST: "thread/turns/list",
  THREAD_REVERT: "thread/revert",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
  TURN_INTERRUPT: "turn/interrupt",
  TURN_COMPLETED: "turn/completed",
  ITEM_STARTED: "item/started",
} as const;

const INVALID_REQUEST = -32600;

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

interface Outgoing {
  readonly clientId: string;
  readonly input: readonly UserInput[];
  readonly lines: readonly string[];
}

const ThreadAnswerSchema = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) });
const TurnAnswerSchema = Schema.Struct({ turn: Schema.Struct({ id: Schema.String }) });
const TurnsPageSchema = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      items: Schema.Array(
        Schema.Struct({
          type: Schema.String,
          clientId: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});
const decodeThreadAnswer = Schema.decodeUnknownOption(ThreadAnswerSchema);
const decodeTurnsPage = Schema.decodeUnknownOption(TurnsPageSchema);
const decodeTurnAnswer = Schema.decodeUnknownOption(TurnAnswerSchema);
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));
const decodeRefusalData = Schema.decodeUnknownOption(
  Schema.Struct({ codexErrorInfo: Schema.optionalKey(Schema.NullOr(Schema.Unknown)) }),
);

const CODEX_EFFORTS: ReadonlySet<string> = new Set(Object.values(CODEX_EFFORT));

function isCodexEffort(effort: string): effort is CodexEffort {
  return CODEX_EFFORTS.has(effort);
}

function toml(value: string): string {
  return JSON.stringify(value);
}

interface TokenCommand {
  readonly self: RunnerSelf;
  readonly tokenUrl: string;
}

const SERVICE_TIER = {
  FAST: "fast",
  ULTRAFAST: "ultrafast",
} as const;

type ServiceTier = (typeof SERVICE_TIER)[keyof typeof SERVICE_TIER];

const ULTRAFAST_CATALOG_TIER = {
  id: SERVICE_TIER.ULTRAFAST,
  name: "Ultrafast",
  description: "Fastest speed, highest usage",
} as const;

const CATALOG_FILE = { PREFIX: "vespin-codex-", NAME: "models.json" } as const;

function serviceTierOf(
  fast: boolean | undefined,
  ultrafast: boolean | undefined,
): ServiceTier | null {
  if (ultrafast === true) return SERVICE_TIER.ULTRAFAST;
  return fast === true ? SERVICE_TIER.FAST : null;
}

const CatalogSchema = Schema.Struct({
  models: Schema.Array(
    Schema.StructWithRest(
      Schema.Struct({ service_tiers: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
});

function bundledCatalog() {
  return Schema.decodeUnknownSync(CatalogSchema)(JSON.parse(CODEX_BUNDLED_MODELS_JSON));
}

function ultrafastCatalog(): string {
  const catalog = bundledCatalog();
  const isUltrafast = (tier: unknown) =>
    typeof tier === "object" && tier !== null && "id" in tier && tier.id === SERVICE_TIER.ULTRAFAST;
  const models = catalog.models.map((model) => {
    const tiers = model.service_tiers ?? [];
    return tiers.some(isUltrafast)
      ? model
      : { ...model, service_tiers: [...tiers, ULTRAFAST_CATALOG_TIER] };
  });
  return JSON.stringify({ ...catalog, models });
}

function planCatalog(): string {
  const catalog = bundledCatalog();
  const models = catalog.models.map((model) =>
    Object.fromEntries(Object.entries(model).filter(([key]) => key !== "multi_agent_version")),
  );
  return JSON.stringify({ ...catalog, models });
}

const catalogFile = (catalog: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const folder = mkdtempSync(join(tmpdir(), CATALOG_FILE.PREFIX));
      const file = join(folder, CATALOG_FILE.NAME);
      writeFileSync(file, catalog);
      return { folder, file };
    }),
    ({ folder }) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
  ).pipe(Effect.map(({ file }) => file));

const API_KEY_PROVIDER = {
  ID: "openai_api_key",
  NAME: "OpenAI API key",
} as const;

const CODEX_AUTH = {
  TOKEN_COMMAND: "token_command",
  API_KEY: "api_key",
} as const;

type CodexAuth = (
  | {
      readonly kind: typeof CODEX_AUTH.TOKEN_COMMAND;
      readonly command: TokenCommand;
      readonly backend: CodexPlanBackend;
      readonly chatgptAccountId: string | undefined;
    }
  | { readonly kind: typeof CODEX_AUTH.API_KEY }
) & {
  readonly catalog: string;
};

function backendHeaders(auth: CodexAuth): string | undefined {
  if (auth.kind !== CODEX_AUTH.TOKEN_COMMAND || auth.backend !== CODEX_PLAN_BACKEND.CHATGPT) {
    return undefined;
  }
  const { HEADER } = CHATGPT_BACKEND_PROVIDER;
  const headers: (readonly [string, string])[] = [
    ...(auth.chatgptAccountId === undefined
      ? []
      : ([[HEADER.ACCOUNT, auth.chatgptAccountId]] as const)),
    [HEADER.VERSION, CODEX_PIN.VERSION],
  ];
  return `{ ${headers.map(([name, value]) => `${toml(name)} = ${toml(value)}`).join(", ")} }`;
}

function providerOverrides(auth: CodexAuth): (readonly [string, string])[] {
  const named =
    auth.kind === CODEX_AUTH.API_KEY
      ? { ...API_KEY_PROVIDER, BASE_URL: CHATGPT_PROVIDER.BASE_URL }
      : auth.backend === CODEX_PLAN_BACKEND.CHATGPT
        ? CHATGPT_BACKEND_PROVIDER
        : CHATGPT_PROVIDER;
  const provider = `model_providers.${named.ID}`;
  const headers = backendHeaders(auth);
  const credential: (readonly [string, string])[] =
    auth.kind === CODEX_AUTH.API_KEY
      ? [[`${provider}.env_key`, toml(RUNNER_ENV.OPENAI_API_KEY)]]
      : [
          [`${provider}.auth.command`, toml(auth.command.self.executable)],
          [
            `${provider}.auth.args`,
            `[${[auth.command.self.script, CODEX_TOKEN_COMMAND, auth.command.tokenUrl].map(toml).join(", ")}]`,
          ],
          [`${provider}.auth.timeout_ms`, String(TOKEN_COMMAND.TIMEOUT_MS)],
          [`${provider}.auth.refresh_interval_ms`, String(TOKEN_COMMAND.REFRESH_INTERVAL_MS)],
        ];
  return [
    ["model_provider", toml(named.ID)],
    [`${provider}.name`, toml(named.NAME)],
    [`${provider}.base_url`, toml(named.BASE_URL)],
    ...credential,
    ...(headers === undefined ? [] : ([[`${provider}.http_headers`, headers]] as const)),
    [`${provider}.wire_api`, toml("responses")],
    [`${provider}.requires_openai_auth`, "false"],
    [`${provider}.supports_websockets`, "false"],
    ["features.fast_mode", "true"],
    ...(auth.kind === CODEX_AUTH.API_KEY ? ([["features.ultrafast_mode", "true"]] as const) : []),
    ["model_catalog_json", toml(auth.catalog)],
  ];
}

const SANDBOX_POLICY = { type: "dangerFullAccess" } as const satisfies SandboxPolicy;

const SANDBOX_MODE = "danger-full-access";

function appServerArgs(config: CodexConfig, auth: CodexAuth): string[] {
  const mcp = `mcp_servers.${MCP_SERVER}`;
  const integrations = (config.integrations ?? [])
    .filter((integration) => integration.name !== MCP_SERVER)
    .flatMap((integration): (readonly [string, string])[] => {
      const server = `mcp_servers.${integration.name}`;
      return [
        [`${server}.url`, toml(integration.url)],
        [`${server}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
        [`${server}.default_tools_approval_mode`, toml("approve")],
        [`${server}.startup_timeout_sec`, INTEGRATION_STARTUP_TIMEOUT_SECONDS.toFixed(1)],
        [`${server}.tool_timeout_sec`, MCP_TOOL_TIMEOUT_SECONDS.toFixed(1)],
      ];
    });
  const excluded = [
    RUNNER_ENV.BEARER,
    auth.kind === CODEX_AUTH.API_KEY ? RUNNER_ENV.OPENAI_API_KEY : RUNNER_ENV.CODEX_TOKEN,
  ];
  const overrides: (readonly [string, string])[] = [
    ...providerOverrides(auth),
    [`${mcp}.url`, toml(config.mcpUrl)],
    [`${mcp}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
    [`${mcp}.default_tools_approval_mode`, toml("approve")],
    [`${mcp}.tool_timeout_sec`, MCP_TOOL_TIMEOUT_SECONDS.toFixed(1)],
    ...integrations,
    ["approval_policy", toml("never")],
    ["sandbox_mode", toml(SANDBOX_MODE)],
    ["shell_environment_policy.inherit", toml("core")],
    ["shell_environment_policy.ignore_default_excludes", "false"],
    ["shell_environment_policy.exclude", `[${excluded.map(toml).join(", ")}]`],
    [
      "shell_environment_policy.set",
      `{ ${Object.entries(SANDBOX_TOOL_ENV)
        .map(([name, value]) => `${name} = ${toml(value)}`)
        .join(", ")} }`,
    ],
  ];
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...overrides.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
  ];
}

function steerWaits(error: AppServerError): boolean {
  if (error.data === undefined || error.data === null) return error.code === INVALID_REQUEST;
  const read = decodeRefusalData(error.data);
  return (
    Option.isSome(read) &&
    codexErrorKind(read.value.codexErrorInfo) === CODEX_ERROR_INFO.ACTIVE_TURN_NOT_STEERABLE
  );
}

function userInput(content: readonly ContentBlock[]): UserInput[] {
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text, text_elements: [] }
      : { type: "image", url: `data:${block.source.media_type};base64,${block.source.data}` },
  );
}

interface CodexLaunch {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  server: AppServer;
  serverScope: Scope.Closeable;
  threadId: string;
  turnId: string | undefined;
  readonly sent: Map<string, Outgoing>;
  waiting: Outgoing[];
  readonly accepted: Set<string>;
  readonly auth: CodexAuth;
  model: string;
  effort: CodexEffort | undefined;
  tier: ServiceTier | null;
  stopping: boolean;
  warm: boolean;
}

function turnTierOf(launch: Pick<CodexLaunch, "auth" | "tier">): ServiceTier | null {
  return launch.tier === SERVICE_TIER.ULTRAFAST && launch.auth.kind !== CODEX_AUTH.API_KEY
    ? SERVICE_TIER.FAST
    : launch.tier;
}

function ended(end: RunnerEnd, failure = ""): LaunchOutcome {
  return { end, failure };
}

interface ThreadSeen {
  readonly context: LaunchContext<CodexConfig>;
  readonly signals: Queue.Queue<Signal>;
  threadId: string | undefined;
}

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

const openAppServer = Effect.fn("agent-runner/openAppServer")(function* (
  launch: Pick<CodexLaunch, "context" | "signals" | "model" | "auth">,
  threadId: string | undefined,
) {
  const { config, env } = launch.context;
  const serverScope = yield* Scope.make();
  const seen: ThreadSeen = { context: launch.context, signals: launch.signals, threadId };
  const server = yield* spawnAppServer(
    {
      executable: config.executable,
      args: appServerArgs(config, launch.auth),
      cwd: config.cwd,
      env: {
        ...env,
        PATH: pathWithCodexTools(config.executable, env.PATH),
        [RUNNER_ENV.CLAUDE_TOKEN]: undefined,
        [RUNNER_ENV.API_KEY]: undefined,
      },
      inRunnerGroup: runsOnHost(env),
    },
    listenerFor(seen),
  ).pipe(Scope.provide(serverScope));
  const opened = Effect.gen(function* () {
    yield* server.request(METHOD.INITIALIZE, { clientInfo: CLIENT_INFO, capabilities: null });
    yield* server.notify(METHOD.INITIALIZED);
    const skills = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.SKILLS);
    if (skills !== undefined) {
      yield* server.request(METHOD.SKILLS_EXTRA_ROOTS_SET, { extraRoots: [skills] });
    }
    const thread = {
      cwd: config.cwd,
      model: launch.model,
      approvalPolicy: "never",
      sandbox: SANDBOX_MODE,
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

const TURNS_PAGE = 10;

const revertedBefore = Effect.fn("agent-runner/codex/revertedBefore")(function* (
  server: AppServer,
  threadId: string,
  rewindBefore: string,
) {
  let cursor: string | null = null;
  for (;;) {
    const page = decodeTurnsPage(
      yield* server.request(METHOD.THREAD_TURNS_LIST, {
        threadId,
        cursor,
        limit: TURNS_PAGE,
        sortDirection: "desc",
        itemsView: "full",
      }),
    );
    if (Option.isNone(page)) return;
    const taking = page.value.data.find((turn) =>
      turn.items.some((item) => item.type === "userMessage" && item.clientId === rewindBefore),
    );
    if (taking !== undefined) {
      yield* server.request(METHOD.THREAD_REVERT, { threadId, beforeTurnId: taking.id });
      return;
    }
    if (page.value.nextCursor === null) return;
    cursor = page.value.nextCursor;
  }
});

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

const startTurn = Effect.fn("agent-runner/startTurn")(function* (
  launch: CodexLaunch,
  messages: readonly Outgoing[],
) {
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
      approvalPolicy: "never",
      sandboxPolicy: SANDBOX_POLICY,
      serviceTier: turnTierOf(launch),
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

const takeLine = Effect.fn("agent-runner/codex/takeLine")(function* (
  launch: CodexLaunch,
  text: string,
) {
  const line = decodeLine(text);
  if (Option.isNone(line)) {
    yield* Effect.logWarning("agent-runner: skipped a stdin line it could not read");
    return undefined;
  }
  const value = line.value;
  switch (value.type) {
    case INPUT_LINE.MESSAGE: {
      launch.warm = false;
      const uuid = value.uuid ?? randomUUID();
      const outgoing: Outgoing = { clientId: uuid, input: userInput(value.content), lines: [uuid] };
      if (launch.turnId === undefined) {
        yield* startTurn(launch, [outgoing]);
        return undefined;
      }
      const steered = yield* launch.server
        .request(METHOD.TURN_STEER, {
          threadId: launch.threadId,
          expectedTurnId: launch.turnId,
          clientUserMessageId: outgoing.clientId,
          input: [...outgoing.input],
        })
        .pipe(
          Effect.as(true),
          Effect.catchIf(steerWaits, () => Effect.succeed(false)),
        );
      if (!steered) {
        launch.waiting.push(outgoing);
        return undefined;
      }
      launch.sent.set(outgoing.clientId, outgoing);
      yield* accepted(launch, outgoing);
      return undefined;
    }
    case INPUT_LINE.STOP: {
      if (value.launch !== undefined && value.launch !== launch.context.config.firstSequence) {
        yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
        return undefined;
      }
      if (launch.turnId === undefined) return ended(RUNNER_END.STOPPED);
      launch.stopping = true;
      const interrupted = yield* launch.server
        .request(METHOD.TURN_INTERRUPT, { threadId: launch.threadId, turnId: launch.turnId })
        .pipe(
          Effect.as(true),
          Effect.catch(() =>
            Effect.logWarning("agent-runner: turn/interrupt failed").pipe(Effect.as(false)),
          ),
        );
      return interrupted ? undefined : ended(RUNNER_END.STOPPED);
    }
    case INPUT_LINE.RETIRE: {
      if (launch.warm && launch.turnId === undefined && launch.waiting.length === 0) {
        return ended(RUNNER_END.IDLED);
      }
      yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");
      return undefined;
    }
    case INPUT_LINE.MODEL: {
      if (value.model !== undefined) launch.model = value.model;
      if (value.fast !== undefined || value.ultrafast !== undefined) {
        launch.tier = serviceTierOf(value.fast, value.ultrafast);
      }
      if (value.effort !== undefined && isCodexEffort(value.effort)) launch.effort = value.effort;
      else if (value.effort !== undefined) {
        yield* Effect.logWarning("agent-runner: skipped an effort Codex does not take");
      }
      return undefined;
    }
  }
});

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
  for (;;) {
    const queued = yield* Queue.poll(launch.signals);
    if (Option.isNone(queued)) break;
    const done = yield* takeSignal(launch, queued.value);
    if (done !== undefined) return done;
  }
  if (launch.turnId !== undefined) return undefined;
  if (launch.context.config.warm !== true) return ended(RUNNER_END.TURN_ENDED);
  launch.warm = true;
  yield* launch.context.sink.emit({ type: RUNNER_EVENT.IDLE });
  return undefined;
});

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

function onApiKey(context: LaunchContext<CodexConfig>): boolean {
  const key = context.env[RUNNER_ENV.OPENAI_API_KEY];
  return key !== undefined && key !== "";
}

const decodePlanBackend = Schema.decodeUnknownOption(
  Schema.Literals(Object.values(CODEX_PLAN_BACKEND)),
);

function planBackendOf(context: LaunchContext<CodexConfig>): CodexPlanBackend | undefined {
  const named = context.env[RUNNER_ENV.CODEX_PLAN_BACKEND];
  if (named === undefined || named === "") return CODEX_PLAN_BACKEND.OPENAI_API;
  return Option.getOrUndefined(decodePlanBackend(named));
}

const authOf = Effect.fn("agent-runner/codexAuthOf")(function* (
  context: LaunchContext<CodexConfig>,
  backend: CodexPlanBackend,
) {
  if (onApiKey(context)) {
    return { kind: CODEX_AUTH.API_KEY, catalog: yield* catalogFile(ultrafastCatalog()) } as const;
  }
  if (context.self === undefined) return undefined;
  const chatgptAccountId = context.env[RUNNER_ENV.CHATGPT_ACCOUNT_ID];
  return {
    kind: CODEX_AUTH.TOKEN_COMMAND,
    command: { self: context.self, tokenUrl: context.config.tokenUrl },
    backend,
    chatgptAccountId: chatgptAccountId === "" ? undefined : chatgptAccountId,
    catalog: yield* catalogFile(planCatalog()),
  } as const;
});

function pathWithCodexTools(executable: string, path: string | undefined): string | undefined {
  const tools = join(dirname(executable), "..", "codex-path");
  if (!existsSync(tools)) return path;
  return path === undefined || path === "" ? tools : `${tools}${delimiter}${path}`;
}

export const runCodex = Effect.fn("agent-runner/runCodex")(function* (
  context: LaunchContext<CodexConfig>,
) {
  const { config, sink } = context;
  const backend = planBackendOf(context);
  if (backend === undefined) {
    return ended(RUNNER_END.FAILED, "the plan's backend is not one this runner knows");
  }
  const auth: CodexAuth | undefined = yield* authOf(context, backend);
  if (auth === undefined) {
    return ended(RUNNER_END.FAILED, "the runner was not started from its bundle");
  }
  const signals = yield* Queue.unbounded<Signal>();
  yield* sink.undelivered.pipe(
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.UNDELIVERED })),
    Effect.forkScoped,
  );
  const opened = yield* openAppServer(
    { context, signals, model: config.model, auth },
    config.threadId,
  ).pipe(Effect.result);
  if (opened._tag === "Failure") {
    return ended(RUNNER_END.FAILED, `${opened.failure.method}: ${opened.failure.detail}`);
  }
  if (config.threadId !== undefined && config.rewindBefore !== undefined) {
    yield* revertedBefore(opened.success.server, opened.success.threadId, config.rewindBefore).pipe(
      Effect.catch((error) =>
        Effect.logWarning(`agent-runner: the thread was not rewound: ${error.method}`),
      ),
    );
  }
  const launch: CodexLaunch = {
    context,
    signals,
    ...opened.success,
    turnId: undefined,
    sent: new Map(),
    waiting: [],
    accepted: new Set(),
    auth,
    model: config.model,
    effort: config.effort,
    tier: serviceTierOf(config.fast, config.ultrafast),
    stopping: false,
    warm: false,
  };

  yield* Stream.fromQueue(context.lines).pipe(
    Stream.runForEach((text) => Queue.offer(signals, { kind: SIGNAL.LINE, text })),
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.INPUT_CLOSED })),
    Effect.forkScoped,
  );
  const outcome = yield* Effect.gen(function* () {
    for (;;) {
      const next = launch.warm
        ? yield* Queue.take(signals).pipe(
            Effect.timeoutOption(Duration.millis(RUNNER_WARM.IDLE_CAP_MS)),
          )
        : Option.some(yield* Queue.take(signals));
      if (Option.isNone(next)) return ended(RUNNER_END.IDLED);
      const done = yield* takeSignal(launch, next.value);
      if (done !== undefined) return done;
    }
  }).pipe(
    Effect.catch((error: AppServerError) =>
      Effect.succeed(ended(RUNNER_END.FAILED, `${error.method}: ${error.detail}`)),
    ),
  );
  yield* Scope.close(launch.serverScope, Exit.void);
  return outcome;
});
