import type {
  BackgroundTaskSummary,
  SDKMessage,
  SessionCronSummary,
} from "@anthropic-ai/claude-agent-sdk";
import { Option, Schema } from "effect";
import type { ServerNotification } from "./codex-protocol/index.js";

export const RUNNER_ENV = {
  BEARER: "APP_RUNNER_TOKEN",
  CLAUDE_TOKEN: "CLAUDE_CODE_OAUTH_TOKEN",
  API_KEY: "ANTHROPIC_API_KEY",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  CODEX_TOKEN: "APP_CODEX_TOKEN",
  CODEX_PLAN_BACKEND: "APP_CODEX_PLAN_BACKEND",
  CHATGPT_ACCOUNT_ID: "APP_CHATGPT_ACCOUNT_ID",
  PLACE: "APP_RUNNER_PLACE",
} as const;

export const CODEX_PLAN_BACKEND = {
  OPENAI_API: "openai_api",
  CHATGPT: "chatgpt",
} as const;

export type CodexPlanBackend = (typeof CODEX_PLAN_BACKEND)[keyof typeof CODEX_PLAN_BACKEND];

export const RUNNER_PLACE = {
  HOST: "host",
} as const;

export const INSTALLED_SKILLS = {
  SKILLS: "skills",
  MANIFEST: ".claude-plugin/plugin.json",
  PLUGIN: "workspace",
} as const;

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

export const CLAUDE_CODE_WORKER = "worker";

export const RUNNER_HARNESS = {
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;
export type RunnerHarness = (typeof RUNNER_HARNESS)[keyof typeof RUNNER_HARNESS];

export const EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
  MAX: "max",
} as const;
export type Effort = (typeof EFFORT)[keyof typeof EFFORT];
const EffortSchema = Schema.Literals(Object.values(EFFORT));

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

export const INPUT_LINE = {
  MESSAGE: "message",
  STOP: "stop",
  MODEL: "model",
  RETIRE: "retire",
} as const;

export const CODEX_TOKEN_COMMAND = "codex-token";

export const RunnerTokenAnswerSchema = Schema.Struct({ accessToken: Schema.String });
export type RunnerTokenAnswer = typeof RunnerTokenAnswerSchema.Type;

export const RUNNER_LINES = {
  QUERY: { LAUNCH: "launch", AFTER: "after" },
  HOLD_MS: 20 * 1_000,
} as const;

const LinePlaceSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const RunnerLinesAnswerSchema = Schema.Struct({
  lines: Schema.Array(Schema.Struct({ seq: LinePlaceSchema, text: Schema.String })),
});
export type RunnerLinesAnswer = typeof RunnerLinesAnswerSchema.Type;

export const IMAGE_MEDIA_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
} as const;

const SEQUENCE_MAX = 2 ** 52;

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

export const ClaudeCodeConfigSchema = Schema.Struct({
  harness: Schema.optionalKey(Schema.Literal(RUNNER_HARNESS.CLAUDE_CODE)),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(EffortSchema),
  fast: Schema.optionalKey(Schema.Boolean),
  append: Schema.String,
  resume: Schema.optionalKey(Schema.String),
  rewindBefore: Schema.optionalKey(Schema.String),
  firstSequence: SequenceSchema,
  eventsUrl: Schema.String,
  linesUrl: Schema.optionalKey(Schema.String),
  mcpUrl: Schema.String,
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  allowedDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  installedSkills: Schema.optionalKey(Schema.String),
  warm: Schema.optionalKey(Schema.Boolean),
});
export type ClaudeCodeConfig = typeof ClaudeCodeConfigSchema.Type;

export const CodexConfigSchema = Schema.Struct({
  harness: Schema.Literal(RUNNER_HARNESS.CODEX),
  cwd: Schema.String,
  executable: Schema.String,
  model: Schema.String,
  effort: Schema.optionalKey(CodexEffortSchema),
  fast: Schema.optionalKey(Schema.Boolean),
  ultrafast: Schema.optionalKey(Schema.Boolean),
  developerInstructions: Schema.String,
  threadId: Schema.optionalKey(Schema.String),
  rewindBefore: Schema.optionalKey(Schema.String),
  firstSequence: SequenceSchema,
  eventsUrl: Schema.String,
  linesUrl: Schema.optionalKey(Schema.String),
  mcpUrl: Schema.String,
  integrations: Schema.optionalKey(Schema.Array(IntegrationServerSchema)),
  tokenUrl: Schema.String,
  installedSkills: Schema.optionalKey(Schema.String),
  warm: Schema.optionalKey(Schema.Boolean),
});
export type CodexConfig = typeof CodexConfigSchema.Type;

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

const UuidSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

const MessageLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MESSAGE),
  uuid: Schema.optionalKey(UuidSchema),
  content: Schema.Array(ContentBlockSchema),
});
const StopLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.STOP),
  launch: Schema.optionalKey(SequenceSchema),
});
const ModelLineSchema = Schema.Struct({
  type: Schema.Literal(INPUT_LINE.MODEL),
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(Schema.Union([EffortSchema, CodexEffortSchema])),
  fast: Schema.optionalKey(Schema.Boolean),
  ultrafast: Schema.optionalKey(Schema.Boolean),
});

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

export const RUNNER_EVENT = {
  ACCEPTED: "vespin_runner_accepted",
  WAITING: "vespin_runner_waiting",
  IDLE: "vespin_runner_idle",
  END: "vespin_runner_end",
} as const;

export const RUNNER_END = {
  TURN_ENDED: "turn_ended",
  STOPPED: "stopped",
  INPUT_CLOSED: "input_closed",
  FAILED: "failed",
  RELEASED: "released",
  IDLED: "idled",
} as const;
export type RunnerEnd = (typeof RUNNER_END)[keyof typeof RUNNER_END];

export const RUNNER_WARM = {
  IDLE_CAP_MS: 60 * 60 * 1_000,
} as const;

export interface RunnerIdle {
  readonly type: typeof RUNNER_EVENT.IDLE;
}

export interface RunnerAccepted {
  readonly type: typeof RUNNER_EVENT.ACCEPTED;
  readonly uuid: string;
}

export interface RunnerWaiting {
  readonly type: typeof RUNNER_EVENT.WAITING;
  readonly background_tasks: readonly BackgroundTaskSummary[];
  readonly session_crons: readonly SessionCronSummary[];
}

export interface RunnerWakeup {
  readonly at: string;
  readonly prompt: string;
}

export const RUNNER_RELEASE = {
  SETTLE_MS: 2 * 60 * 1_000,
  RECHECK_MS: 60 * 1_000,
  IDLE_CAP_MS: 60 * 60 * 1_000,
} as const;

export const RUNNER_CONTROL = {
  ANSWER_MS: 5 * 1_000,
} as const;

export const RUNNER_UNANSWERED = {
  SILENCE_MS: 5 * 60 * 1_000,
} as const;

export interface RunnerEndEvent {
  readonly type: typeof RUNNER_EVENT.END;
  readonly reason: RunnerEnd;
  readonly detail?: string;
  readonly wakeups?: readonly RunnerWakeup[];
}

export type CodexNotification = ServerNotification;

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

export function codexErrorKind(info: unknown): CodexErrorKind | undefined {
  const named =
    typeof info === "string"
      ? info
      : typeof info === "object" && info !== null && Object.keys(info).length === 1
        ? Object.keys(info)[0]
        : undefined;
  return Option.getOrUndefined(decodeCodexErrorKind(named));
}

export type RunnerMessage =
  | SDKMessage
  | CodexNotification
  | RunnerAccepted
  | RunnerWaiting
  | RunnerIdle
  | RunnerEndEvent;

export interface RunnerEvent {
  readonly sequence: number;
  readonly message: RunnerMessage;
}

export interface RunnerEventBatch {
  readonly events: readonly RunnerEvent[];
}

export const RUNNER_HEARTBEAT = {
  EVERY_MS: 5 * 60 * 1_000,
  TIMEOUT_MS: 30 * 1_000,
} as const;
