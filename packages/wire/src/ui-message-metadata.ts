import { Schema as EffectSchema } from "effect";
import { wireRefusal } from "./effect/json-schema.js";
import { SCHEMA_REFUSAL } from "./schema-vocabulary.js";

/**
 * What a stored message says about itself beside its parts. The message
 * itself is the AI SDK's `UIMessage`, one row per message with its parts as
 * JSON; this is the `metadata` field on that row, and the one place the
 * storage says who wrote a message and how it arrived. Each role has its own
 * shape, because a user row and an assistant row answer different questions:
 * a user row says whose words these are and which channel carried them, an
 * assistant row says which of Luke's parts spoke and whether the row is a
 * compaction standing in for the rows before it. A system row carries no
 * metadata at all. Declared here so the desktop, the service, and the phone
 * decode one shape, and so a key the schema does not name is refused rather
 * than stored.
 *
 * Every shape below is an Effect `Schema.Struct`, declared and exported
 * directly: a caller reads one with `readEither` and shows it with
 * `emitJsonSchema`, both from `@sidecar/wire/effect`.
 */

/** The roles a stored message may carry, as the SDK names them. */
export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MessageRoleSchema = EffectSchema.Literals(Object.values(MESSAGE_ROLE));

/** Who wrote a message: the developer, Luke's own judgment, the voice model, or a child run. */
export const MESSAGE_AUTHOR = {
  DEVELOPER: "developer",
  BRAIN: "brain",
  VOICE_MODEL: "voice_model",
  CHILD: "child",
} as const;

export type MessageAuthor = (typeof MESSAGE_AUTHOR)[keyof typeof MESSAGE_AUTHOR];

/** How a developer's ask arrived. */
export const MESSAGE_CHANNEL = {
  TYPED: "typed",
  VOICE: "voice",
} as const;

export type MessageChannel = (typeof MESSAGE_CHANNEL)[keyof typeof MESSAGE_CHANNEL];

/**
 * What the brain wrote a user row down for itself about: the words a turn
 * opened with that no developer typed or spoke. The turn's origin names the
 * first three the way the turns table does; the rest are the notes the host
 * hands a turn beside its own words.
 */
export const OBSERVATION_SOURCE = {
  /**
   * A wake opened the turn: an edge the host handed in for one session,
   * outside the scheduled look. Spelled `hook` because the stored rows an
   * earlier build wrote carry it, and this build reads those rows.
   */
  HOOK: "hook",
  /** The roster look on the observation pass. */
  ROSTER_LOOK: "roster_look",
  /** Briefings held through a meeting or a pause, handed back for one re-decision. */
  HOLD_RELEASE: "hold_release",
  /** A child's own turn: the task its requester delegated, as the child reads it. */
  CHILD: "child",
  /** A requester's turn opened by a child's completion, with the child's result as its words. */
  CHILD_COMPLETION: "child_completion",
  /** Notes the memory provider recalled for the turn. */
  RECALLED_NOTES: "recalled_notes",
  /** The compact notices of what sibling conversations did since main's last turn. */
  ACTIVITY_NOTICES: "activity_notices",
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
 * A user row is one of three things, and the shape says which: the
 * developer's typed ask, a spoken ask cut from a voice session, or an
 * observation the brain wrote down for itself. Three structs rather than one
 * with every field optional, so an observation carrying a channel or a typed
 * ask carrying a voice session has no shape to arrive in.
 */
const TYPED_ASK_METADATA = EffectSchema.Struct({
  author: EffectSchema.Literal(MESSAGE_AUTHOR.DEVELOPER),
  channel: EffectSchema.Literal(MESSAGE_CHANNEL.TYPED),
});

type TypedAskMetadata = EffectSchema.Schema.Type<typeof TYPED_ASK_METADATA>;

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

/** An observation arrives on no channel: the brain's own note of what opened the turn or what the host handed it. */
const OBSERVATION_METADATA = EffectSchema.Struct({
  author: EffectSchema.Literal(MESSAGE_AUTHOR.BRAIN),
  source: ObservationSourceSchema,
});

type ObservationMetadata = EffectSchema.Schema.Type<typeof OBSERVATION_METADATA>;

export type UserMessageMetadata = TypedAskMetadata | SpokenAskMetadata | ObservationMetadata;

/** What a user row says about itself. */
export const USER_MESSAGE_METADATA = EffectSchema.Union([
  TYPED_ASK_METADATA,
  SPOKEN_ASK_METADATA,
  OBSERVATION_METADATA,
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

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
 * What an assistant row says about itself: who wrote it, and, for a row of
 * the voice model's — one of Luke's settled utterances cut from a voice
 * session — the session and span it was cut from, the delegation it followed
 * where the developer's line before it was handed to the brain, and the
 * message it was read aloud from where it was one: the brain's briefing, or
 * the journal of the turn that delegation ran. A view folds that message's
 * words behind the words actually said. Only the voice model's row carries
 * any of those, and its span runs forward or comes together.
 */
const ASSISTANT_MESSAGE_STRUCT = EffectSchema.Struct({
  author: EffectSchema.Literals([
    MESSAGE_AUTHOR.BRAIN,
    MESSAGE_AUTHOR.VOICE_MODEL,
    MESSAGE_AUTHOR.CHILD,
  ]),
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
