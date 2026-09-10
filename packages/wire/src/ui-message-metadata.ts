import { type RecordOf, type Schema, type SchemaFields, s } from "./schema.js";

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
 */

/** The roles a stored message may carry, as the SDK names them. */
export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  SYSTEM: "system",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

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
  /** A provider's hook reported a session's turn ending or a tool holding. */
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

/** An identifier another table minted: a voice session's, a delegation's, a message's. */
const identifier = s.text({ max: 128 });

/** A millisecond offset into a voice session's own clock, never a wall-clock instant. */
const spanInstant = s.wholeNumber({ minimum: 0 });

/**
 * A user row is one of three things, and the shape says which: the
 * developer's typed ask, a spoken ask cut from a voice session, or an
 * observation the brain wrote down for itself. Three records rather than one
 * with every field optional, so an observation carrying a channel or a typed
 * ask carrying a voice session has no shape to arrive in.
 */
const TYPED_ASK_METADATA_FIELDS = {
  author: s.literal(MESSAGE_AUTHOR.DEVELOPER),
  channel: s.literal(MESSAGE_CHANNEL.TYPED),
} satisfies SchemaFields;

export type TypedAskMetadata = RecordOf<typeof TYPED_ASK_METADATA_FIELDS>;

/**
 * A spoken ask is the developer's own words, or the voice model's delegation
 * of them, cut from the session and delegation it names over a span of that
 * session's clock whose two ends come together or not at all and run forward.
 */
const SPOKEN_ASK_METADATA_FIELDS = {
  author: s.enumOf([MESSAGE_AUTHOR.DEVELOPER, MESSAGE_AUTHOR.VOICE_MODEL]),
  channel: s.literal(MESSAGE_CHANNEL.VOICE),
  voice_session_id: identifier.optional(),
  delegation_id: identifier.optional(),
  from_ms: spanInstant.optional(),
  to_ms: spanInstant.optional(),
} satisfies SchemaFields;

export type SpokenAskMetadata = RecordOf<typeof SPOKEN_ASK_METADATA_FIELDS>;

function coherentSpan(metadata: SpokenAskMetadata): boolean {
  if (metadata.from_ms === undefined || metadata.to_ms === undefined) {
    return metadata.from_ms === metadata.to_ms;
  }
  return metadata.from_ms <= metadata.to_ms;
}

/** An observation arrives on no channel: the brain's own note of what opened the turn or what the host handed it. */
const OBSERVATION_METADATA_FIELDS = {
  author: s.literal(MESSAGE_AUTHOR.BRAIN),
  source: s.enumOf(Object.values(OBSERVATION_SOURCE)),
} satisfies SchemaFields;

export type ObservationMetadata = RecordOf<typeof OBSERVATION_METADATA_FIELDS>;

export type UserMessageMetadata = TypedAskMetadata | SpokenAskMetadata | ObservationMetadata;

/** What a user row says about itself. */
export const USER_MESSAGE_METADATA: Schema<UserMessageMetadata> = s.union([
  s.record(TYPED_ASK_METADATA_FIELDS),
  s.refine(s.record(SPOKEN_ASK_METADATA_FIELDS), coherentSpan),
  s.record(OBSERVATION_METADATA_FIELDS),
]);

/**
 * A compaction row's account of what it folded: the first message the model
 * still reads after it, and how many tokens the folded messages had cost.
 */
const COMPACTION_METADATA_FIELDS = {
  first_kept_message_id: identifier,
  tokens_before: s.wholeNumber({ minimum: 0 }),
} satisfies SchemaFields;

export type CompactionMetadata = RecordOf<typeof COMPACTION_METADATA_FIELDS>;

export const COMPACTION_METADATA: Schema<CompactionMetadata> = s.record(COMPACTION_METADATA_FIELDS);

const ASSISTANT_MESSAGE_METADATA_FIELDS = {
  author: s.enumOf([MESSAGE_AUTHOR.BRAIN, MESSAGE_AUTHOR.VOICE_MODEL, MESSAGE_AUTHOR.CHILD]),
  compaction: COMPACTION_METADATA.optional(),
} satisfies SchemaFields;

export type AssistantMessageMetadata = RecordOf<typeof ASSISTANT_MESSAGE_METADATA_FIELDS>;

/** What an assistant row says about itself. */
export const ASSISTANT_MESSAGE_METADATA: Schema<AssistantMessageMetadata> = s.record(
  ASSISTANT_MESSAGE_METADATA_FIELDS,
);

/** The metadata a stored message of either speaking role carries. */
export type StoredMessageMetadata = UserMessageMetadata | AssistantMessageMetadata;
