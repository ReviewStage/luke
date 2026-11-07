/**
 * codex.ts -- one launch of Codex for an agent: `codex app-server` spawned with the ChatGPT plan's provider, the thread started or resumed, the service's lines turned into turns, steers, interrupts and restarts, every notification posted out, and the launch ended, or kept warm, once the agent's turn is over.
 *
 * One controller fiber owns the launch's state and acts on one signal at a
 * time: a line the service wrote, or what app-server reported (a message a turn
 * took, a turn completed, the process gone). Notifications are posted by the
 * reader as Codex writes them, so their order is Codex's own; the controller
 * only decides. A request it sends is awaited where it is sent, and whatever
 * app-server reports meanwhile waits its turn in the signal queue, so a
 * steered message is always recorded as sent before the notification that
 * says the turn took it.
 *
 * When the agent's turn is over (Codex's end-of-run rule). It is over at
 * the `turn/completed` of the turn the launch is running, on its own thread,
 * once no message the service sent is left unanswered. Each `turn/start` and `turn/steer`
 * carries a `clientUserMessageId`, which Codex echoes as the `clientId` of
 * the `userMessage` item a turn takes it in, and which is the service's own id for
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
 * IDLE and keeps the launch up (`RUNNER_WARM`) for the service's next message,
 * until the service retires it or its cap ends it as `idled`. One interrupted
 * after the service's stop ends the launch as `stopped`; a
 * failed turn, or one interrupted without a stop, as `failed`, with the
 * turn's error, so it shows as interrupted and Continue resumes the thread. A
 * stop with no turn running ends the launch at once; so does stdin closing
 * with none, while one running is let finish. App-server exiting, or the service
 * refusing the events, ends it as `failed`.
 *
 * Tokens. In the cloud's sandbox the runner signs app-server in on the
 * plan with host-supplied ChatGPT tokens, OpenAI's documented mode for a
 * host that owns the sign-in (https://learn.chatgpt.com/docs/app-server,
 * `chatgptAuthTokens`): as the process starts it asks the service at the
 * config's `tokenUrl`, under the runner's bearer, for the plan's access
 * token and the workspace it pays from, and hands them to
 * `account/login/start`; Codex's own OpenAI provider then sends them to
 * Codex's ChatGPT backend as its built-in ChatGPT sign-in does. When a
 * request gets a 401, app-server asks the runner for fresh ones
 * (`account/chatgptAuthTokens/refresh`), which it asks the service for in
 * turn, and retries the request, so a turn outlives any one token. The
 * sign-in that renews the token stays with the service; only the access
 * token enters the sandbox, held by app-server and in no environment.
 *
 * On a host app-server takes its token from a command, Codex's provider
 * `auth`: the runner's own bundle as `codex-token` (`codex-token.ts`), which
 * asks the service at the config's `tokenUrl` under the runner's bearer. A
 * plan connected through Codex's own device-code login has a token only
 * Codex's ChatGPT backend accepts, so where the launch's environment names
 * that backend (`RUNNER_ENV.CODEX_PLAN_BACKEND`) the provider sends there,
 * naming the workspace the plan pays from as Codex's ChatGPT sign-in does
 * (`CHATGPT_BACKEND_PROVIDER`), its token from the same command. Codex keeps
 * what the command printed for the refresh interval, and runs it again past
 * that and after a 401, so a turn outlives any one token, and no token sits
 * in app-server's environment; what the command prints reaches app-server
 * alone. A launch whose environment holds `OPENAI_API_KEY` (one the
 * account's OpenAI API key pays for) asks no token: app-server reads the key
 * from there, the provider's documented `env_key`, and no command it runs
 * inherits it; in the cloud's sandbox it is a placeholder there too, the key
 * set in its place at the firewall.
 *
 * Speed. Each turn names its service tier: `fast` for a fast version,
 * which Codex sends as the API's `priority`, on the plan and an API key
 * alike, `ultrafast` for an Ultrafast one, on an API key alone, and null for
 * the standard tier. Codex sends a tier only
 * where its catalog lists it for the model (`service_tier_for_request`),
 * and the catalog it bundles lists no `ultrafast`, so an API-key launch
 * hands app-server a catalog of its own (`model_catalog_json`), read once
 * as it starts in place of the bundled one: the pinned release's own
 * (`codex-protocol/bundled-models.ts`) with the Ultrafast tier listed on
 * every model, which leaves the service's catalog, which offers an
 * Ultrafast version only where OpenAI prices one, the one gate on it.
 *
 * Subagents. A plan's launch hands app-server a catalog of its own too: the
 * pinned release's with no model naming a `multi_agent_version`, which is
 * what has Codex offer its subagent tools whatever its features say. OpenAI
 * refuses a plan's request that carries an `agent_message` item
 * (`subscription_sharing_unsupported_capability`), and a spawned subagent's
 * first request carries its task as one, as the parent's history carries
 * the subagent's answer, so one spawn would fail every later turn of the
 * thread.
 *
 * Sandbox. Codex runs no sandbox of its own, `danger-full-access` with
 * approval `never` (https://learn.chatgpt.com/docs/sandboxing), set as the
 * thread starts and again as the `sandboxPolicy` of each `turn/start`, as
 * app-server documents, so a thread started under another mode runs under
 * this one from its next turn. The machine is the boundary: a host's box, to
 * which an agent there has full access, or the cloud's sandbox, whose
 * firewall holds every credential and leaves only placeholders inside. Its
 * commands still inherit no bearer or key (`shell_environment_policy`),
 * since none is theirs to use, a placeholder or not.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Duration, Effect, Exit, Option, Queue, Schema, Scope, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { ChildProcessSpawner } from "effect/process";
import {
  type AppServer,
  AppServerError,
  type AppServerListener,
  AppServerRequestFailed,
  spawnAppServer,
} from "./app-server.js";
import { CODEX_BUNDLED_MODELS_JSON } from "./codex-protocol/bundled-models.js";
import type {
  ChatgptAuthTokensRefreshResponse,
  SandboxPolicy,
  ThreadStartParams,
  TurnStatus,
  UserInput,
} from "./codex-protocol/v2/index.js";
import {
  mirrorRollout,
  openRolloutMirror,
  type RolloutMirror,
  restoreRollouts,
} from "./codex-rollout.js";
import { askPlanTokens, type CodexTokenFailed } from "./codex-token.js";
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
import { transcriptStore } from "./transcripts.js";

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
 * Codex's ChatGPT backend, for a plan's token Codex's own device-code login
 * was issued, which OpenAI's API refuses: the base URL Codex's built-in
 * ChatGPT sign-in sends to (Codex 0.163.0's `CHATGPT_CODEX_BASE_URL`), and
 * the headers it adds there that a provider of ours must name itself. Codex
 * sends the workspace's header beside its bearer for that sign-in alone,
 * and the `version` header from its built-in provider's `http_headers`;
 * `originator` and `User-Agent` it sends for every provider, so ours
 * carries them as they are.
 */
const CHATGPT_BACKEND_PROVIDER = {
  ID: "chatgpt_backend_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://chatgpt.com/backend-api/codex",
  HEADER: { ACCOUNT: "ChatGPT-Account-ID", VERSION: "version" },
} as const;

/**
 * How app-server runs the token command: given long enough for the service's cold start
 * and a renewal at OpenAI behind it, and run again once what it printed is
 * five minutes old, well inside the margin the service's route answers a token with.
 */
const TOKEN_COMMAND = {
  TIMEOUT_MS: 30_000,
  REFRESH_INTERVAL_MS: 300_000,
} as const;

/** The name our MCP server is registered under in Codex's config (`@repo/features/agent-tools`'s `WORKSPACE_MCP_SERVER`). */
const MCP_SERVER = "workspace";

/**
 * How long Codex waits on one of our tool calls, in seconds: our MCP
 * function's own duration (`workspace-mcp/app.ts`'s `WORKSPACE_MCP_FUNCTION`, the
 * longest `run_on_mac` and two minutes around it), so Codex never gives up
 * on a call the service is still running. Note that Codex's default is 60 s, past
 * which it fails the call while the service carries it out, and the agent retries a
 * call that already ran.
 */
const MCP_TOOL_TIMEOUT_SECONDS = 600;

/**
 * How long Codex waits on an integration's server to start, in seconds:
 * past the bound the service lists a provider's tools within
 * (`connection-door.ts`'s `LIST_TIMEOUT`, ten seconds), so a slow provider's
 * server answers no tools rather than being failed by Codex at its default
 * of ten (https://learn.chatgpt.com/docs/extend/mcp, `startup_timeout_sec`).
 */
const INTEGRATION_STARTUP_TIMEOUT_SECONDS = 20;

/**
 * Who the runner tells app-server it is. OpenAI asks that the name match the
 * `agent_name_hint` the sign-in sent, which is the product's name. The version is the
 * package's, which the bundle's build writes in (`--define`); an unbundled
 * runner, such as the tests', says `dev`.
 */
const CLIENT_INFO = {
  name: "Vespin",
  title: "Vespin",
  version: process.env.APP_RUNNER_VERSION ?? "dev",
} as const;

/** The JSON-RPC methods the runner sends, and the notifications it acts on. */
const METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  ACCOUNT_LOGIN_START: "account/login/start",
  CHATGPT_AUTH_TOKENS_REFRESH: "account/chatgptAuthTokens/refresh",
  SKILLS_EXTRA_ROOTS_SET: "skills/extraRoots/set",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_FORK: "thread/fork",
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
 * A message the service sent, as Codex takes it, under the id Codex echoes when a
 * turn takes it: the service's own id for the line where it goes alone. `lines` are
 * the ids of the service's lines it carries, one for a line, several for a merged
 * next turn.
 */
interface Outgoing {
  readonly clientId: string;
  readonly input: readonly UserInput[];
  readonly lines: readonly string[];
}

/** The fields of an answer the controller reads. */
const ThreadAnswerSchema = Schema.Struct({
  thread: Schema.Struct({
    id: Schema.String,
    path: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});
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
const decodeThreadAnswer = Schema.decodeUnknownOption(ThreadAnswerSchema);
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

/**
 * The service tiers a turn names on an API key: a fast version's, Codex's
 * documented `fast`, which it sends as the API's `priority`, and an
 * Ultrafast version's, which it sends as it is; a turn naming none runs on
 * the standard tier.
 */
const SERVICE_TIER = {
  FAST: "fast",
  ULTRAFAST: "ultrafast",
} as const;

type ServiceTier = (typeof SERVICE_TIER)[keyof typeof SERVICE_TIER];

/**
 * The Ultrafast tier as Codex's catalog lists a model's tiers
 * (`ModelServiceTier`, each of whose keys it requires), in the words
 * OpenAI's own catalog gives its tiers.
 */
const ULTRAFAST_CATALOG_TIER = {
  id: SERVICE_TIER.ULTRAFAST,
  name: "Ultrafast",
  description: "Fastest speed, highest usage",
} as const;

/** The file a launch writes its catalog to, in a folder of its own it removes as it ends. */
const CATALOG_FILE = { PREFIX: "vespin-codex-", NAME: "models.json" } as const;

/** The tier a turn names for the speed keys given; null, the standard tier, for neither. */
function serviceTierOf(
  fast: boolean | undefined,
  ultrafast: boolean | undefined,
): ServiceTier | null {
  if (ultrafast === true) return SERVICE_TIER.ULTRAFAST;
  return fast === true ? SERVICE_TIER.FAST : null;
}

/** A catalog entry as this file reads it: its tiers, and whatever else Codex reads, kept as it is. */
const CatalogSchema = Schema.Struct({
  models: Schema.Array(
    Schema.StructWithRest(
      Schema.Struct({ service_tiers: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
});

/** The pinned release's bundled catalog, as this file reads it. */
function bundledCatalog() {
  return Schema.decodeUnknownSync(CatalogSchema)(JSON.parse(CODEX_BUNDLED_MODELS_JSON));
}

/**
 * The pinned release's bundled catalog with the Ultrafast tier listed on
 * every model that lists none, as Codex's `model_catalog_json` reads it.
 */
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

/**
 * The pinned release's bundled catalog with no model naming a
 * `multi_agent_version`, so Codex offers no subagent tools on the plan
 * (the file header's Subagents), as Codex's `model_catalog_json` reads it.
 */
function planCatalog(): string {
  const catalog = bundledCatalog();
  const models = catalog.models.map((model) =>
    Object.fromEntries(Object.entries(model).filter(([key]) => key !== "multi_agent_version")),
  );
  return JSON.stringify({ ...catalog, models });
}

/** The catalog given written to a folder of the launch's own, which the launch's scope removes; its absolute path, as `model_catalog_json` takes it. */
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
  /** The account's ChatGPT plan in the cloud's sandbox, app-server signed in on host-supplied tokens the runner asks the service for. */
  CHATGPT_TOKENS: "chatgpt_tokens",
  /** The account's ChatGPT plan on a host, its token asked of the service through the runner's token command. */
  TOKEN_COMMAND: "token_command",
  /** The account's OpenAI API key, in the launch's environment. */
  API_KEY: "api_key",
} as const;

type CodexAuth = (
  | {
      readonly kind: typeof CODEX_AUTH.TOKEN_COMMAND;
      readonly command: TokenCommand;
      /** Where the plan's token is sent (`RUNNER_ENV.CODEX_PLAN_BACKEND`). */
      readonly backend: CodexPlanBackend;
      /** The workspace the plan pays from, where its starter named one (`RUNNER_ENV.CHATGPT_ACCOUNT_ID`). */
      readonly chatgptAccountId: string | undefined;
    }
  | {
      readonly kind: typeof CODEX_AUTH.CHATGPT_TOKENS;
      /** Where the plan's tokens are asked for: the service's token route. */
      readonly tokenUrl: string;
    }
  | { readonly kind: typeof CODEX_AUTH.API_KEY }
) & {
  /** The catalog app-server reads in place of its bundled one (`catalogFile`): `planCatalog` on the plan, `ultrafastCatalog` on an API key. */
  readonly catalog: string;
};

/**
 * The headers our provider adds on Codex's ChatGPT backend, as Codex's
 * ChatGPT sign-in sends them there: its pinned version, and the workspace
 * where the plan names one; none on OpenAI's API.
 */
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

/**
 * How our provider is handed its token: from the runner's token command
 * on a host's plan, or from `OPENAI_API_KEY` (the documented `env_key`) on an API
 * key; its own name; where it sends its requests, Codex's ChatGPT backend
 * with the headers it reads there for a device-code plan's token, OpenAI's
 * API for every other; none on host-supplied tokens, which Codex's own
 * OpenAI provider sends.
 */
function providerOverrides(auth: CodexAuth): (readonly [string, string])[] {
  if (auth.kind === CODEX_AUTH.CHATGPT_TOKENS) return [];
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
  ];
}

/** What every launch turns on beside its provider: the fast tier, the Ultrafast one on an API key, and the catalog the launch wrote. */
function featureOverrides(auth: CodexAuth): (readonly [string, string])[] {
  return [
    // A fast version runs on the `fast` tier, which the documented feature turns on, on the plan and an API key alike
    // (https://learn.chatgpt.com/docs/agent-configuration/speed). On an API key alone an Ultrafast one runs on the
    // `ultrafast` tier, which its own feature turns on and our catalog lists.
    ["features.fast_mode", "true"],
    ...(auth.kind === CODEX_AUTH.API_KEY ? ([["features.ultrafast_mode", "true"]] as const) : []),
    ["model_catalog_json", toml(auth.catalog)],
  ];
}

/** The sandbox every turn runs under, as `turn/start`'s documented `sandboxPolicy`: none of Codex's own. */
const SANDBOX_POLICY = { type: "dangerFullAccess" } as const satisfies SandboxPolicy;

/** The sandbox mode a thread is started and resumed under, as app-server's config names `SANDBOX_POLICY`. */
const SANDBOX_MODE = "danger-full-access";

/**
 * App-server's argv: our provider and its credential where the launch
 * runs on one of ours (`providerOverrides`), our MCP
 * server and each integration's beside it with the bearer read from the environment and their tools approved up
 * front (under `approval_policy = "never"` Codex 0.163.0 otherwise fails
 * every MCP call, as P16 found) and given as long as the service runs a call, no
 * sandbox (`SANDBOX_MODE`), and commands inheriting the core variables
 * without the bearer or the key, and handed the image's tools' own
 * (`SANDBOX_TOOL_ENV`). Nothing in argv is secret.
 */
function appServerArgs(config: CodexConfig, auth: CodexAuth): string[] {
  const mcp = `mcp_servers.${MCP_SERVER}`;
  // Each integration the agent is handed is a server of its own on the same bearer, its tools approved and bounded as ours are.
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
    ...featureOverrides(auth),
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
    // Note that the image's tools are set apart, since a command inherits only the core variables.
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
  /** The service's lines this launch has said app-server took, each said once. */
  readonly accepted: Set<string>;
  /** The credential app-server runs on. */
  readonly auth: CodexAuth;
  model: string;
  effort: CodexEffort | undefined;
  /** The service tier the next turn names (`turnTierOf`); null for the standard one. */
  tier: ServiceTier | null;
  stopping: boolean;
  /** Whether the launch is warm: its turn completed with nothing left, an IDLE posted, and no message taken since. */
  warm: boolean;
  /** The thread's rollout as the store mirrors it, where the config names the store. */
  readonly mirror: RolloutMirror | undefined;
}

/**
 * The service tier a turn of the launch names: the one asked for, but on the
 * plan, which hands Codex no catalog listing Ultrafast, the fast tier for an
 * Ultrafast version, as a runner from before Ultrafast runs it, rather than
 * a tier Codex would drop for the standard one.
 */
function turnTierOf(launch: Pick<CodexLaunch, "auth" | "tier">): ServiceTier | null {
  return launch.tier === SERVICE_TIER.ULTRAFAST && launch.auth.kind !== CODEX_AUTH.API_KEY
    ? SERVICE_TIER.FAST
    : launch.tier;
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

/**
 * The plan's tokens as Codex's sign-in on host-supplied tokens takes them,
 * the service's answer passed on as it came. Codex is told no plan type,
 * which it takes as optional.
 */
const planTokens = (
  tokenUrl: string,
  bearer: LaunchContext<CodexConfig>["bearer"],
): Effect.Effect<ChatgptAuthTokensRefreshResponse, CodexTokenFailed, HttpClient.HttpClient> =>
  Effect.map(
    askPlanTokens(tokenUrl, bearer),
    // SAFETY: the workspace goes to app-server as the service named it; where it named none, app-server refuses the request.
    (answer) => ({ ...answer, chatgptPlanType: null }) as ChatgptAuthTokensRefreshResponse,
  );

/**
 * What app-server reports, posted in order and turned into the controller's
 * signals; and on host-supplied tokens, its ask for fresh ones after a 401,
 * answered with the service's (`refresh`).
 */
function listenerFor(
  seen: ThreadSeen,
  refresh: Effect.Effect<ChatgptAuthTokensRefreshResponse, CodexTokenFailed> | undefined,
): AppServerListener {
  return {
    onRequest: (method) =>
      method === METHOD.CHATGPT_AUTH_TOKENS_REFRESH && refresh !== undefined
        ? refresh.pipe(
            Effect.mapError((failure) => new AppServerRequestFailed({ detail: failure.detail })),
          )
        : undefined,
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
 * `thread/fork` where the thread is another agent's, `thread/resume` where
 * there is a thread to continue, `thread/start` otherwise. Answers the
 * server, its scope, the thread's id, and its rollout's path where
 * app-server named one.
 */
const openAppServer = Effect.fn("agent-runner/openAppServer")(function* (
  launch: Pick<CodexLaunch, "context" | "signals" | "model" | "auth">,
  threadId: string | undefined,
  fork: boolean,
) {
  const { config, env, bearer } = launch.context;
  const { auth } = launch;
  const serverScope = yield* Scope.make();
  const client = yield* HttpClient.HttpClient;
  // Note that the tokens are asked for on the launch's own client, since app-server's ask is answered on the reader's fiber.
  const tokens =
    auth.kind === CODEX_AUTH.CHATGPT_TOKENS
      ? planTokens(auth.tokenUrl, bearer).pipe(Effect.provideService(HttpClient.HttpClient, client))
      : undefined;
  // Note that the listener reads the thread's id from here, because a new
  // thread's notifications arrive before `thread/start` answers.
  const seen: ThreadSeen = {
    context: launch.context,
    signals: launch.signals,
    threadId: fork ? undefined : threadId,
  };
  const server = yield* spawnAppServer(
    {
      executable: config.executable,
      args: appServerArgs(config, launch.auth),
      cwd: config.cwd,
      // Note that Claude Code's credentials, were they set, are no business of Codex's.
      env: {
        ...env,
        PATH: pathWithCodexTools(config.executable, env.PATH),
        [RUNNER_ENV.CLAUDE_TOKEN]: undefined,
        [RUNNER_ENV.API_KEY]: undefined,
      },
      inRunnerGroup: runsOnHost(env),
    },
    listenerFor(seen, tokens),
  ).pipe(Scope.provide(serverScope));
  const opened = Effect.gen(function* () {
    // Note that the sign-in on host-supplied tokens is experimental, which app-server serves only to a client that opted in.
    yield* server.request(METHOD.INITIALIZE, {
      clientInfo: CLIENT_INFO,
      capabilities:
        tokens === undefined ? null : { experimentalApi: true, requestAttestation: false },
    });
    yield* server.notify(METHOD.INITIALIZED);
    if (tokens !== undefined) {
      const signedIn = yield* tokens.pipe(
        Effect.mapError(
          (failure) =>
            new AppServerError({ method: METHOD.ACCOUNT_LOGIN_START, detail: failure.detail }),
        ),
      );
      yield* server.request(METHOD.ACCOUNT_LOGIN_START, {
        type: "chatgptAuthTokens",
        ...signedIn,
      });
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
      sandbox: SANDBOX_MODE,
      developerInstructions: config.developerInstructions,
    } satisfies ThreadStartParams;
    const answer =
      threadId === undefined
        ? yield* server.request(METHOD.THREAD_START, thread)
        : fork
          ? yield* server.request(METHOD.THREAD_FORK, { ...thread, threadId, excludeTurns: true })
          : yield* server.request(METHOD.THREAD_RESUME, {
              ...thread,
              threadId,
              excludeTurns: true,
            });
    const opened = decodeThreadAnswer(answer);
    if (Option.isNone(opened)) {
      return yield* new AppServerError({
        method: METHOD.THREAD_START,
        detail: "no thread in the answer",
      });
    }
    seen.threadId = opened.value.thread.id;
    return opened.value.thread;
  });
  const openedThread = yield* opened.pipe(
    Effect.tapError(() => Scope.close(serverScope, Exit.void)),
  );
  return { server, serverScope, threadId: openedThread.id, path: openedThread.path ?? undefined };
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
 * Says each of the service's lines a message carries was taken by app-server, as
 * Claude Code's launch says a line was handed to the SDK, so the service ties the
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
      sandboxPolicy: SANDBOX_POLICY,
      // Note that a null tier is the standard one, which a fast or Ultrafast version turned off goes back to.
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

/** One of the service's lines, acted on; answers the launch's outcome where the line ends it. */
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
      // Note that our id for the line is the id Codex echoes, so a turn that takes it names it.
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
      // Note that a line naming either speed key says both, the one it leaves out being off.
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

/** The rollout's new lines sent to the store, where the launch mirrors it; one the store did not take goes with the next. */
function mirrored(launch: Pick<CodexLaunch, "mirror">) {
  if (launch.mirror === undefined) return Effect.void;
  return mirrorRollout(launch.mirror).pipe(
    Effect.catch(() => Effect.logWarning("agent-runner: the rollout was not mirrored")),
  );
}

/** The turn this launch ran completed: the launch ends, or its unanswered messages start the next turn. */
const takeTurnCompleted = Effect.fn("agent-runner/codex/takeTurnCompleted")(function* (
  launch: CodexLaunch,
  signal: Extract<Signal, { kind: typeof SIGNAL.TURN_COMPLETED }>,
) {
  if (signal.turnId !== launch.turnId) return undefined;
  launch.turnId = undefined;
  yield* mirrored(launch);
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
  // What the service wrote before the turn completed, still queued behind the
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
  // The agent's turn is over: the launch stays warm for the service's next message
  // rather than ending.
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

const decodePlanBackend = Schema.decodeUnknownOption(
  Schema.Literals(Object.values(CODEX_PLAN_BACKEND)),
);

/**
 * The backend the plan's token is sent to, as the launch's starter named it:
 * OpenAI's API where it named none; none where it named one this runner
 * does not know.
 */
function planBackendOf(context: LaunchContext<CodexConfig>): CodexPlanBackend | undefined {
  const named = context.env[RUNNER_ENV.CODEX_PLAN_BACKEND];
  if (named === undefined || named === "") return CODEX_PLAN_BACKEND.OPENAI_API;
  return Option.getOrUndefined(decodePlanBackend(named));
}

/**
 * The credential a launch's app-server runs on, with the catalog written for
 * it: the account's API key where the environment holds it; otherwise the
 * plan, in the cloud's sandbox on host-supplied tokens, and on a host through
 * its token command, on the backend given, where the runner knows its own
 * bundle, and none where it does not.
 */
const authOf = Effect.fn("agent-runner/codexAuthOf")(function* (
  context: LaunchContext<CodexConfig>,
  backend: CodexPlanBackend,
) {
  if (onApiKey(context)) {
    return { kind: CODEX_AUTH.API_KEY, catalog: yield* catalogFile(ultrafastCatalog()) } as const;
  }
  if (!runsOnHost(context.env)) {
    return {
      kind: CODEX_AUTH.CHATGPT_TOKENS,
      tokenUrl: context.config.tokenUrl,
      catalog: yield* catalogFile(planCatalog()),
    } as const;
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
  // A thread resumed or forked has its rollout written back where the sandbox no longer holds it.
  const codexHome = context.env.CODEX_HOME;
  const store =
    config.transcriptsUrl === undefined || codexHome === undefined
      ? undefined
      : { store: transcriptStore(config.transcriptsUrl, context.bearer), codexHome };
  if (store !== undefined && config.threadId !== undefined) {
    const restored = yield* restoreRollouts(store.store, store.codexHome, config.threadId).pipe(
      Effect.result,
    );
    if (restored._tag === "Failure") {
      return ended(RUNNER_END.FAILED, "the thread's rollout could not be read from the service");
    }
  }
  const opened = yield* openAppServer(
    { context, signals, model: config.model, auth },
    config.threadId,
    config.fork === true,
  ).pipe(Effect.result);
  if (opened._tag === "Failure") {
    return ended(RUNNER_END.FAILED, `${opened.failure.method}: ${opened.failure.detail}`);
  }
  const { path, ...server } = opened.success;
  const mirror =
    store === undefined || path === undefined
      ? undefined
      : yield* openRolloutMirror(store.store, store.codexHome, server.threadId, path).pipe(
          Effect.option,
          Effect.map(Option.getOrUndefined),
        );
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
    ...server,
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
    mirror,
  };

  // The service's lines join the signals in a loop of their own, so a line is
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
  yield* mirrored(launch);
  return outcome;
});
