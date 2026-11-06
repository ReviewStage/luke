import { Schema as EffectSchema } from "effect";
import { wireRefusal } from "./effect/json-schema.js";
import { LEGACY_APP_WORD, literalsReadingLegacy } from "./legacy-app-word.js";
import { SCHEMA_REFUSAL } from "./schema-vocabulary.js";

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MessageRoleSchema = EffectSchema.Literals(Object.values(MESSAGE_ROLE));

export const MESSAGE_AUTHOR = {
  DEVELOPER: "developer",
  MODEL: "model",
  VOICE_MODEL: "voice_model",
} as const;

export const MESSAGE_CHANNEL = {
  TYPED: "typed",
  VOICE: "voice",
  AGENT_MESSAGE: "agent_message",
  THREAD: "thread",
  COMMENT: "comment",
  START: "start",
  GITHUB: "github",
  APP: "app",
  AUTOMATION: "automation",
  SLACK: "slack",
} as const;

export const THREAD_LINE_EVENT = {
  MESSAGE: "message",
  ANSWER: "answer",
  CLOSE: "close",
} as const;

export const START_LINE_BRIEF = {
  PROMPT: "prompt",
  DESCRIPTION: "plan",
  CONTINUE: "continue",
  FORK: "fork",
} as const;

const FROM_AGENT_BRIEFS: ReadonlySet<string> = new Set([
  START_LINE_BRIEF.CONTINUE,
  START_LINE_BRIEF.FORK,
]);

export const GITHUB_LINE_EVENT = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK_FAILED: "check_failed",
  CHECKS_COMPLETED: "checks_completed",
  DEQUEUED: "dequeued",
} as const;

export const GITHUB_CHECK_CONCLUSION = {
  SUCCESS: "success",
  FAILURE: "failure",
  NEUTRAL: "neutral",
  CANCELED: "cancelled",
  SKIPPED: "skipped",
  TIMED_OUT: "timed_out",
  ACTION_REQUIRED: "action_required",
  STALE: "stale",
  STARTUP_FAILURE: "startup_failure",
} as const;

export type GitHubCheckConclusion =
  (typeof GITHUB_CHECK_CONCLUSION)[keyof typeof GITHUB_CHECK_CONCLUSION];

const FAILING_CHECK_CONCLUSIONS: ReadonlySet<string> = new Set([
  GITHUB_CHECK_CONCLUSION.FAILURE,
  GITHUB_CHECK_CONCLUSION.TIMED_OUT,
  GITHUB_CHECK_CONCLUSION.CANCELED,
  GITHUB_CHECK_CONCLUSION.ACTION_REQUIRED,
  GITHUB_CHECK_CONCLUSION.STARTUP_FAILURE,
]);

export const GITHUB_LINE_BOUNDS = {
  WORDS_CHARS: 65_536,
  COMMENTS: 300,
  CHECKS: 200,
  PATH_CHARS: 4_096,
  URL_CHARS: 8_192,
  NAME_CHARS: 256,
} as const;

export const COMMENT_LINE_BOUNDS = {
  WORDS_CHARS: 8_000,
  QUOTE_CHARS: 2_000,
  TITLE_CHARS: 80,
} as const;

export const SLACK_LINE_BOUNDS = {
  WORDS_CHARS: 40_000,
  URL_CHARS: 2_048,
} as const;

export const OBSERVATION_SOURCE = {
  HOOK: "hook",
  TRANSCRIPT_CHANGE: "transcript_change",
  CHILD: "child",
  CHILD_COMPLETION: "child_completion",
  RECALLED_NOTES: "recalled_notes",
} as const;

export type ObservationSource = (typeof OBSERVATION_SOURCE)[keyof typeof OBSERVATION_SOURCE];

const ObservationSourceSchema = EffectSchema.Literals(Object.values(OBSERVATION_SOURCE));

const trimmedText = EffectSchema.Trim.check(EffectSchema.isNonEmpty());

const identifier = trimmedText.check(EffectSchema.isMaxLength(128));

const nonNegativeInteger = EffectSchema.Finite.check(
  EffectSchema.isInt(),
  EffectSchema.isGreaterThanOrEqualTo(0),
);

const spanInstant = nonNegativeInteger;

const TYPED_ASK_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.TYPED),
  voice_session_id: EffectSchema.optional(identifier),
  from_ms: EffectSchema.optional(spanInstant),
});

export type TypedAskMetadata = EffectSchema.Schema.Type<typeof TYPED_ASK_METADATA>;

const SPOKEN_ASK_STRUCT = EffectSchema.Struct({
  author: EffectSchema.Literals([MESSAGE_AUTHOR.DEVELOPER, MESSAGE_AUTHOR.VOICE_MODEL]),
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.VOICE),
  voice_session_id: EffectSchema.optional(identifier),
  delegation_id: EffectSchema.optional(identifier),
  from_ms: EffectSchema.optional(spanInstant),
  to_ms: EffectSchema.optional(spanInstant),
});

export type SpokenAskMetadata = EffectSchema.Schema.Type<typeof SPOKEN_ASK_STRUCT>;

function coherentSpan(metadata: SpokenAskMetadata): boolean {
  if (metadata.from_ms === undefined || metadata.to_ms === undefined) {
    return metadata.from_ms === metadata.to_ms;
  }
  return metadata.from_ms <= metadata.to_ms;
}

const SPOKEN_ASK_METADATA = SPOKEN_ASK_STRUCT.check(EffectSchema.makeFilter(coherentSpan));

const AGENT_MESSAGE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.AGENT_MESSAGE),
});

export type AgentMessageMetadata = EffectSchema.Schema.Type<typeof AGENT_MESSAGE_METADATA>;

const THREAD_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.THREAD),
  event: EffectSchema.Literals(Object.values(THREAD_LINE_EVENT)),
  item_id: identifier,
});

export type ThreadLineMetadata = EffectSchema.Schema.Type<typeof THREAD_LINE_METADATA>;

const COMMENT_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.COMMENT),
  thread_id: identifier,
  task_id: EffectSchema.optional(identifier),
  quote: EffectSchema.optional(
    EffectSchema.String.check(EffectSchema.isMaxLength(COMMENT_LINE_BOUNDS.QUOTE_CHARS)),
  ),
  page_id: EffectSchema.optional(identifier),
  page_title: EffectSchema.optional(
    EffectSchema.String.check(EffectSchema.isMaxLength(COMMENT_LINE_BOUNDS.TITLE_CHARS)),
  ),
  words: EffectSchema.optional(
    EffectSchema.String.check(EffectSchema.isMaxLength(COMMENT_LINE_BOUNDS.WORDS_CHARS)),
  ),
});

export type CommentLineMetadata = EffectSchema.Schema.Type<typeof COMMENT_LINE_METADATA>;

const START_LINE_STRUCT = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.START),
  brief: EffectSchema.Literals(Object.values(START_LINE_BRIEF)),
  source_agent_id: EffectSchema.optional(identifier),
});

export type StartLineMetadata = EffectSchema.Schema.Type<typeof START_LINE_STRUCT>;

const START_LINE_METADATA = START_LINE_STRUCT.check(
  EffectSchema.makeFilter(
    (metadata: StartLineMetadata) =>
      FROM_AGENT_BRIEFS.has(metadata.brief) === (metadata.source_agent_id !== undefined),
  ),
);

const githubName = (chars: number) => trimmedText.check(EffectSchema.isMaxLength(chars));

const githubBody = EffectSchema.String.check(
  EffectSchema.isMaxLength(GITHUB_LINE_BOUNDS.WORDS_CHARS),
);

const GITHUB_LINE_COMMENT = EffectSchema.Struct({
  path: githubName(GITHUB_LINE_BOUNDS.PATH_CHARS),
  line: EffectSchema.optional(nonNegativeInteger),
  url: githubName(GITHUB_LINE_BOUNDS.URL_CHARS),
  body: githubBody,
});

const GITHUB_LINE_CHECK = EffectSchema.Struct({
  name: githubName(GITHUB_LINE_BOUNDS.NAME_CHARS),
  conclusion: EffectSchema.Literals(Object.values(GITHUB_CHECK_CONCLUSION)),
  url: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.URL_CHARS)),
});

const GITHUB_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.GITHUB),
  event: EffectSchema.Literals(Object.values(GITHUB_LINE_EVENT)),
  repository: githubName(GITHUB_LINE_BOUNDS.NAME_CHARS),
  number: EffectSchema.optional(nonNegativeInteger),
  url: githubName(GITHUB_LINE_BOUNDS.URL_CHARS),
  by: githubName(GITHUB_LINE_BOUNDS.NAME_CHARS),
  by_avatar: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.URL_CHARS)),
  verdict: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.NAME_CHARS)),
  words: EffectSchema.optional(githubBody),
  comments: EffectSchema.optional(
    EffectSchema.Array(GITHUB_LINE_COMMENT).check(
      EffectSchema.isMaxLength(GITHUB_LINE_BOUNDS.COMMENTS),
    ),
  ),
  sha: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.NAME_CHARS)),
  outside_words: EffectSchema.optional(EffectSchema.Boolean),
  failing: EffectSchema.optional(EffectSchema.Boolean),
  checks: EffectSchema.optional(
    EffectSchema.Array(GITHUB_LINE_CHECK).check(
      EffectSchema.isMaxLength(GITHUB_LINE_BOUNDS.CHECKS),
    ),
  ),
});

export type GitHubLineMetadata = EffectSchema.Schema.Type<typeof GITHUB_LINE_METADATA>;

const APP_LINE_METADATA = EffectSchema.Struct({
  channel: literalsReadingLegacy([MESSAGE_CHANNEL.APP], LEGACY_APP_WORD, MESSAGE_CHANNEL.APP),
});

export type AppLineMetadata = EffectSchema.Schema.Type<typeof APP_LINE_METADATA>;

const AUTOMATION_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.AUTOMATION),
  outside_words: EffectSchema.optional(EffectSchema.Boolean),
});

export type AutomationLineMetadata = EffectSchema.Schema.Type<typeof AUTOMATION_LINE_METADATA>;

const SLACK_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.SLACK),
  words: EffectSchema.String.check(EffectSchema.isMaxLength(SLACK_LINE_BOUNDS.WORDS_CHARS)),
  url: EffectSchema.optional(
    trimmedText.check(EffectSchema.isMaxLength(SLACK_LINE_BOUNDS.URL_CHARS)),
  ),
  outside_words: EffectSchema.optional(EffectSchema.Boolean),
});

export type SlackLineMetadata = EffectSchema.Schema.Type<typeof SLACK_LINE_METADATA>;

const OBSERVATION_METADATA = EffectSchema.Struct({
  source: ObservationSourceSchema,
});

type ObservationMetadata = EffectSchema.Schema.Type<typeof OBSERVATION_METADATA>;

export type UserMessageMetadata =
  | TypedAskMetadata
  | SpokenAskMetadata
  | AgentMessageMetadata
  | ThreadLineMetadata
  | CommentLineMetadata
  | StartLineMetadata
  | GitHubLineMetadata
  | AppLineMetadata
  | AutomationLineMetadata
  | SlackLineMetadata
  | ObservationMetadata;

export const USER_MESSAGE_METADATA = EffectSchema.Union([
  TYPED_ASK_METADATA,
  SPOKEN_ASK_METADATA,
  AGENT_MESSAGE_METADATA,
  THREAD_LINE_METADATA,
  COMMENT_LINE_METADATA,
  START_LINE_METADATA,
  GITHUB_LINE_METADATA,
  APP_LINE_METADATA,
  AUTOMATION_LINE_METADATA,
  SLACK_LINE_METADATA,
  OBSERVATION_METADATA,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export function isDeveloperLine(metadata: UserMessageMetadata): boolean {
  if ("source" in metadata) return false;
  if (metadata.channel === MESSAGE_CHANNEL.AGENT_MESSAGE) return false;
  return metadata.channel !== MESSAGE_CHANNEL.VOICE || metadata.author === MESSAGE_AUTHOR.DEVELOPER;
}

export function isFailingConclusion(conclusion: string): boolean {
  return FAILING_CHECK_CONCLUSIONS.has(conclusion);
}

export const COMPACTION_METADATA = EffectSchema.Struct({
  first_kept_message_id: identifier,
  tokens_before: EffectSchema.optional(nonNegativeInteger),
});

export type CompactionMetadata = EffectSchema.Schema.Type<typeof COMPACTION_METADATA>;

const ASSISTANT_MESSAGE_STRUCT = EffectSchema.Struct({
  author: EffectSchema.Literals([MESSAGE_AUTHOR.MODEL, MESSAGE_AUTHOR.VOICE_MODEL]),
  compaction: EffectSchema.optional(COMPACTION_METADATA),
  channel: EffectSchema.optional(EffectSchema.Literal(MESSAGE_CHANNEL.VOICE)),
  voice_session_id: EffectSchema.optional(identifier),
  delegation_id: EffectSchema.optional(identifier),
  from_ms: EffectSchema.optional(spanInstant),
  to_ms: EffectSchema.optional(spanInstant),
  read_from: EffectSchema.optional(identifier),
});

type AssistantMessageStruct = EffectSchema.Schema.Type<typeof ASSISTANT_MESSAGE_STRUCT>;

function spokenByVoiceModel(metadata: AssistantMessageStruct): boolean {
  const spoken =
    metadata.channel !== undefined ||
    metadata.voice_session_id !== undefined ||
    metadata.delegation_id !== undefined ||
    metadata.from_ms !== undefined ||
    metadata.to_ms !== undefined ||
    metadata.read_from !== undefined;
  if (spoken && metadata.author !== MESSAGE_AUTHOR.VOICE_MODEL) return false;
  if (metadata.from_ms === undefined || metadata.to_ms === undefined) {
    return metadata.from_ms === metadata.to_ms;
  }
  return metadata.from_ms <= metadata.to_ms;
}

export const ASSISTANT_MESSAGE_METADATA = ASSISTANT_MESSAGE_STRUCT.check(
  EffectSchema.makeFilter(spokenByVoiceModel),
);

export type AssistantMessageMetadata = EffectSchema.Schema.Type<typeof ASSISTANT_MESSAGE_METADATA>;

export type StoredMessageMetadata = UserMessageMetadata | AssistantMessageMetadata;
