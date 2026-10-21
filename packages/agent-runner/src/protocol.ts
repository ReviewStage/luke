/**
 * protocol.ts -- what Luke and the runner say to each other: the config line, the later stdin lines, the events the runner posts, and the environment it reads its secrets from.
 *
 * This is the runner's whole contract, held apart from the Agent SDK so the
 * service that launches the runner (P08) and the route that takes its events
 * (P09) import it without the SDK behind it. Every line on stdin is one JSON
 * object: the first is the config, each later one a message, a stop, a model
 * change, or, for Codex, a refreshed access token.
 *
 * The config says which harness the launch runs: Claude Code (P05), or Codex
 * through `codex app-server` (P20). Secrets never travel in argv. The runner's
 * bearer and the plan's first token are in its environment; the one secret a
 * stdin line carries is the token line's, because a ChatGPT access token
 * lives an hour and a running launch has no other way to take its
 * replacement. The runner never logs, echoes or posts that line, and takes
 * the token out of every event it posts.
 */

import type {
  BackgroundTaskSummary,
  SDKMessage,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";
import type { ServerNotification } from "./codex-protocol/index.js";

/**
 * The environment the runner reads. The bearer authenticates it to Luke, its
 * events and its MCP server alike. The plan token is never read by the runner
 * itself: the CLI it launches inherits it, and the command sandbox denies it,
 * with the bearer, to every command the agent runs. An Anthropic API key
 * stands in its place for a launch in test mode, on the same terms.
 */
export const RUNNER_ENV = {
  BEARER: "LUKE_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
  /**
   * The ChatGPT plan's OAuth access token, which `codex app-server` reads under
   * this name (OpenAI's documented provider's `env_key`), and which no
   * command Codex runs inherits.
   */
  CODEX_TOKEN: "ACCESS_TOKEN",
  API_KEY: "ANTHROPIC_API_KEY",
} as const;

/** The harness a launch runs, spelled as `conversations.runtime` spells it. */
export const RUNNER_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;
export type RunnerHarness = (typeof RUNNER_HARNESS)[keyof typeof RUNNER_HARNESS];

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
 * protocol types them as any string, so the runner holds Luke to these.
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
  TOKEN: "token",
} as const;

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

const SequenceSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(SEQUENCE_MAX),
);

/**
 * The first stdin line of a Claude Code launch: everything one launch of the CLI is started with.
 * `executable` is the `claude` binary the image carries, because the bundled
 * SDK cannot find its own platform package. `firstSequence` is where this
 * launch's events are numbered from, one past the last event Luke applied, so
 * a relaunch with `resume` goes on numbering where the last launch stopped.
 */
export const ClaudeCodeConfigSchema = Schema.Struct({
  /** Absent in a config written before Codex mode, which is Claude Code's. */
  harness: Schema.optionalKey(Schema.Literal(RUNNER_HARNESS.CLAUDE_CODE)),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(EffortSchema),
  /** Luke's coder instructions, appended to Claude Code's own system prompt. */
  append: Schema.String,
  /** The CLI's session id to resume, where this launch continues one. */
  resume: Schema.optionalKey(Schema.String),
  firstSequence: SequenceSchema,
  /** Where the runner posts its events. */
  eventsUrl: Schema.String,
  /** The Luke MCP server's streamable-HTTP endpoint. */
  mcpUrl: Schema.String,
  /** The hosts a command the agent runs may reach, besides nothing else. */
  allowedDomains: Schema.Array(Schema.String),
});
export type ClaudeCodeConfig = typeof ClaudeCodeConfigSchema.Type;

/**
 * The first stdin line of a Codex launch. `executable` is the `codex` binary
 * the image carries (P17); `CODEX_HOME`, where Codex keeps its threads, comes
 * from the launch's environment and must exist before the runner starts.
 * `threadId` is the thread to resume, where this launch continues one; a new
 * thread's id reaches Luke in its `thread/started` notification. Commands
 * Codex runs reach the network (`workspace-write` with network on), so there
 * are no allowed domains to name.
 */
export const CodexConfigSchema = Schema.Struct({
  harness: Schema.Literal(RUNNER_HARNESS.CODEX),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(CodexEffortSchema),
  /** Luke's coder instructions, as the thread's `developer_instructions`. */
  developerInstructions: Schema.String,
  threadId: Schema.optionalKey(Schema.String),
  firstSequence: SequenceSchema,
  eventsUrl: Schema.String,
  mcpUrl: Schema.String,
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
 * is Luke's id for the message, handed to the SDK as the prompt's own, so
 * the ACCEPTED event and the `result` that answers it name it; the runner
 * mints one where a line names none.
 */
const MessageLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MESSAGE),
  uuid: Schema.optionalKey(UuidSchema),
  content: Schema.Array(ContentBlockSchema),
});
/** Stop the running turn. */
const StopLineSchema = Schema.Struct({ type: Schema.Literal(INPUT_LINE.STOP) });
/**
 * A model or effort change, applied from the next model call on Claude Code
 * and from the next turn on Codex. An effort the launch's harness does not
 * take is skipped.
 */
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.Union([EffortSchema, CodexEffortSchema])),
});
/**
 * A refreshed ChatGPT access token, for a Codex launch: the runner restarts
 * app-server with it and resumes the thread before the next turn it starts,
 * never during one. The one line that carries a secret: never logged, echoed
 * or posted, and taken out of every event. A Claude Code launch skips it.
 */
const TokenLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.TOKEN),
  accessToken: Schema.String,
});

export const InputLineSchema = Schema.Union([
  MessageLineSchema,
  StopLineSchema,
  ModelLineSchema,
  TokenLineSchema,
]);
export type InputLine = typeof InputLineSchema.Type;

/**
 * The runner's own events, numbered among the SDK's messages, each a `type`
 * the SDK never uses.
 *
 * ACCEPTED is posted as a message line is handed to the SDK, naming the
 * message's `uuid`, so Luke ties the message it sent to the turn that runs
 * it: the CLI never echoes a prompt back. WAITING follows a `result` the run
 * outlives, because the Stop hook before it reported background work or a
 * scheduled wakeup still to come: the agent is waiting, not done, and the
 * sandbox must stay up. END is the last event a launch posts, with why it
 * ended.
 */
export const RUNNER_EVENT = {
  ACCEPTED: "luke_runner_accepted",
  WAITING: "luke_runner_waiting",
  END: "luke_runner_end",
} as const;

/** Why a launch ended. */
export const RUNNER_END = {
  /** A `result`, or Codex's `turn/completed`, with nothing left in flight or unanswered: the agent's turn is over. */
  TURN_ENDED: "turn_ended",
  /** A `result`, or an interrupted turn, after a stop: the turn was stopped. */
  STOPPED: "stopped",
  /** Luke closed stdin, or the CLI ended its stream, before a turn ended. */
  INPUT_CLOSED: "input_closed",
  /** The CLI or app-server failed, or Codex's turn did; the turn shows as interrupted, and Continue relaunches with `resume`. */
  FAILED: "failed",
} as const;
export type RunnerEnd = (typeof RUNNER_END)[keyof typeof RUNNER_END];

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

/** The END event; `detail` is the CLI's failure, with the launch's secrets taken out, where it failed. */
export interface RunnerEndEvent {
  readonly type: typeof RUNNER_EVENT.END;
  readonly reason: RunnerEnd;
  readonly detail?: string;
}

/**
 * One notification `codex app-server` sent, as it wrote it (the pinned
 * protocol's `ServerNotification`, generated into `codex-protocol/`). Every
 * notification is posted, the thread's subagents' included; the projection
 * (P22) picks what it shows.
 */
export type CodexNotification = ServerNotification;

/** What the runner posts: the SDK's message or Codex's notification as it was emitted, or one of the runner's own. */
export type RunnerMessage =
  | SDKMessage
  | CodexNotification
  | RunnerAccepted
  | RunnerWaiting
  | RunnerEndEvent;

/** One event as posted: its number and its message. */
export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

/** One POST's body: consecutive events, in order. Luke applies each sequence at most once. */
export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}
