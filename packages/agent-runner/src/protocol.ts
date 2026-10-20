/**
 * protocol.ts -- what Luke and the runner say to each other: the config line, the later stdin lines, the events the runner posts, and the environment it reads its secrets from.
 *
 * This is the runner's whole contract, held apart from the Agent SDK so the
 * service that launches the runner (P08) and the route that takes its events
 * (P09) import it without the SDK behind it. Every line on stdin is one JSON
 * object: the first is the config, each later one a message, a stop, or a
 * model change. No secret travels in any of them, nor in argv: the runner's
 * bearer and the plan's token are in its environment alone.
 */

import type {
  BackgroundTaskSummary,
  SDKMessage,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";

/**
 * The environment the runner reads. The bearer authenticates it to Luke, its
 * events and its MCP server alike. The plan token is never read by the runner
 * itself: the CLI it launches inherits it, and the command sandbox denies it,
 * with the bearer, to every command the agent runs.
 */
export const RUNNER_ENV = {
  BEARER: "LUKE_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
} as const;

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

/** The line types a stdin line after the config may carry. */
export const INPUT_LINE = {
  MESSAGE: "message",
  STOP: "stop",
  MODEL: "model",
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
 * The first stdin line: everything one launch of the CLI is started with.
 * `executable` is the `claude` binary the image carries, because the bundled
 * SDK cannot find its own platform package. `firstSequence` is where this
 * launch's events are numbered from, one past the last event Luke applied, so
 * a relaunch with `resume` goes on numbering where the last launch stopped.
 */
export const RunnerConfigSchema = Schema.Struct({
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

/** A message for the session, in the Messages API's own block shapes. */
const MessageLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MESSAGE),
  content: Schema.Array(ContentBlockSchema),
});
/** Stop the running turn. */
const StopLineSchema = Schema.Struct({ type: Schema.Literal(INPUT_LINE.STOP) });
/** A model or effort change, applied from the next model call. */
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(EffortSchema),
});

export const InputLineSchema = Schema.Union([MessageLineSchema, StopLineSchema, ModelLineSchema]);
export type InputLine = typeof InputLineSchema.Type;

/**
 * The runner's own events, numbered among the SDK's messages, each a `type`
 * the SDK never uses.
 *
 * WAITING follows a `result` the run outlives, because the Stop hook before
 * it reported background work or a scheduled wakeup still to come: the agent
 * is waiting, not done, and the sandbox must stay up. END is the last event a
 * launch posts, with why it ended.
 */
export const RUNNER_EVENT = {
  WAITING: "luke_runner_waiting",
  END: "luke_runner_end",
} as const;

/** Why a launch ended. */
export const RUNNER_END = {
  /** A `result` with nothing left in flight: the agent's turn is over. */
  TURN_ENDED: "turn_ended",
  /** A `result` after a stop: the turn was stopped. */
  STOPPED: "stopped",
  /** Luke closed stdin, or the CLI ended its stream, before a turn ended. */
  INPUT_CLOSED: "input_closed",
  /** The CLI failed; the turn shows as interrupted, and Continue relaunches with `resume`. */
  FAILED: "failed",
} as const;
export type RunnerEnd = (typeof RUNNER_END)[keyof typeof RUNNER_END];

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

/** What the runner posts: the SDK's message as it emitted it, or one of the runner's own. */
export type RunnerMessage = SDKMessage | RunnerWaiting | RunnerEndEvent;

/** One event as posted: its number and its message. */
export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

/** One POST's body: consecutive events, in order. Luke applies each sequence at most once. */
export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}
