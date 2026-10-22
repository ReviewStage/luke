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
import { Option, Schema } from "effect";
import type { ServerNotification } from "./codex-protocol/index.js";

/**
 * The environment the runner reads. The bearer authenticates it to Luke, its
 * events and its MCP server alike. The plan token is never read by the runner
 * itself: the CLI it launches inherits it, and the command sandbox denies it,
 * with the bearer, to every command the agent runs. Codex's token is never
 * in it: app-server asks Luke for it through the runner's token command.
 */
export const RUNNER_ENV = {
  BEARER: "LUKE_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
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
} as const;

/**
 * The argument that starts the runner's bundle as Codex's token command rather
 * than as a launch: `node <bundle> codex-token <tokenUrl>`, which prints the
 * plan's access token Luke answers, and nothing else, on stdout.
 */
export const CODEX_TOKEN_COMMAND = "codex-token";

/** What Luke's token route answers a runner: the plan's access token, good for at least the route's margin. */
export const RunnerTokenAnswerSchema = Schema.Struct({ accessToken: Schema.String });
export type RunnerTokenAnswer = typeof RunnerTokenAnswerSchema.Type;

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
  /** Whether Claude Code's own fast mode is on, for an agent on a model's fast version. */
  fast: Schema.optionalKey(Schema.Boolean),
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
  /**
   * Where the runner asks Luke for the plan's access token, under its bearer
   * (`/api/agents/runner-token`). App-server takes its token from the
   * runner's `codex-token` command (Codex's provider `auth`), which Codex runs
   * again as its cached token ages and after a 401, so a turn outlives any
   * one token.
   */
  tokenUrl: Schema.String,
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
/**
 * Stop the running turn. `launch` names the launch the stop is for by its
 * first event number (its config's `firstSequence`): one launch runs one of
 * Luke's turns, so a stop Luke meant for an earlier launch's turn, delayed
 * past it, is skipped by the launch that replaced it rather than
 * interrupting its turn. A stop that names none is taken by any launch.
 */
const StopLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.STOP),
  launch: Schema.optionalKey(SequenceSchema),
});
/**
 * A model or effort change, applied from the next model call on Claude Code
 * and from the next turn on Codex. An effort the launch's harness does not
 * take is skipped. `fast` turns Claude Code's own fast mode on or off; Codex
 * has none and skips it.
 */
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.Union([EffortSchema, CodexEffortSchema])),
  fast: Schema.optionalKey(Schema.Boolean),
});

export const InputLineSchema = Schema.Union([MessageLineSchema, StopLineSchema, ModelLineSchema]);
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
  /** The CLI or app-server failed, or Codex's turn did; the turn shows as failed, and the next message relaunches with `resume`. */
  FAILED: "failed",
  /**
   * A wait released (`RUNNER_RELEASE`): the agent waited on wakeups alone,
   * with no process of its own still running, so the launch ended for its
   * sandbox to stop; the END names the wakeups for Luke to deliver as they
   * come due. The turn is over, as a `turn_ended` one is.
   */
  RELEASED: "released",
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

/** A wakeup a released wait left for Luke to deliver: the instant it comes due, and the prompt the CLI would have run then. */
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
 * instead, and Luke delivers each wakeup as a message when it comes due,
 * which relaunches the CLI on the session it resumes. Any launch hands the
 * wakeups back: Luke drops what it held, the CLI restores on resume the
 * one-shot tasks the agent made itself, and the agent owns them again.
 */
export const RUNNER_RELEASE = {
  /**
   * How long a wait lasts before it is released, and how far off its
   * earliest wakeup must still be then. Vercel bills a sandbox's memory by
   * the minute it runs, and a released wait costs a stop, a resume, and a
   * relaunch of the CLI, so a wait shorter than two billed minutes is held;
   * the same bound eve's agent stops its sandbox for a pause at
   * (`CODER.SLEEP_STOPS_AT`).
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
  | RunnerEndEvent;

/** One event as posted: its number and its message. */
export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

/**
 * One POST's body: consecutive events, in order. Luke applies each sequence
 * at most once. A batch with no events is the launch's heartbeat
 * (`RUNNER_HEARTBEAT`), which applies nothing.
 */
export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}

/**
 * How often a launch tells Luke it still runs, as a batch with no events,
 * for as long as it runs. A harness may say nothing for an hour while a
 * background command or a wakeup it waits on runs, and Luke keeps the
 * sandbox alive only on what the runner posts (its keep-alive interval is
 * ten minutes, its timeout an hour), so five minutes leaves room for a
 * heartbeat Luke did not take, and costs one small post each.
 */
export const RUNNER_HEARTBEAT = {
  EVERY_MS: 5 * 60 * 1_000,
  /**
   * How long one heartbeat waits on Luke's answer before it is let go, well
   * inside the interval, so a post Luke never answers cannot hold back the
   * next one.
   */
  TIMEOUT_MS: 30 * 1_000,
} as const;
