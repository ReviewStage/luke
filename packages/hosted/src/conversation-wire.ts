import { CONVERSATION_MESSAGE_AUTHOR, type ConversationMessageAuthor } from "@sidecar/session";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * What the messages endpoint answers: one bounded page of a session's
 * conversation. Who wrote one message, like every other vocabulary on this
 * wire, is the owning package's own set rather than a copy of it.
 *
 * Every shape below is composed directly with Effect's `Schema.Struct` and
 * exported under its own name. The answer is read through
 * `readEither(schema, { excess: EXCESS_KEYS.DROP })`: a key a newer service
 * added is dropped rather than refused, and that grain is the read's now
 * rather than the declaration's.
 */

/**
 * One attributed message of a session's conversation, as the messages
 * endpoint relays it: the provider's own id, who wrote it, and the words
 * whole — the read's bounds live on the page, never on the message. Only the
 * two voices a chat screen draws exist on the wire, because a message the
 * provider's store did not attribute never left the adapter at all.
 */
/**
 * The query parameters the messages endpoint reads: the session by its two
 * identifiers, and one of two positions, the message id an earlier answer
 * handed back to poll on from, or the stored offset to read history before.
 */
export const SESSION_MESSAGES_QUERY = {
  PROVIDER_ID: "providerId",
  PROVIDER_SESSION_ID: "providerSessionId",
  AFTER: "after",
  BEFORE_OFFSET: "beforeOffset",
} as const;

export interface HostedConversationMessage {
  id: string;
  author: ConversationMessageAuthor;
  text: string;
  /** Unix ms the provider recorded the message at, when it reported one. */
  receivedAt?: number;
}

/**
 * The messages endpoint answer: one bounded page of attributed messages and
 * the positions to continue from. `lastMessageId` is where a poll resumes —
 * absent on an older-history page, which must never move a poll backward —
 * and `firstOffset`/`hasOlder` are where a scroll to the top continues,
 * absent on a poll, which never looks backward. The server assembled it from
 * a fresh read and stored nothing — a new request is a new read.
 */
export interface HostedConversationAnswer {
  messages: HostedConversationMessage[];
  lastMessageId?: string;
  hasMore: boolean;
  firstOffset?: number;
  hasOlder?: boolean;
}

/** A text trimmed and refused when left with nothing. */
function trimmedText(maximumChars?: number): EffectSchema.Codec<string, string> {
  const core = EffectSchema.Trim.check(EffectSchema.isNonEmpty());
  return maximumChars === undefined ? core : core.check(EffectSchema.isMaxLength(maximumChars));
}

/** A member set admitted with its ends trimmed, as an answer's own enum always is. */
function trimmedEnum<const Member extends string>(
  members: readonly Member[],
): EffectSchema.Codec<Member, string> {
  return verbatimJsonSchema(
    EffectSchema.Trim.pipe(
      EffectSchema.decodeTo(
        EffectSchema.Literals(members),
        SchemaTransformation.passthroughSupertype(),
      ),
    ),
    { type: "string", enum: members },
  );
}

/**
 * A field a malformed value is dropped from rather than refused for: a
 * position or a branch worth having when well formed and worth nothing when
 * it is not, where refusing the whole answer over one of them would cost the
 * reader everything else it carried.
 */
function dropped<Value, Encoded>(
  inner: EffectSchema.Codec<Value, Encoded>,
): EffectSchema.Codec<Value | undefined, UnparsedWireValue> {
  const read = readEither(inner, { excess: EXCESS_KEYS.DROP });
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Result.getOrUndefined(read(value)) }),
    emitJsonSchema(inner),
  );
}

/**
 * The entries of an array that drops a refused one rather than refusing the
 * whole array. The `to` side is `Schema.mutable`, since Effect's own array
 * schema types its decoded value as a `readonly` array and every interface
 * on this wire declares a plain, mutable one; `Schema.mutable` changes
 * nothing `emitJsonSchema` reads, only the type a caller sees.
 */
function keptEntries<Value, Encoded>(
  item: EffectSchema.Codec<Value, Encoded>,
): EffectSchema.Codec<Value[], readonly UnparsedWireValue[]> {
  return EffectSchema.Array(dropped(item)).pipe(
    EffectSchema.decodeTo(
      EffectSchema.toType(EffectSchema.mutable(EffectSchema.Array(item))),
      SchemaTransformation.transform<Value[], readonly (Value | undefined)[]>({
        decode: (entries) => entries.filter((entry) => entry !== undefined),
        encode: (entries) => entries,
      }),
    ),
  );
}

const conversationMessageFieldsFrom = EffectSchema.Struct({
  id: trimmedText(),
  author: trimmedEnum(Object.values(CONVERSATION_MESSAGE_AUTHOR)),
  // The words are read as written: a message is rendered as its author
  // wrote it, and trimming is a display decision this wire reader has no
  // business making. Only an empty message is no message.
  text: writtenText,
  receivedAt: EffectSchema.optionalKey(dropped(countedNumber)),
});

/**
 * The shape a message decodes to. Each `to` side below is a `toType`, since
 * what a transform hands its target is that target's encoded value and these
 * targets decode nothing further: the answer's own shape is both.
 */
const conversationMessageFieldsTo = EffectSchema.toType(
  EffectSchema.Struct({
    id: trimmedText(),
    author: trimmedEnum(Object.values(CONVERSATION_MESSAGE_AUTHOR)),
    text: writtenText,
    receivedAt: EffectSchema.optionalKey(EffectSchema.Number),
  }),
);

/** A record leaves a dropped field's key out entirely rather than carrying it as `undefined`. */
const conversationMessageCore = conversationMessageFieldsFrom.pipe(
  EffectSchema.decodeTo(
    conversationMessageFieldsTo,
    SchemaTransformation.transform<
      (typeof conversationMessageFieldsTo)["Encoded"],
      (typeof conversationMessageFieldsFrom)["Type"]
    >({
      decode: (value) =>
        value.receivedAt === undefined
          ? { id: value.id, author: value.author, text: value.text }
          : { id: value.id, author: value.author, text: value.text, receivedAt: value.receivedAt },
      encode: (value) => value,
    }),
  ),
);

const conversationAnswerFieldsFrom = EffectSchema.Struct({
  messages: keptEntries(conversationMessageCore),
  lastMessageId: EffectSchema.optionalKey(dropped(trimmedText())),
  hasMore: EffectSchema.Boolean,
  firstOffset: EffectSchema.optionalKey(dropped(countedNumber)),
  hasOlder: EffectSchema.optionalKey(dropped(EffectSchema.Boolean)),
});

const conversationAnswerFieldsTo = EffectSchema.toType(
  EffectSchema.Struct({
    messages: EffectSchema.mutable(EffectSchema.Array(conversationMessageFieldsTo)),
    lastMessageId: EffectSchema.optionalKey(EffectSchema.String),
    hasMore: EffectSchema.Boolean,
    firstOffset: EffectSchema.optionalKey(EffectSchema.Number),
    hasOlder: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
);

/** A malformed message is skipped, not fatal; a dropped position leaves its key out entirely. */
const hostedConversationAnswerCore = conversationAnswerFieldsFrom.pipe(
  EffectSchema.decodeTo(
    conversationAnswerFieldsTo,
    SchemaTransformation.transform<
      (typeof conversationAnswerFieldsTo)["Encoded"],
      (typeof conversationAnswerFieldsFrom)["Type"]
    >({
      decode: (value) => ({
        messages: value.messages,
        ...(value.lastMessageId === undefined ? undefined : { lastMessageId: value.lastMessageId }),
        hasMore: value.hasMore,
        ...(value.firstOffset === undefined ? undefined : { firstOffset: value.firstOffset }),
        ...(value.hasOlder === undefined ? undefined : { hasOlder: value.hasOlder }),
      }),
      encode: (value) => value,
    }),
  ),
);

export const hostedConversationAnswerSchema = hostedConversationAnswerCore;
