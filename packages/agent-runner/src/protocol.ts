/**
 * protocol.ts -- what the service and the runner say to each other: the config line, the later stdin lines, the events the runner posts, and the environment it reads its secrets from.
 *
 * This is the runner's whole contract, held apart from the Agent SDK so the
 * service that launches the runner (P08) and the route that takes its events
 * (P09) import it without the SDK behind it. Every line on stdin is one JSON
 * object: the first is the config, each later one a message, a stop, a model
 * change, or a retire. A config that names `linesUrl` has the runner read
 * the later lines from the service instead (`RUNNER_LINES`).
 *
 * The config says which harness the launch runs: Claude Code (P05), or Codex
 * through `codex app-server` (P20). Secrets never travel in argv or on
 * stdin: the runner's bearer and the harness's credential are in its
 * environment. Codex's ChatGPT access token is never handed in at all: the
 * runner asks the service for each over HTTPS (`codex-token.ts`), on a host
 * through its token command and in the cloud's sandbox as it signs
 * app-server in, so no line carries one, on a Mac's queue
 * (`@repo/features/device-agent-wire`) or anywhere else.
 */

import type {
  BackgroundTaskSummary,
  SDKMessage,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";
import { Option, Schema } from "effect";
import type { ServerNotification } from "./codex-protocol/index.js";

/**
 * The environment the runner reads. The bearer authenticates it to the service, its
 * events and its MCP server alike; in a sandbox it is a placeholder, which the
 * sandbox's firewall swaps for the bearer on the service's host, and the runner
 * presents it as it would the bearer, handing it to neither the CLI nor a
 * command Codex runs. The plan token is never read by the runner itself: the
 * CLI it launches inherits it, as does every command the CLI runs, since no
 * command sandbox stands between them. An Anthropic API key
 * stands in its place for an agent the account's key pays for. In a sandbox
 * either is a placeholder minted for the launch, which the sandbox's firewall
 * swaps for the real one on Anthropic's API, so neither enters the sandbox;
 * on a host it is the credential itself. Codex's token is never in it: the
 * runner asks the service for it, on a host through its token command and in
 * the cloud's sandbox as it signs app-server in (`codex-token.ts`). An OpenAI
 * API key in the sandbox is a placeholder, swapped for the real one at the
 * sandbox's firewall, as Anthropic's are.
 */
export const RUNNER_ENV = {
  BEARER: "APP_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
  /**
   * The account's Anthropic API key, in the plan token's place for an agent
   * its key pays for: the CLI's documented variable
   * (https://code.claude.com/docs/en/agent-sdk/quickstart), on the same terms.
   */
  API_KEY: "ANTHROPIC_API_KEY",
  /**
   * The account's OpenAI API key, for a Codex launch its key pays for: the
   * variable app-server's provider names as its `env_key`
   * (https://developers.openai.com/codex/config-advanced/), which no command
   * Codex runs inherits.
   */
  OPENAI_API_KEY: "OPENAI_API_KEY",
  /**
   * Which backend a host's Codex launch on the plan sends its requests to
   * (`CODEX_PLAN_BACKEND`): set where the plan was connected through Codex's
   * own device-code login, whose token only Codex's ChatGPT backend accepts,
   * and unset for OpenAI's API, where a third-party sign-in's token goes.
   */
  CODEX_PLAN_BACKEND: "APP_CODEX_PLAN_BACKEND",
  /**
   * The ChatGPT workspace a host's device-code plan pays from, which Codex's
   * ChatGPT backend reads from the account header of each request; unset
   * where the plan's ID token named none. A workspace id is no secret.
   */
  CHATGPT_ACCOUNT_ID: "APP_CHATGPT_ACCOUNT_ID",
  /**
   * Where the runner runs, where its starter says (`RUNNER_PLACE`): set by a
   * host's daemon alone, on a Linux box and a Mac alike, This Mac's among
   * them, and unset in the cloud's sandbox.
   */
  PLACE: "APP_RUNNER_PLACE",
} as const;

/**
 * The backends a host's Codex launch on the plan sends its requests to, as its
 * starter names one in `RUNNER_ENV.CODEX_PLAN_BACKEND`: OpenAI's API, for a
 * token a third-party sign-in was issued, or Codex's ChatGPT backend, for
 * one Codex's own device-code login was issued.
 */
export const CODEX_PLAN_BACKEND = {
  OPENAI_API: "openai_api",
  CHATGPT: "chatgpt",
} as const;

export type CodexPlanBackend = (typeof CODEX_PLAN_BACKEND)[keyof typeof CODEX_PLAN_BACKEND];

/** The places a runner's starter names in `RUNNER_ENV.PLACE`. */
export const RUNNER_PLACE = {
  /**
   * A machine its member runs our host on, a Linux box or a Mac, with
   * nobody signed in at it, where each launch runs straight on the box as
   * the host's own user, with full access to what that user reaches, beside
   * the box's other processes, which the runner tells its agent's from by
   * descent (`host-processes.ts`). No harness runs a sandbox of its own or
   * asks an approval there, as in the cloud's sandbox: Claude Code under
   * `bypassPermissions`, and Codex in `danger-full-access` with approval
   * `never`.
   */
  HOST: "host",
} as const;

/**
 * How the folder of the skills a member installed into the app is laid out,
 * which the service writes into the sandbox as it opens and a config line names
 * (`installedSkills`): a Claude Code local plugin, its manifest naming it,
 * whose `skills/` holds one folder per skill, `SKILL.md` and its files, and
 * which is Codex's extra skills root as it stands. Claude Code lists a
 * plugin's skill as `<plugin>:<name>`.
 */
export const INSTALLED_SKILLS = {
  /** The folder of skill folders, under the installed folder. */
  SKILLS: "skills",
  /** The plugin's manifest, under the installed folder. */
  MANIFEST: ".claude-plugin/plugin.json",
  /** The plugin's name, which leads each of its skills' names in Claude Code. */
  PLUGIN: "workspace",
} as const;

/**
 * Claude Code's built-in tools a launch adds to and takes from the CLI's
 * default set, by the names the CLI gives them, which our prompt names in
 * turn. Note that CLI 2.1.304's default set holds neither Glob, Grep, nor a
 * to-do tool (TaskCreate and its siblings replaced TodoWrite), so each is
 * listed to be offered; and that a tool beside one of our own, or one no
 * headless agent can use, is denied, so the agent has one way to do each
 * thing. SendMessage stays, because the Agent tool continues a subagent
 * with it.
 */
export const CLAUDE_CODE_TOOLS = {
  ADDED: ["Glob", "Grep", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet"],
  DENIED: [
    "ListAgents",
    "CronCreate",
    "CronDelete",
    "CronList",
    "RemoteTrigger",
    "PushNotification",
    "AskUserQuestion",
  ],
} as const;

/** The read-only subagent a Claude Code launch defines, by the `subagent_type` the Agent tool takes. */
export const CLAUDE_CODE_WORKER = "worker";

/** The harness a launch runs, spelled as `conversations.runtime` spells it. */
export const RUNNER_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;
export type RunnerHarness = (typeof RUNNER_HARNESS)[keyof typeof RUNNER_HARNESS];

/**
 * How a message reached its runner, as the launch's trace names it: a place
 * created from its source agent's snapshot, its repository's base snapshot,
 * or the agents' image; one resumed from its own snapshot; the runner
 * launched again in a place still up; a place made anew where the one found
 * was gone; or a runner already up. The last four are spelled as the
 * service's hand-off event spells them (`SERVER_HANDOFF_PATH`).
 */
export const LAUNCH_PATH = {
  SOURCE_SNAPSHOT: "source_snapshot",
  BASE_SNAPSHOT: "base_snapshot",
  IMAGE: "image",
  RESUMED: "resumed",
  RELAUNCHED: "relaunched",
  FRESH: "fresh",
  WARM: "warm",
} as const;
export type LaunchPath = (typeof LAUNCH_PATH)[keyof typeof LAUNCH_PATH];

/** The reasoning efforts the pinned SDK takes, as its `EffortLevel` spells them. */
export const EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const;
export type Effort = (typeof EFFORT)[keyof typeof EFFORT];
const EffortSchema = Schema.Literals(Object.values(EFFORT));

/**
 * The reasoning efforts Codex takes (its `model_reasoning_effort`); the pinned
 * protocol types them as any string, so the runner holds the service to these.
 */
export const CODEX_EFFORT = {
  NONE: "none",
  MINIMAL: "minimal",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
} as const;
export type CodexEffort = (typeof CODEX_EFFORT)[keyof typeof CODEX_EFFORT];
const CodexEffortSchema = Schema.Literals(Object.values(CODEX_EFFORT));

/** The line types a stdin line after the config may carry. */
export const INPUT_LINE = {
  MESSAGE: "message",
  STOP: "stop",
  MODEL: "model",
  RETIRE: "retire",
} as const;

/**
 * The argument that starts the runner's bundle as a host's Codex token command
 * rather than as a launch: `node <bundle> codex-token <tokenUrl>`, which prints
 * the plan's access token the service answers, and nothing else, on stdout.
 */
export const CODEX_TOKEN_COMMAND = "codex-token";

/**
 * What the service's token route answers a runner: the plan's access token,
 * good for at least the route's margin, and the ChatGPT workspace it pays
 * from, which the route names for every runner in the cloud's sandbox, as
 * Codex's sign-in on host-supplied tokens takes it, and for one on a host
 * where the plan named one.
 */
export const RunnerTokenAnswerSchema = Schema.Struct({
  accessToken: Schema.String,
  chatgptAccountId: Schema.optionalKey(Schema.String),
});
export type RunnerTokenAnswer = typeof RunnerTokenAnswerSchema.Type;

/**
 * How a runner reads the service's lines past its config where its config names
 * `linesUrl`, rather than taking them on its stdin, so a line stands at
 * the service until the runner says it took it: a GET under the runner's bearer
 * naming the launch by its first event number and the place of the last
 * line it read, which the service holds open until a line past it is queued or the
 * hold ends, answering the lines past it in order, none at the hold's end.
 * A message line the runner takes it says it took by its ACCEPTED event, as
 * ever; any other line is read once the next read names a place past it.
 * The launch is handed, beside its own, the message lines an earlier launch
 * never took, so a launch that ended before taking one hands it on.
 */
export const RUNNER_LINES = {
  /** The query's names: the launch's first event number, and the place of the last line read. */
  QUERY: { LAUNCH: "launch", AFTER: "after" },
  /** How long the service holds a read with nothing past its place, as it holds a device's. */
  HOLD_MS: 20 * 1_000,
} as const;

const LinePlaceSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

/** What the service answers a read of the runner's lines: the lines past its place, in order, each with its own place. */
export const RunnerLinesAnswerSchema = Schema.Struct({
  lines: Schema.Array(Schema.Struct({ seq: LinePlaceSchema, text: Schema.String })),
});
export type RunnerLinesAnswer = typeof RunnerLinesAnswerSchema.Type;

/**
 * How a runner keeps its CLI's transcript at the service where its config
 * names `transcriptsUrl`: Anthropic's reference `SessionStore`'s five calls
 * (the Agent SDK's `append`, `load`, `listSessions`, `delete`,
 * `listSubkeys`), each one POST under the runner's bearer, run against the
 * agent's own rows.
 */
export const RUNNER_TRANSCRIPTS = {
  CALL: {
    APPEND: "append",
    LOAD: "load",
    LIST_SESSIONS: "listSessions",
    DELETE: "delete",
    LIST_SUBKEYS: "listSubkeys",
  },
} as const;

/** The SDK's `SessionKey`: a project, a session, and a subpath, absent for the main transcript. */
const TranscriptKeySchema = Schema.Struct({
  projectKey: Schema.String,
  sessionId: Schema.String,
  subpath: Schema.optionalKey(Schema.String),
});

/** One transcript line, opaque but for its `type`, as the SDK's `SessionStoreEntry` is. */
const TranscriptEntrySchema = Schema.Record(Schema.String, Schema.Unknown);

/** One call of a runner's transcript store. */
export const RunnerTranscriptCallSchema = Schema.Union([
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.APPEND),
    key: TranscriptKeySchema,
    entries: Schema.Array(TranscriptEntrySchema),
  }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LOAD),
    key: TranscriptKeySchema,
  }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LIST_SESSIONS),
    projectKey: Schema.String,
  }),
  Schema.Struct({ call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.DELETE), key: TranscriptKeySchema }),
  Schema.Struct({
    call: Schema.Literal(RUNNER_TRANSCRIPTS.CALL.LIST_SUBKEYS),
    key: Schema.Struct({ projectKey: Schema.String, sessionId: Schema.String }),
  }),
]);
export type RunnerTranscriptCall = typeof RunnerTranscriptCallSchema.Type;

/** What a load is answered: the whole transcript, none where it was never written. */
export const RunnerTranscriptLoadSchema = Schema.Struct({
  entries: Schema.NullOr(Schema.Array(TranscriptEntrySchema)),
});
export type RunnerTranscriptLoad = typeof RunnerTranscriptLoadSchema.Type;

/** What a listing of a project's sessions is answered: each with its last append, in epoch milliseconds. */
export const RunnerTranscriptSessionsSchema = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String, mtime: Schema.Number })),
});
export type RunnerTranscriptSessions = typeof RunnerTranscriptSessionsSchema.Type;

/** What a listing of a session's subkeys is answered. */
export const RunnerTranscriptSubkeysSchema = Schema.Struct({
  subkeys: Schema.Array(Schema.String),
});
export type RunnerTranscriptSubkeys = typeof RunnerTranscriptSubkeysSchema.Type;

/** The image types the Messages API takes in a base64 image block. */
export const IMAGE_MEDIA_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
} as const;

/**
 * The largest first number a launch takes: a safe integer with room above it
 * for every event a launch could post, so each next number is exact.
 */
const SEQUENCE_MAX = 2 ** 52;

/**
 * One integration the agent is handed, as an MCP server of its own at the service,
 * reached under the runner's bearer as our own MCP server is: the
 * connection's name (`linear`, `notion-2`), which the server is registered
 * under and its tools are named by, and its endpoint. The name is a bare
 * word, so it stands as a TOML key in Codex's config and in Claude Code's
 * `mcp__<server>__<tool>` as written.
 */
const IntegrationServerSchema = Schema.Struct({
  name: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/)),
  url: Schema.String,
});
export type IntegrationServer = typeof IntegrationServerSchema.Type;

const SequenceSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(SEQUENCE_MAX),
);

/**
 * What a launch in the cloud's sandbox is handed to trace its startup in the
 * launch's own Sentry trace (`trace.ts`): the service's DSN, environment and
 * release, the launch span's `sentry-trace` and `baggage`, and the launch's
 * path as `LAUNCH_PATH` spells it. A host's launch is handed none, and its
 * runner sends Sentry nothing. A DSN is the project's public address for
 * sending to it, no secret. The path is read as any word, so a path the
 * service names later never fails an older runner's config.
 */
const RunnerTraceSchema = Schema.Struct({
  dsn: Schema.String,
  environment: Schema.String,
  release: Schema.optionalKey(Schema.String),
  sentryTrace: Schema.String,
  baggage: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
});
export type RunnerTrace = typeof RunnerTraceSchema.Type;

/**
 * The first stdin line of a Claude Code launch: everything one launch of the CLI is started with.
 * `executable` is the `claude` binary the image carries, because the bundled
 * SDK cannot find its own platform package. `firstSequence` is where this
 * launch's events are numbered from, one past the last event the service applied, so
 * a relaunch with `resume` goes on numbering where the last launch stopped.
 */
export const ClaudeCodeConfigSchema = Schema.Struct({
  /** Absent in a config written before Codex mode, which is Claude Code's. */
  harness: Schema.optionalKey(Schema.Literal(RUNNER_HARNESS.CLAUDE_CODE)),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(EffortSchema),
  /** Whether Claude Code's own fast mode is on, for an agent on a model's fast version. */
  fast: Schema.optionalKey(Schema.Boolean),
  /** Our coder instructions, appended to Claude Code's own system prompt. */
  append: Schema.String,
  /** The CLI's session id to resume, where this launch continues one. */
  resume: Schema.optionalKey(Schema.String),
  /** The service's id of a prompt a rewind dropped: the resumed session is cut just before it, and resumed whole where it holds no such prompt. */
  rewindBefore: Schema.optionalKey(Schema.String),
  /** Whether the session resumed is another agent's, which a continued or forked agent forks as its own (the SDK's `forkSession`). */
  fork: Schema.optionalKey(Schema.Boolean),
  firstSequence: SequenceSchema,
  /** Where the runner posts its events. */
  eventsUrl: Schema.String,
  /** Where the runner reads the service's lines past its config, in place of its stdin (`RUNNER_LINES`); none where the service writes them to its stdin. */
  linesUrl: Schema.optionalKey(Schema.String),
  /** Our MCP server's streamable-HTTP endpoint. */
  mcpUrl: Schema.String,
  /** Where the CLI's transcript is kept at the service (`RUNNER_TRANSCRIPTS`), handed to the SDK as its `sessionStore`; none where the CLI's own files are all it keeps. */
  transcriptsUrl: Schema.optionalKey(Schema.String),
  /** The integrations the agent is handed, one MCP server each; none in a config written before them. */
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  /**
   * Read by no runner since Claude Code's command sandbox went: written empty
   * for a host whose release bundles a runner from before, which refuses a
   * config without it, and dropped once the service's host version floor
   * (`HOST_VERSION.FLOOR`) passes that release.
   */
  allowedDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Where the member's installed skills are (`INSTALLED_SKILLS`), loaded as a local plugin where the folder holds one. */
  installedSkills: Schema.optionalKey(Schema.String),
  /** Whether the launch stays warm while no turn of it runs (`RUNNER_WARM`): from its start until a message comes, and once the agent's turn is over, posting IDLE rather than ending; it ends there where absent. */
  warm: Schema.optionalKey(Schema.Boolean),
  /** Where the launch's startup is traced in Sentry (`RunnerTrace`); none where it is not, as on a host, and in a config written before it. */
  trace: Schema.optionalKey(RunnerTraceSchema),
});
export type ClaudeCodeConfig = typeof ClaudeCodeConfigSchema.Type;

/**
 * The first stdin line of a Codex launch. `executable` is the `codex` binary
 * the image carries (P17); `CODEX_HOME`, where Codex keeps its threads, comes
 * from the launch's environment and must exist before the runner starts.
 * `threadId` is the thread to resume, where this launch continues one; a new
 * thread's id reaches the service in its `thread/started` notification.
 */
export const CodexConfigSchema = Schema.Struct({
  harness: Schema.Literal(RUNNER_HARNESS.CODEX),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(CodexEffortSchema),
  /**
   * Whether the agent runs its model's fast version: Codex's documented
   * `fast` service tier (the API's `priority`), which a launch on an OpenAI
   * API key alone asks for; the plan's launch runs none.
   */
  fast: Schema.optionalKey(Schema.Boolean),
  /**
   * Whether the agent runs its model's Ultrafast version: Codex's
   * `ultrafast` service tier, which a launch on an OpenAI API key alone asks
   * for, over `fast`. The service sends `fast` beside it, so a runner from
   * before this key, a Mac's or a host's among them, runs the fast tier
   * rather than the standard one.
   */
  ultrafast: Schema.optionalKey(Schema.Boolean),
  /** Our coder instructions, as the thread's `developer_instructions`. */
  developerInstructions: Schema.String,
  threadId: Schema.optionalKey(Schema.String),
  /** The service's id of a message a rewind dropped: the resumed thread is reverted to before the turn that took it, and resumed whole where none did. */
  rewindBefore: Schema.optionalKey(Schema.String),
  /** Whether the thread is another agent's, which a continued or forked agent forks as its own (`thread/fork`). */
  fork: Schema.optionalKey(Schema.Boolean),
  firstSequence: SequenceSchema,
  eventsUrl: Schema.String,
  /** Where the runner reads the service's lines past its config (`RUNNER_LINES`); none where the service writes them to its stdin. */
  linesUrl: Schema.optionalKey(Schema.String),
  mcpUrl: Schema.String,
  /** Where Codex's rollout is kept at the service (`RUNNER_TRANSCRIPTS`), mirrored as Codex writes it and written back to `CODEX_HOME` where it is missing; none where Codex's own files are all it keeps. */
  transcriptsUrl: Schema.optionalKey(Schema.String),
  /** The integrations the agent is handed, one MCP server each; none in a config written before them. */
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  /**
   * Where the runner asks the service for the plan's access token, under its bearer
   * (`/api/agents/runner-token`). App-server takes its token from the
   * runner's `codex-token` command (Codex's provider `auth`), which Codex runs
   * again as its cached token ages and after a 401, so a turn outlives any
   * one token. Not asked where the launch's environment holds
   * `OPENAI_API_KEY`: the account's API key pays, and app-server reads it.
   */
  tokenUrl: Schema.String,
  /** Where the member's installed skills are (`INSTALLED_SKILLS`), whose `skills/` is set as an extra skills root where it is there. */
  installedSkills: Schema.optionalKey(Schema.String),
  /** Whether the launch stays warm while no turn of it runs (`RUNNER_WARM`): from its start until a message comes, and once the agent's turn is over, posting IDLE rather than ending; it ends there where absent. */
  warm: Schema.optionalKey(Schema.Boolean),
  /** Where the launch's startup is traced in Sentry (`RunnerTrace`); none where it is not, as on a host, and in a config written before it. */
  trace: Schema.optionalKey(RunnerTraceSchema),
});
export type CodexConfig = typeof CodexConfigSchema.Type;

/** The first stdin line, for either harness. */
export const RunnerConfigSchema = Schema.Union([CodexConfigSchema, ClaudeCodeConfigSchema]);
export type RunnerConfig = typeof RunnerConfigSchema.Type;

const TextBlockSchema = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String });
const ImageBlockSchema = Schema.Struct({
  type: Schema.Literal("image"),
  source: Schema.Struct({
    type: Schema.Literal("base64"),
    media_type: Schema.Literals(Object.values(IMAGE_MEDIA_TYPE)),
    data: Schema.String,
  }),
});
export const ContentBlockSchema = Schema.Union([TextBlockSchema, ImageBlockSchema]);
export type ContentBlock = typeof ContentBlockSchema.Type;

/** A UUID as the SDK spells one, which is what a message's `uuid` must be. */
const UuidSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

/**
 * A message for the session, in the Messages API's own block shapes. `uuid`
 * is the service's id for the message, handed to the SDK as the prompt's own, so
 * the ACCEPTED event and the `result` that answers it name it; the runner
 * mints one where a line names none.
 */
const MessageLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MESSAGE),
  uuid: Schema.optionalKey(UuidSchema),
  content: Schema.Array(ContentBlockSchema),
});
/**
 * Stop the running turn. `launch` names the launch the stop is for by its
 * first event number (its config's `firstSequence`): one launch runs one of
 * the service's turns, so a stop the service meant for an earlier launch's
 * turn, delayed past it, is skipped by the launch that replaced it rather than
 * interrupting its turn. A stop that names none is taken by any launch.
 */
const StopLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.STOP),
  launch: Schema.optionalKey(SequenceSchema),
});
/**
 * A model or effort change, applied from the next model call on Claude Code
 * and from the next turn on Codex. An effort the launch's harness does not
 * take is skipped. `fast` turns Claude Code's own fast mode on or off, and
 * Codex's `fast` service tier on an API key from its next turn, and
 * `ultrafast` Codex's `ultrafast` tier over it, absent where off; Codex on
 * the plan skips both, and Claude Code `ultrafast`.
 */
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.Union([EffortSchema, CodexEffortSchema])),
  fast: Schema.optionalKey(Schema.Boolean),
  ultrafast: Schema.optionalKey(Schema.Boolean),
});

/**
 * End the launch if it is warm: its turn over, nothing in flight, no
 * message of the service's unanswered, and no turn of the CLI's own begun since.
 * The service writes it once a warm launch has idled past its window
 * (`coder-host/runner-sessions.ts`'s `retireWarmRunner`), and a launch in
 * any other state skips it, so a message the service wrote ahead of it on the same
 * stdin always wins.
 */
const RetireLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.RETIRE),
});

export const InputLineSchema = Schema.Union([
  MessageLineSchema,
  StopLineSchema,
  ModelLineSchema,
  RetireLineSchema,
]);
export type InputLine = typeof InputLineSchema.Type;

/**
 * The runner's own events, numbered among the SDK's messages, each a `type`
 * the SDK never uses.
 *
 * ACCEPTED is posted as a message line is handed to the SDK, naming the
 * message's `uuid`, so the service ties the message it sent to the turn that runs
 * it: the CLI never echoes a prompt back. WAITING follows a `result` the run
 * outlives, because the Stop hook before it reported background work or a
 * scheduled wakeup still to come: the agent is waiting, not done, and the
 * sandbox must stay up. IDLE follows a `result`, or Codex's
 * `turn/completed`, that leaves nothing in flight or unanswered: the agent's
 * turn is over, as a `turn_ended` END says, but the launch stays warm
 * (`RUNNER_WARM`), so the service's next message is a line on its stdin rather than
 * a resumed sandbox and a relaunched CLI. END is the last event a launch
 * posts, with why it ended.
 */
export const RUNNER_EVENT = {
  ACCEPTED: "vespin_runner_accepted",
  WAITING: "vespin_runner_waiting",
  IDLE: "vespin_runner_idle",
  END: "vespin_runner_end",
} as const;

/** Why a launch ended. */
export const RUNNER_END = {
  /** A `result`, or Codex's `turn/completed`, with nothing left in flight or unanswered: the agent's turn is over. */
  TURN_ENDED: "turn_ended",
  /** A `result`, or an interrupted turn, after a stop: the turn was stopped. */
  STOPPED: "stopped",
  /** The service closed stdin, or the CLI ended its stream, before a turn ended. */
  INPUT_CLOSED: "input_closed",
  /** The CLI or app-server failed, or Codex's turn did; the turn shows as failed, and the next message relaunches with `resume`. */
  FAILED: "failed",
  /**
   * A wait released (`RUNNER_RELEASE`): the agent waited on wakeups alone,
   * with no process of its own still running, so the launch ended for its
   * sandbox to stop; the END names the wakeups for the service to deliver as they
   * come due. The turn is over, as a `turn_ended` one is.
   */
  RELEASED: "released",
  /** A warm launch ended with no turn under way: retired by the service past its window, or past `RUNNER_WARM.IDLE_CAP_MS` on its own. Its turn was already over at its IDLE, or it never took a message. */
  IDLED: "idled",
} as const;
export type RunnerEnd = (typeof RUNNER_END)[keyof typeof RUNNER_END];

/**
 * How long a warm launch waits on its own. The service retires a warm launch once
 * it idled past its window (`CODER.RUNNER_WARM`), under the runner lease, so
 * no message it writes is lost to the end; this cap is the launch's own
 * bound where the service never does, since the heartbeat keeps its sandbox alive
 * for as long as it runs. A message the service writes in the instant the cap ends
 * the launch stays unaccepted, as one a released wait ends on does.
 */
export const RUNNER_WARM = {
  IDLE_CAP_MS: 60 * 60 * 1_000,
} as const;

/** The IDLE event: the agent's turn is over, and the launch stays warm for the next message. */
export interface RunnerIdle {
  readonly type: typeof RUNNER_EVENT.IDLE;
}

/** The ACCEPTED event: the message line, by its `uuid`, handed to the SDK, or taken by Codex's app-server. */
export interface RunnerAccepted {
  readonly type: typeof RUNNER_EVENT.ACCEPTED;
  readonly uuid: string;
}

/** The WAITING event: what the Stop hook before the `result` reported still in flight, as the SDK spells it. */
export interface RunnerWaiting {
  readonly type: typeof RUNNER_EVENT.WAITING;
  readonly background_tasks: readonly BackgroundTaskSummary[];
  readonly session_crons: readonly SessionCronSummary[];
}

/** A wakeup a released wait left for the service to deliver: the instant it comes due, and the prompt the CLI would have run then. */
export interface RunnerWakeup {
  /** An ISO 8601 instant. */
  readonly at: string;
  readonly prompt: string;
}

/**
 * When a waiting launch is released (`RUNNER_END.RELEASED`). Claude Code
 * fires a session's scheduled tasks only while its CLI runs, and a resumed
 * session restores neither a self-paced wakeup nor a one-shot task whose
 * time has passed (https://code.claude.com/docs/en/scheduled-tasks), so a
 * wait on a wakeup held the CLI, and the 8 GB sandbox under it, up until the
 * wakeup came. A launch waiting on one-shot wakeups alone, with no
 * background task and no process of the agent's still running, is ended
 * instead, and the service delivers each wakeup as a message when it comes due,
 * which relaunches the CLI on the session it resumes. Any launch hands the
 * wakeups back: the service drops what it held, the CLI restores on resume the
 * one-shot tasks the agent made itself, and the agent owns them again.
 */
export const RUNNER_RELEASE = {
  /**
   * How long a wait lasts before it is released, and how far off its
   * earliest wakeup must still be then. Vercel bills a sandbox's memory by
   * the minute it runs, and a released wait costs a stop, a resume, and a
   * relaunch of the CLI, so a wait shorter than two billed minutes is held.
   */
  SETTLE_MS: 2 * 60 * 1_000,
  /** How often a wait not yet released is looked at again, for a process of the agent's that has since ended. */
  RECHECK_MS: 60 * 1_000,
  /**
   * How long a wait on a recurring task is held before it is released all the
   * same. A recurring task's next run is jittered by the CLI and cannot be
   * told from its schedule here, so it is not delivered; the CLI restores it
   * when the session is next resumed (the same page). An hour holds a
   * recurring task that runs at least hourly, since each run starts a new
   * wait and an evenly spaced task's runs keep their spacing (the same
   * page), and bounds a loop nobody stopped. A self-paced loop's pending
   * wakeup is listed as a one-shot task, so it is delivered rather than
   * held.
   */
  IDLE_CAP_MS: 60 * 60 * 1_000,
} as const;

/**
 * How long a launch waits on the CLI's answer to one control request (a
 * model change, an interrupt). The input loop takes the service's lines one at a
 * time and every message goes behind a model line, so a request the CLI
 * never answers would hold every later message and Stop; past this, a model
 * change is let go and an interrupt ends the launch as `STOPPED`. The CLI
 * answers one within a second, and five leaves an interrupt's end inside
 * the bound the service forces a Stop at (`CODER.STOP_CONFIRM`, ten seconds).
 */
export const RUNNER_CONTROL = {
  ANSWER_MS: 5 * 1_000,
} as const;

/** How long a launch holds a message a `result` naming no prompt left unanswered, for the CLI to take it up (`runner.ts`'s `watchUnheard`): five minutes, past the CLI's own retries of a failed model call, which put out no turn output. */
export const RUNNER_UNANSWERED = {
  SILENCE_MS: 5 * 60 * 1_000,
} as const;

/** The END event; `detail` is the CLI's failure, with the launch's secrets taken out, where it failed, and `wakeups` what a released wait left to deliver. */
export interface RunnerEndEvent {
  readonly type: typeof RUNNER_EVENT.END;
  readonly reason: RunnerEnd;
  readonly detail?: string;
  readonly wakeups?: readonly RunnerWakeup[];
}

/**
 * One notification `codex app-server` sent, as it wrote it (the pinned
 * protocol's `ServerNotification`, generated into `codex-protocol/`). Every
 * notification is posted, the thread's subagents' included; the projection
 * (P22) picks what it shows.
 */
export type CodexNotification = ServerNotification;

/**
 * The kinds of `CodexErrorInfo` the pinned protocol names
 * (`codex-protocol/v2/CodexErrorInfo.ts`): a bare word, or the one key of an
 * object that carries its details, such as `activeTurnNotSteerable`'s
 * `turnKind`. A turn's failure and a refused request alike carry one.
 */
export const CODEX_ERROR_INFO = {
  CONTEXT_WINDOW_EXCEEDED: "contextWindowExceeded",
  SESSION_BUDGET_EXCEEDED: "sessionBudgetExceeded",
  USAGE_LIMIT_EXCEEDED: "usageLimitExceeded",
  RATE_LIMIT_EXCEEDED: "rateLimitExceeded",
  FLEX_UNAVAILABLE: "flexUnavailable",
  SERVER_OVERLOADED: "serverOverloaded",
  CYBER_POLICY: "cyberPolicy",
  MISALIGNMENT_POLICY_VIOLATION: "misalignmentPolicyViolation",
  TOO_MANY_DENIALS: "tooManyDenials",
  HTTP_CONNECTION_FAILED: "httpConnectionFailed",
  RESPONSE_STREAM_CONNECTION_FAILED: "responseStreamConnectionFailed",
  INTERNAL_SERVER_ERROR: "internalServerError",
  UNAUTHORIZED: "unauthorized",
  BAD_REQUEST: "badRequest",
  THREAD_ROLLBACK_FAILED: "threadRollbackFailed",
  SANDBOX_ERROR: "sandboxError",
  RESPONSE_STREAM_DISCONNECTED: "responseStreamDisconnected",
  RESPONSE_TOO_MANY_FAILED_ATTEMPTS: "responseTooManyFailedAttempts",
  ACTIVE_TURN_NOT_STEERABLE: "activeTurnNotSteerable",
  OTHER: "other",
} as const;

export type CodexErrorKind = (typeof CODEX_ERROR_INFO)[keyof typeof CODEX_ERROR_INFO];

const CodexErrorKindSchema = Schema.Literals(Object.values(CODEX_ERROR_INFO));
const decodeCodexErrorKind = Schema.decodeUnknownOption(CodexErrorKindSchema);

/**
 * The kind of a `codexErrorInfo` as Codex wrote it: its word, or its
 * object's one key; none for a kind this pin does not name, or no info.
 */
export function codexErrorKind(info: unknown): CodexErrorKind | undefined {
  const named =
    typeof info === "string"
      ? info
      : typeof info === "object" && info !== null && Object.keys(info).length === 1
        ? Object.keys(info)[0]
        : undefined;
  return Option.getOrUndefined(decodeCodexErrorKind(named));
}

/** What the runner posts: the SDK's message or Codex's notification as it was emitted, or one of the runner's own. */
export type RunnerMessage =
  | SDKMessage
  | CodexNotification
  | RunnerAccepted
  | RunnerWaiting
  | RunnerIdle
  | RunnerEndEvent;

/** One event as posted: its number and its message. */
export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

/**
 * One POST's body: consecutive events, in order. The service applies each sequence
 * at most once. A batch with no events is the launch's heartbeat
 * (`RUNNER_HEARTBEAT`), which applies nothing.
 */
export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}

/**
 * How often a launch tells the service it still runs, as a batch with no events,
 * for as long as it runs. A harness may say nothing for an hour while a
 * background command or a wakeup it waits on runs, and the service keeps the
 * sandbox alive only on what the runner posts (its keep-alive interval is
 * ten minutes, its timeout an hour), so five minutes leaves room for a
 * heartbeat the service did not take, and costs one small post each.
 */
export const RUNNER_HEARTBEAT = {
  EVERY_MS: 5 * 60 * 1_000,
  /**
   * How long one heartbeat waits on the service's answer before it is let go, well
   * inside the interval, so a post the service never answers cannot hold back the
   * next one.
   */
  TIMEOUT_MS: 30 * 1_000,
} as const;
