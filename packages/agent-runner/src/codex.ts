/**
 * codex.ts -- one launch of Codex for a Luke agent: `codex app-server` spawned with the ChatGPT plan's provider, the thread started or resumed, Luke's lines turned into turns, steers, interrupts and restarts, every notification posted out, and the launch ended, or kept warm, once the agent's turn is over.
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
 * When the agent's turn is over (Codex's end-of-run rule). It is over at
 * the `turn/completed` of the turn the launch is running, on its own thread,
 * once no message Luke sent is left unanswered. Each `turn/start` and `turn/steer`
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
 * Code's background work outlives a `result`. A turn that is over ends the
 * launch as `turn_ended`, or, where the config asks it to stay `warm`, posts
 * IDLE and keeps the launch up (`RUNNER_WARM`) for Luke's next message,
 * until Luke retires it or its cap ends it as `idled`. One interrupted
 * after Luke's stop ends the launch as `stopped`; a
 * failed turn, or one interrupted without a stop, as `failed`, with the
 * turn's error, so it shows as interrupted and Continue resumes the thread. A
 * stop with no turn running ends the launch at once; so does stdin closing
 * with none, while one running is let finish. App-server exiting, or Luke
 * refusing the events, ends it as `failed`.
 *
 * Tokens. App-server takes its token from a command, Codex's provider
 * `auth`: the runner's own bundle as `codex-token` (`codex-token.ts`), which
 * asks Luke at the config's `tokenUrl` under the runner's bearer. Codex keeps
 * what the command printed for the refresh interval, and runs it again past
 * that and after a 401, so a turn outlives any one token, and no token sits
 * in app-server's environment; what the command prints reaches app-server
 * alone. A launch whose environment holds `OPENAI_API_KEY` (one the
 * account's OpenAI API key pays for) asks no token: app-server reads the key
 * from there, the provider's documented `env_key`, and no command it runs
 * inherits it. A launch on the Mac's own sign-in (`ownLogin`) names no
 * provider of Luke's at all: app-server runs OpenAI's own on the login
 * `codex login` keeps under the user's `CODEX_HOME`, refreshed by Codex
 * itself, after `account/read` says there is one
 * (https://learn.chatgpt.com/docs/app-server, Authentication).
 *
 * Sandbox. Every command Codex runs is under its own sandbox in
 * `workspace-write` with approval `never` (https://learn.chatgpt.com/docs/sandboxing),
 * set as the thread starts and again as the `sandboxPolicy` of each
 * `turn/start`, as app-server documents: the checkout writable, its Git
 * directory, the folders the machine grants (a local agent's own folder),
 * and on a Mac the toolchains' caches, with the network on. On a Mac that
 * sandbox is Codex's Seatbelt, never `danger-full-access` or
 * `externalSandbox`.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { Duration, Effect, Exit, Option, Queue, Schema, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AppServer,
  AppServerError,
  type AppServerListener,
  spawnAppServer,
} from "./app-server.js";
import type {
  SandboxPolicy,
  ThreadStartParams,
  TurnStatus,
  UserInput,
} from "./codex-protocol/v2/index.js";
import {
  gitCommonDir,
  installedSkillsPath,
  type LaunchContext,
  type LaunchOutcome,
  MAC_TOOLCHAIN_CACHES,
  ON_MAC,
  type RunnerSelf,
} from "./launch.js";
import {
  CODEX_EFFORT,
  CODEX_ERROR_INFO,
  CODEX_TOKEN_COMMAND,
  type CodexConfig,
  type CodexEffort,
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

/**
 * OpenAI's documented provider for a ChatGPT plan's token
 * (developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
 */
const CHATGPT_PROVIDER = {
  ID: "openai_chatgpt_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://api.openai.com/v1",
} as const;

/**
 * How app-server runs the token command: given long enough for a cold Luke
 * and a renewal at OpenAI behind it, and run again once what it printed is
 * five minutes old, well inside the margin Luke's route answers a token with.
 */
const TOKEN_COMMAND = {
  TIMEOUT_MS: 30_000,
  REFRESH_INTERVAL_MS: 300_000,
} as const;

/** The name the Luke MCP server is registered under in Codex's config. */
const MCP_SERVER = "luke";

/**
 * How long Codex waits on one Luke tool call, in seconds: the Luke MCP
 * function's own duration (`luke-mcp/app.ts`'s `LUKE_MCP_FUNCTION`, the
 * longest `run_on_mac` and two minutes around it), so Codex never gives up
 * on a call Luke is still running. Note that Codex's default is 60 s, past
 * which it fails the call while Luke carries it out, and the agent retries a
 * call that already ran.
 */
const MCP_TOOL_TIMEOUT_SECONDS = 600;

/**
 * How long Codex waits on an integration's server to start, in seconds:
 * past the bound Luke lists a provider's tools within
 * (`connection-door.ts`'s `LIST_TIMEOUT`, ten seconds), so a slow provider's
 * server answers no tools rather than being failed by Codex at its default
 * of ten (https://learn.chatgpt.com/docs/extend/mcp, `startup_timeout_sec`).
 */
const INTEGRATION_STARTUP_TIMEOUT_SECONDS = 20;

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
  ACCOUNT_READ: "account/read",
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

/** JSON-RPC's code for a request the receiver refuses as it stands. */
const INVALID_REQUEST = -32600;

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
/** A page of a thread's turns as the rewind reads it: each turn's id and its user messages' client ids. */
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
/** What `account/read` answers, as the launch on the Mac's own sign-in reads it: whether Codex holds an account. */
const AccountAnswerSchema = Schema.Struct({ account: Schema.NullOr(Schema.Unknown) });
const decodeThreadAnswer = Schema.decodeUnknownOption(ThreadAnswerSchema);
const decodeAccountAnswer = Schema.decodeUnknownOption(AccountAnswerSchema);
const decodeTurnsPage = Schema.decodeUnknownOption(TurnsPageSchema);
const decodeTurnAnswer = Schema.decodeUnknownOption(TurnAnswerSchema);
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(InputLineSchema));
/** The field of a refusal's `data` read here: the `TurnError`'s info, where app-server sent one. */
const decodeRefusalData = Schema.decodeUnknownOption(
  Schema.Struct({ codexErrorInfo: Schema.optionalKey(Schema.NullOr(Schema.Unknown)) }),
);

const CODEX_EFFORTS: ReadonlySet<string> = new Set(Object.values(CODEX_EFFORT));

/** Whether a model line's effort is one Codex takes. */
function isCodexEffort(effort: string): effort is CodexEffort {
  return CODEX_EFFORTS.has(effort);
}

/** A TOML basic string, as Codex's `-c key=value` reads one. */
function toml(value: string): string {
  return JSON.stringify(value);
}

/** Where the token command is run from: the runner's bundle, asked for the token at `tokenUrl`. */
interface TokenCommand {
  readonly self: RunnerSelf;
  readonly tokenUrl: string;
}

/** The service tier a fast version runs on: Codex's documented `fast`, which it sends as the API's `priority`. */
const FAST_TIER = "fast";

/**
 * OpenAI's API as an API key pays for it: the same endpoint, its key read
 * from the launch's environment through the provider's documented `env_key`
 * (https://developers.openai.com/codex/config-advanced/).
 */
const API_KEY_PROVIDER = {
  ID: "openai_api_key",
  NAME: "OpenAI API key",
} as const;

/** Which credential a launch's app-server runs on. */
const CODEX_AUTH = {
  /** The account's ChatGPT plan, its token asked of Luke through the runner's token command. */
  TOKEN_COMMAND: "token_command",
  /** The account's OpenAI API key, in the launch's environment. */
  API_KEY: "api_key",
  /** The Mac's own Codex sign-in, under the user's `CODEX_HOME`. */
  OWN_LOGIN: "own_login",
} as const;

type CodexAuth =
  | { readonly kind: typeof CODEX_AUTH.TOKEN_COMMAND; readonly command: TokenCommand }
  | { readonly kind: typeof CODEX_AUTH.API_KEY }
  | { readonly kind: typeof CODEX_AUTH.OWN_LOGIN };

/**
 * How Luke's provider is handed its token: from the runner's token command
 * on the plan, or from `OPENAI_API_KEY` (the documented `env_key`) on an API
 * key; and its own name. None on the Mac's own sign-in, which runs OpenAI's
 * own provider on Codex's login.
 */
function providerOverrides(auth: CodexAuth): (readonly [string, string])[] {
  if (auth.kind === CODEX_AUTH.OWN_LOGIN) return [];
  const named = auth.kind === CODEX_AUTH.API_KEY ? API_KEY_PROVIDER : CHATGPT_PROVIDER;
  const provider = `model_providers.${named.ID}`;
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
    [`${provider}.base_url`, toml(CHATGPT_PROVIDER.BASE_URL)],
    ...credential,
    [`${provider}.wire_api`, toml("responses")],
    [`${provider}.requires_openai_auth`, "false"],
    [`${provider}.supports_websockets`, "false"],
    // On an API key a fast version runs on the `fast` tier, which the documented feature turns on
    // (https://learn.chatgpt.com/docs/agent-configuration/speed); the plan's launch runs none.
    ...(auth.kind === CODEX_AUTH.API_KEY ? ([["features.fast_mode", "true"]] as const) : []),
  ];
}

/**
 * Every folder the agent's commands may write beside the checkout, which
 * `workspace-write` keeps writable itself: the checkout's Git directory, the
 * folders its machine grants, and on a Mac the toolchains' caches under the
 * developer's home. Each is absolute, as app-server's `writableRoots` are.
 */
function writableRoots(config: CodexConfig, env: LaunchContext<CodexConfig>["env"]): string[] {
  const home = env.HOME;
  const caches =
    ON_MAC && home !== undefined && home !== ""
      ? MAC_TOOLCHAIN_CACHES.map((cache) => join(home, cache))
      : [];
  return [
    gitCommonDir(config.cwd) ?? join(config.cwd, ".git"),
    ...(config.writableRoots ?? []),
    ...caches,
  ];
}

/**
 * The sandbox every turn runs under, as `turn/start`'s documented
 * `sandboxPolicy`: workspace-write over the roots given, the network on, and
 * the temp folders writable as Codex keeps them.
 */
function sandboxPolicy(roots: readonly string[]): SandboxPolicy {
  return {
    type: "workspaceWrite",
    writableRoots: [...roots],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

/**
 * App-server's argv: Luke's provider and its credential where the launch
 * runs on one of Luke's (`providerOverrides`), the Luke MCP
 * server and each integration's beside it with the bearer read from the environment and their tools approved up
 * front (under `approval_policy = "never"` Codex 0.163.0 otherwise fails
 * every MCP call, as P16 found) and given as long as Luke runs a call, the sandbox with network on and its
 * writable roots (`writableRoots`), and commands inheriting the core variables
 * without the bearer or the key. Nothing in argv is secret.
 *
 * Note that workspace-write keeps `.git` read-only under every writable root
 * (openai/codex#15505), and with `never` nothing escalates, so without its
 * own writable root an agent could not commit. Granting the Git directory
 * itself, a Mac worktree's shared one among them, keeps
 * the sandbox on: commands still never see the token, and app-server's own
 * git calls run with hooks and fsmonitor disabled.
 */
function appServerArgs(config: CodexConfig, auth: CodexAuth, roots: readonly string[]): string[] {
  const mcp = `mcp_servers.${MCP_SERVER}`;
  // Each integration the agent is handed is a server of its own on the same bearer, its tools approved and bounded as Luke's are.
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
    ...(auth.kind === CODEX_AUTH.API_KEY ? [RUNNER_ENV.OPENAI_API_KEY] : []),
  ];
  const overrides: (readonly [string, string])[] = [
    ...providerOverrides(auth),
    [`${mcp}.url`, toml(config.mcpUrl)],
    [`${mcp}.bearer_token_env_var`, toml(RUNNER_ENV.BEARER)],
    [`${mcp}.default_tools_approval_mode`, toml("approve")],
    [`${mcp}.tool_timeout_sec`, MCP_TOOL_TIMEOUT_SECONDS.toFixed(1)],
    ...integrations,
    ["approval_policy", toml("never")],
    ["sandbox_mode", toml("workspace-write")],
    ["sandbox_workspace_write.network_access", "true"],
    ["sandbox_workspace_write.writable_roots", `[${roots.map(toml).join(", ")}]`],
    ["shell_environment_policy.inherit", toml("core")],
    ["shell_environment_policy.ignore_default_excludes", "false"],
    ["shell_environment_policy.exclude", `[${excluded.map(toml).join(", ")}]`],
  ];
  return [
    "app-server",
    "--listen",
    "stdio://",
    ...overrides.flatMap(([key, value]) => ["-c", `${key}=${value}`]),
  ];
}

/**
 * Whether a steer app-server refused waits for the next turn: the turn it
 * runs cannot take one (a review or a compaction, `activeTurnNotSteerable`
 * in the refusal's `TurnError`), or the turn ended under the steer, which
 * app-server refuses as an invalid request with no data (no active turn, or
 * another turn's id). Any other refusal, or no answer in time, fails the
 * launch rather than holding a message no turn may ever take.
 */
function steerWaits(error: AppServerError): boolean {
  if (error.data === undefined || error.data === null) return error.code === INVALID_REQUEST;
  const read = decodeRefusalData(error.data);
  return (
    Option.isSome(read) &&
    codexErrorKind(read.value.codexErrorInfo) === CODEX_ERROR_INFO.ACTIVE_TURN_NOT_STEERABLE
  );
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
  /** The credential app-server runs on. */
  readonly auth: CodexAuth;
  /** The folders the agent's commands may write beside its checkout (`writableRoots`), which every turn's sandbox names. */
  readonly roots: readonly string[];
  model: string;
  effort: CodexEffort | undefined;
  /** Whether the next turn runs on the `fast` service tier: a fast version on an API key alone. */
  fast: boolean;
  stopping: boolean;
  /** Whether the launch is warm: its turn completed with nothing left, an IDLE posted, and no message taken since. */
  warm: boolean;
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
  launch: Pick<CodexLaunch, "context" | "signals" | "model" | "auth" | "roots">,
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
      args: appServerArgs(config, launch.auth, launch.roots),
      cwd: config.cwd,
      // Note that Claude Code's credentials, were they set, are no business of Codex's.
      env: {
        ...env,
        PATH: pathWithCodexTools(config.executable, env.PATH),
        [RUNNER_ENV.CLAUDE_TOKEN]: undefined,
        [RUNNER_ENV.API_KEY]: undefined,
        // Note that on the Mac's own sign-in no key of Luke's reaches app-server, were one handed to the launch.
        ...(launch.auth.kind === CODEX_AUTH.OWN_LOGIN
          ? { [RUNNER_ENV.OPENAI_API_KEY]: undefined }
          : undefined),
      },
    },
    listenerFor(seen),
  ).pipe(Scope.provide(serverScope));
  const opened = Effect.gen(function* () {
    yield* server.request(METHOD.INITIALIZE, { clientInfo: CLIENT_INFO, capabilities: null });
    yield* server.notify(METHOD.INITIALIZED);
    // Note that a launch on the Mac's own sign-in goes no further where Codex holds none, rather than fail its first turn.
    if (launch.auth.kind === CODEX_AUTH.OWN_LOGIN) {
      const account = decodeAccountAnswer(
        yield* server.request(METHOD.ACCOUNT_READ, { refreshToken: false }),
      );
      if (Option.isNone(account) || account.value.account === null) {
        return yield* new AppServerError({
          method: METHOD.ACCOUNT_READ,
          detail: "Codex on this Mac is not signed in",
        });
      }
    }
    // The member's installed skills, beside the checkout's `.agents/skills`, before the thread lists them.
    const skills = installedSkillsPath(config.installedSkills, INSTALLED_SKILLS.SKILLS);
    if (skills !== undefined) {
      yield* server.request(METHOD.SKILLS_EXTRA_ROOTS_SET, { extraRoots: [skills] });
    }
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

/** How many turns a page of the rewind's read back from the thread's end holds. */
const TURNS_PAGE = 10;

/**
 * The resumed thread reverted to before the turn that took the message a
 * rewind dropped, found by its client id reading back from the thread's
 * end; a thread no turn of which took it is left whole, as a rewind Codex
 * never heard of leaves nothing of its own to cut. A revert that fails is
 * logged and the thread goes on whole, since the launch's message still
 * stands to be answered.
 */
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

/** Starts the next turn with the messages given, merged into one. */
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
      sandboxPolicy: sandboxPolicy(launch.roots),
      // Note that a null tier is the standard one, which a fast version turned off goes back to.
      ...(launch.auth.kind === CODEX_AUTH.API_KEY
        ? { serviceTier: launch.fast ? FAST_TIER : null }
        : undefined),
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
      launch.warm = false;
      // Note that Luke's id for the line is the id Codex echoes, so a turn that takes it names it.
      const uuid = value.uuid ?? randomUUID();
      const outgoing: Outgoing = { clientId: uuid, input: userInput(value.content), lines: [uuid] };
      if (launch.turnId === undefined) {
        yield* startTurn(launch, [outgoing]);
        return undefined;
      }
      // A steer the turn cannot take waits for the next turn; any other refusal fails the launch.
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
      // A stop for another launch's turn is not this launch's to take.
      if (value.launch !== undefined && value.launch !== launch.context.config.firstSequence) {
        yield* Effect.logWarning("agent-runner: skipped a stop for another launch");
        return undefined;
      }
      if (launch.turnId === undefined) return ended(RUNNER_END.STOPPED);
      launch.stopping = true;
      // Note that a turn app-server did not interrupt ends with the launch, which closes app-server, so a stop never waits on a hung one.
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
      // Lines are taken one at a time, so a message ahead of this one already took the launch out of warm.
      if (launch.warm && launch.turnId === undefined && launch.waiting.length === 0) {
        return ended(RUNNER_END.IDLED);
      }
      yield* Effect.logWarning("agent-runner: skipped a retire for a launch at work");
      return undefined;
    }
    case INPUT_LINE.MODEL: {
      if (value.model !== undefined) launch.model = value.model;
      if (value.fast !== undefined) launch.fast = value.fast;
      if (value.effort !== undefined && isCodexEffort(value.effort)) launch.effort = value.effort;
      else if (value.effort !== undefined) {
        yield* Effect.logWarning("agent-runner: skipped an effort Codex does not take");
      }
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
  if (launch.turnId !== undefined) return undefined;
  if (launch.context.config.warm !== true) return ended(RUNNER_END.TURN_ENDED);
  // The agent's turn is over: the launch stays warm for Luke's next message rather than ending.
  launch.warm = true;
  yield* launch.context.sink.emit({ type: RUNNER_EVENT.IDLE });
  return undefined;
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

/** Whether the launch's environment holds the account's OpenAI API key, which app-server then runs on in place of the plan's token. */
function onApiKey(context: LaunchContext<CodexConfig>): boolean {
  const key = context.env[RUNNER_ENV.OPENAI_API_KEY];
  return key !== undefined && key !== "";
}

/**
 * The credential a launch's app-server runs on: the Mac's own sign-in where
 * the config says so, the account's API key where the environment holds it,
 * and the plan's token command otherwise, where the runner knows its own
 * bundle; none where it does not.
 */
function authOf(context: LaunchContext<CodexConfig>): CodexAuth | undefined {
  if (context.config.ownLogin === true) return { kind: CODEX_AUTH.OWN_LOGIN };
  if (onApiKey(context)) return { kind: CODEX_AUTH.API_KEY };
  if (context.self === undefined) return undefined;
  return {
    kind: CODEX_AUTH.TOKEN_COMMAND,
    command: { self: context.self, tokenUrl: context.config.tokenUrl },
  };
}

/**
 * The PATH app-server runs with: the one given, behind the folder of tools
 * Codex's own package keeps beside its binary (`codex-path`, its `rg`) where
 * the binary stands in one, as Codex's npm launcher puts it first.
 */
function pathWithCodexTools(executable: string, path: string | undefined): string | undefined {
  const tools = join(dirname(executable), "..", "codex-path");
  if (!existsSync(tools)) return path;
  return path === undefined || path === "" ? tools : `${tools}${delimiter}${path}`;
}

/**
 * One Codex launch, from its config to the moment app-server is ended.
 * Answers why it ended, and the failure where it failed.
 */
export const runCodex = Effect.fn("agent-runner/runCodex")(function* (
  context: LaunchContext<CodexConfig>,
) {
  const { config, sink } = context;
  const auth = authOf(context);
  if (auth === undefined) {
    return ended(RUNNER_END.FAILED, "the runner was not started from its bundle");
  }
  const roots = writableRoots(config, context.env);
  const signals = yield* Queue.unbounded<Signal>();
  yield* sink.undelivered.pipe(
    Effect.andThen(Queue.offer(signals, { kind: SIGNAL.UNDELIVERED })),
    Effect.forkScoped,
  );
  const opened = yield* openAppServer(
    { context, signals, model: config.model, auth, roots },
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
    roots,
    model: config.model,
    effort: config.effort,
    fast: config.fast === true,
    stopping: false,
    warm: false,
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
      // A warm launch waits at most its cap for the next signal, and ends where none came.
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
  // App-server ends before the launch's last event, so nothing it emits on
  // the way down is numbered after it.
  yield* Scope.close(launch.serverScope, Exit.void);
  return outcome;
});
