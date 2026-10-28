import { Schema as EffectSchema } from "effect";
import { wireRefusal } from "./effect/json-schema.js";
import { SCHEMA_REFUSAL } from "./schema-vocabulary.js";

/**
 * What a stored message says about itself beside its parts. The message
 * itself is the AI SDK's `UIMessage`, one row per message with its parts as
 * JSON; this is the `metadata` field on that row, and the one place the
 * storage says how a message arrived and what wrote it. Each role has its own
 * shape, because a user row and an assistant row answer different questions:
 * a user row says which channel carried it, or which note the runtime wrote
 * down, an assistant row says which model spoke and whether the row is a
 * compaction standing in for the rows before it. A system row carries no
 * metadata at all. Declared here so the desktop and the service
 * decode one shape, and so a key the schema does not name is refused rather
 * than stored.
 *
 * Every shape below is an Effect `Schema.Struct`, declared and exported
 * directly: a caller reads one with `readEither` and shows it with
 * `emitJsonSchema`, both from `@luke/wire/effect`.
 */

/** The roles a stored message may carry, as the SDK names them. */
export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MessageRoleSchema = EffectSchema.Literals(Object.values(MESSAGE_ROLE));

/**
 * Who wrote a message where its channel does not say: on a call, the
 * developer's own words or the voice model's delegation of them; on an
 * assistant row, the model that answered the turn or the voice model on a
 * call. Any other user row names what carried it by its channel or its
 * source alone, and who sent it by the row's sender columns.
 */
export const MESSAGE_AUTHOR = {
  DEVELOPER: "developer",
  MODEL: "model",
  VOICE_MODEL: "voice_model",
} as const;

/**
 * How a developer's ask arrived, or what else carried a line steered into a
 * coding agent: another coding agent's message, a thread's reply, answer or
 * close, a plan comment thread a member sent it, the brief a Start opened it
 * with, GitHub's word on its pull request, a line Luke sent, or an
 * automation's run.
 */
export const MESSAGE_CHANNEL = {
  TYPED: "typed",
  VOICE: "voice",
  AGENT_MESSAGE: "agent_message",
  THREAD: "thread",
  COMMENT: "comment",
  START: "start",
  GITHUB: "github",
  LUKE: "luke",
  AUTOMATION: "automation",
} as const;

/** What a member did on a thread that a line steered into its agent carries. */
export const THREAD_LINE_EVENT = {
  MESSAGE: "message",
  ANSWER: "answer",
  CLOSE: "close",
} as const;

/** What a Start handed a new agent as its first line: the developer's prompt, the plan, or another agent it continues or forks. */
export const START_LINE_BRIEF = {
  PROMPT: "prompt",
  PLAN: "plan",
  CONTINUE: "continue",
  FORK: "fork",
} as const;

/** The briefs that take over from another agent, and so name it. */
const FROM_AGENT_BRIEFS: ReadonlySet<string> = new Set([
  START_LINE_BRIEF.CONTINUE,
  START_LINE_BRIEF.FORK,
]);

/** What GitHub said on a pull request that a line steered into its agent carries. */
export const GITHUB_LINE_EVENT = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK_FAILED: "check_failed",
  CHECKS_COMPLETED: "checks_completed",
} as const;

/**
 * The most a GitHub line's metadata holds: words and an inline comment's body
 * within the most GitHub lets one body spell, as many inline comments as Luke
 * reads of a review, and every name or address within a bound far past what
 * GitHub mints, so nothing it sends is refused.
 */
export const GITHUB_LINE_BOUNDS = {
  WORDS_CHARS: 65_536,
  COMMENTS: 300,
  PATH_CHARS: 4_096,
  URL_CHARS: 8_192,
  NAME_CHARS: 256,
} as const;

/**
 * What a runtime note is about: the words a turn opened with that no one
 * typed, spoke, or sent. The turn's origin names the first three the way the
 * turns table does; the rest are the notes the host hands a turn beside its
 * own words.
 */
export const OBSERVATION_SOURCE = {
  /**
   * A wake opened the turn: an edge the host handed in for one session,
   * outside the scheduled look. Spelled `hook` because the stored rows an
   * earlier build wrote carry it, and this build reads those rows.
   */
  HOOK: "hook",
  /** A conversation whose transcript changed, handed to the observed conversation on the scheduled tick. */
  TRANSCRIPT_CHANGE: "transcript_change",
  /** A child's own turn: the task its requester delegated, as the child reads it. */
  CHILD: "child",
  /** A requester's turn opened by a child's completion, with the child's result as its words. */
  CHILD_COMPLETION: "child_completion",
  /** Notes the memory provider recalled for the turn. */
  RECALLED_NOTES: "recalled_notes",
} as const;

export type ObservationSource = (typeof OBSERVATION_SOURCE)[keyof typeof OBSERVATION_SOURCE];

const ObservationSourceSchema = EffectSchema.Literals(Object.values(OBSERVATION_SOURCE));

/** A text trimmed of its ends, refused when nothing but whitespace remains, the way `s.text` reads one. */
const trimmedText = EffectSchema.Trim.check(EffectSchema.isNonEmpty());

/** An identifier another table minted: a voice session's, a delegation's, a message's. */
const identifier = trimmedText.check(EffectSchema.isMaxLength(128));

/** An integer at or above zero, the way `s.wholeNumber({ minimum: 0 })` reads one. */
const nonNegativeInteger = EffectSchema.Finite.check(
  EffectSchema.isInt(),
  EffectSchema.isGreaterThanOrEqualTo(0),
);

/** A millisecond offset into a voice session's own clock, never a wall-clock instant. */
const spanInstant = nonNegativeInteger;

/**
 * A user row is one of these things, and the shape says which: the
 * developer's typed ask, a spoken ask cut from a voice session, a line
 * steered into a coding agent by what carried it (another coding agent's
 * message, a thread, a plan comment, a Start, GitHub, Luke, or an
 * automation), or a note the runtime wrote down. A struct each rather than one
 * with every field optional, so a note carrying a channel has no shape to
 * arrive in. Only a spoken ask says who wrote it, since a call carries both
 * the developer's words and the voice model's; every other line is told apart
 * by its channel, and who sent it is the row's sender columns, never its
 * metadata. A typed ask
 * names a voice session only where it was typed into that call, with the
 * instant on the call's clock it was typed at, so the voice's reply to it
 * finds it as the line it followed; it carries no span, since nothing of it
 * was said.
 */
const TYPED_ASK_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.TYPED),
  voice_session_id: EffectSchema.optional(identifier),
  from_ms: EffectSchema.optional(spanInstant),
});

export type TypedAskMetadata = EffectSchema.Schema.Type<typeof TYPED_ASK_METADATA>;

/**
 * A spoken ask is the developer's own words, or the voice model's delegation
 * of them, cut from the session and delegation it names over a span of that
 * session's clock whose two ends come together or not at all and run forward.
 */
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

/**
 * An agent message is a line another coding agent sent with `message_agent`,
 * steered into the receiving agent's turn; the sender is the row's, by its
 * sender columns. The words are the sender's, never the developer's, so a
 * reader that names the developer's task passes this row by.
 */
const AGENT_MESSAGE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.AGENT_MESSAGE),
});

export type AgentMessageMetadata = EffectSchema.Schema.Type<typeof AGENT_MESSAGE_METADATA>;

/**
 * A thread line is a member's reply on a thread, their answer to its ask, or
 * their close of it, steered into the thread's agent: the item it is on.
 */
const THREAD_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.THREAD),
  event: EffectSchema.Literals(Object.values(THREAD_LINE_EVENT)),
  item_id: identifier,
});

export type ThreadLineMetadata = EffectSchema.Schema.Type<typeof THREAD_LINE_METADATA>;

/** A comment line is a plan's comment thread a member sent the agent to answer: the thread it hands over. */
const COMMENT_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.COMMENT),
  thread_id: identifier,
});

export type CommentLineMetadata = EffectSchema.Schema.Type<typeof COMMENT_LINE_METADATA>;

/**
 * A start line is the first line a Start wrote a new agent: what it was
 * handed, and, for a continue or a fork, the agent it takes over from, which
 * no other brief names. Who started it is the row's sender.
 */
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

/** A name or an address GitHub minted, within the bound given. */
const githubName = (chars: number) => trimmedText.check(EffectSchema.isMaxLength(chars));

/** What GitHub's author wrote, as written: empty where they wrote nothing. */
const githubBody = EffectSchema.String.check(
  EffectSchema.isMaxLength(GITHUB_LINE_BOUNDS.WORDS_CHARS),
);

/** One inline comment of a review: the file and line it is on, its page, and what it says. */
const GITHUB_LINE_COMMENT = EffectSchema.Struct({
  path: githubName(GITHUB_LINE_BOUNDS.PATH_CHARS),
  line: EffectSchema.optional(nonNegativeInteger),
  url: githubName(GITHUB_LINE_BOUNDS.URL_CHARS),
  body: githubBody,
});

/**
 * A GitHub line is what GitHub said on an agent's pull request, steered into
 * the agent: a review with its verdict, words and inline comments, a comment
 * with its words, a failed check, or every check finished on a commit; the
 * repository, the pull request where GitHub named it, the page, and who
 * caused it, by their login. The words are the reviewer's, never the
 * developer's.
 */
const GITHUB_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.GITHUB),
  event: EffectSchema.Literals(Object.values(GITHUB_LINE_EVENT)),
  repository: githubName(GITHUB_LINE_BOUNDS.NAME_CHARS),
  number: EffectSchema.optional(nonNegativeInteger),
  url: githubName(GITHUB_LINE_BOUNDS.URL_CHARS),
  by: githubName(GITHUB_LINE_BOUNDS.NAME_CHARS),
  verdict: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.NAME_CHARS)),
  words: EffectSchema.optional(githubBody),
  comments: EffectSchema.optional(
    EffectSchema.Array(GITHUB_LINE_COMMENT).check(
      EffectSchema.isMaxLength(GITHUB_LINE_BOUNDS.COMMENTS),
    ),
  ),
  sha: EffectSchema.optional(githubName(GITHUB_LINE_BOUNDS.NAME_CHARS)),
});

export type GitHubLineMetadata = EffectSchema.Schema.Type<typeof GITHUB_LINE_METADATA>;

/** A Luke line is one Luke sent the agent on its own: a wakeup it set, or an operator's opening or wake. */
const LUKE_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.LUKE),
});

export type LukeLineMetadata = EffectSchema.Schema.Type<typeof LUKE_LINE_METADATA>;

/**
 * An automation line is an automation's run's prompt, the agent's first line
 * or a later one, and whether what fired the run put words its owner did not
 * write beside that prompt, such as a webhook's body, which `run_on_mac`
 * reads; absent from a line kept before it was said.
 */
const AUTOMATION_LINE_METADATA = EffectSchema.Struct({
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.AUTOMATION),
  outside_words: EffectSchema.optional(EffectSchema.Boolean),
});

export type AutomationLineMetadata = EffectSchema.Schema.Type<typeof AUTOMATION_LINE_METADATA>;

/** A runtime note arrives on no channel: the runtime's own note of what opened the turn or what the host handed it. */
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
  | LukeLineMetadata
  | AutomationLineMetadata
  | ObservationMetadata;

/** What a user row says about itself. */
export const USER_MESSAGE_METADATA = EffectSchema.Union([
  TYPED_ASK_METADATA,
  SPOKEN_ASK_METADATA,
  AGENT_MESSAGE_METADATA,
  THREAD_LINE_METADATA,
  COMMENT_LINE_METADATA,
  START_LINE_METADATA,
  GITHUB_LINE_METADATA,
  LUKE_LINE_METADATA,
  AUTOMATION_LINE_METADATA,
  OBSERVATION_METADATA,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

/**
 * Whether a user row's words stand as the developer's own: every line but
 * the voice model's delegation on a call, another coding agent's message,
 * and a runtime note.
 */
export function isDeveloperLine(metadata: UserMessageMetadata): boolean {
  if ("source" in metadata) return false;
  if (metadata.channel === MESSAGE_CHANNEL.AGENT_MESSAGE) return false;
  return metadata.channel !== MESSAGE_CHANNEL.VOICE || metadata.author === MESSAGE_AUTHOR.DEVELOPER;
}

/**
 * A compaction row's account of what it folded: the first message the model
 * still reads after it, which is always knowable, and how many tokens the
 * folded messages had cost, where the runtime that folded them reported it.
 * An absent count means it did not; it is never written as zero, which would
 * say nothing was folded, nor as an estimate wearing a measurement's shape.
 */
export const COMPACTION_METADATA = EffectSchema.Struct({
  first_kept_message_id: identifier,
  tokens_before: EffectSchema.optional(nonNegativeInteger),
});

export type CompactionMetadata = EffectSchema.Schema.Type<typeof COMPACTION_METADATA>;

/**
 * What an assistant row says about itself: which model wrote it, the one
 * that answered the turn, whatever harness ran it, or the voice model on a
 * call, and, for a row of
 * the voice model's — one of Luke's settled utterances cut from a voice
 * session — the session and span it was cut from, the delegation it followed
 * where the developer's line before it was handed to the brain, and the
 * message it was read aloud from where it was one: the brain's briefing, or
 * the journal of the turn that delegation ran. A view folds that message's
 * words behind the words actually said. Only the voice model's row carries
 * any of those, and its span runs forward or comes together.
 */
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

/** The voice fields are the voice model's alone, and its span is coherent. */
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

/** The metadata a stored message of either speaking role carries. */
export type StoredMessageMetadata = UserMessageMetadata | AssistantMessageMetadata;
