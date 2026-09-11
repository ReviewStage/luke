import { CONVERSATION_MESSAGE_AUTHOR, type ConversationMessageAuthor } from "@sidecar/session";
import { effectSchema, type Schema, s, type UnparsedWireValue } from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  toSchemaRead,
  verbatimJsonSchema,
} from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * What the messages endpoint answers: one bounded page of a session's
 * conversation. Who wrote one message, like every other vocabulary on this
 * wire, is the owning package's own set rather than a copy of it.
 *
 * Every shape below is composed directly with Effect's `Schema.Struct` rather
 * than through the `s.*` facade; {@link fromEffect} is what still answers the
 * facade's `read`/`parse`/`jsonSchema` for the callers that hold one.
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

/**
 * The Effect schema a declaration was composed from, adapted to the facade
 * still-held callers use: `read` through `readEither`, `jsonSchema` through
 * the emitter walking the same schema.
 */
function fromEffect<Value, Encoded>(core: EffectSchema.Schema<Value, Encoded>): Schema<Value> {
  const read = readEither(core);
  return s.reader({
    read: (value) => toSchemaRead(read(value)),
    jsonSchema: () => emitJsonSchema(core),
  });
}

/** A text trimmed and refused when left with nothing, the facade's `s.text` default. */
function trimmedText(maximumChars?: number): EffectSchema.Schema<string, string> {
  const core = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  }).pipe(
    EffectSchema.filter((value) => value.trim().length > 0, {
      schemaId: EffectSchema.MinLengthSchemaId,
      jsonSchema: { minLength: 1 },
    }),
  );
  return maximumChars === undefined ? core : core.pipe(EffectSchema.maxLength(maximumChars));
}

/** A member set admitted with its ends trimmed, as an answer's own enum always is. */
function trimmedEnum<const Member extends string>(
  members: readonly Member[],
): EffectSchema.Schema<Member, string> {
  return verbatimJsonSchema(
    EffectSchema.transform(EffectSchema.String, EffectSchema.Literal(...members), {
      strict: false,
      decode: (value) => value.trim(),
      encode: (value) => value,
    }),
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
  inner: EffectSchema.Schema<Value, Encoded>,
): EffectSchema.Schema<Value | undefined, UnparsedWireValue> {
  const read = readEither(inner);
  return declareReader<Value | undefined>(
    (value) => ({ ok: true, value: Either.getOrUndefined(read(value)) }),
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
  item: EffectSchema.Schema<Value, Encoded>,
): EffectSchema.Schema<Value[], readonly UnparsedWireValue[]> {
  return EffectSchema.transform(
    EffectSchema.Array(dropped(item)),
    EffectSchema.mutable(EffectSchema.Array(item)),
    {
      strict: false,
      decode: (entries) => entries.filter((entry) => entry !== undefined),
      encode: (entries) => entries,
    },
  );
}

const conversationMessageFieldsFrom = EffectSchema.Struct({
  id: trimmedText(),
  author: trimmedEnum(Object.values(CONVERSATION_MESSAGE_AUTHOR)),
  // The words are read as written: a message is rendered as its author
  // wrote it, and trimming is a display decision this wire reader has no
  // business making. Only an empty message is no message.
  text: effectSchema(writtenText),
  receivedAt: EffectSchema.optionalWith(dropped(effectSchema(countedNumber)), { exact: true }),
}).annotations({ parseOptions: { onExcessProperty: "ignore" } });

const conversationMessageFieldsTo = EffectSchema.Struct({
  id: trimmedText(),
  author: trimmedEnum(Object.values(CONVERSATION_MESSAGE_AUTHOR)),
  text: effectSchema(writtenText),
  receivedAt: EffectSchema.optionalWith(EffectSchema.Number, { exact: true }),
});

/** A record leaves a dropped field's key out entirely rather than carrying it as `undefined`. */
const conversationMessageCore = EffectSchema.transform(
  conversationMessageFieldsFrom,
  conversationMessageFieldsTo,
  {
    strict: false,
    decode: (value) =>
      value.receivedAt === undefined
        ? { id: value.id, author: value.author, text: value.text }
        : { id: value.id, author: value.author, text: value.text, receivedAt: value.receivedAt },
    encode: (value) => value,
  },
);

const conversationAnswerFieldsFrom = EffectSchema.Struct({
  messages: keptEntries(conversationMessageCore),
  lastMessageId: EffectSchema.optionalWith(dropped(trimmedText()), { exact: true }),
  hasMore: EffectSchema.Boolean,
  firstOffset: EffectSchema.optionalWith(dropped(effectSchema(countedNumber)), { exact: true }),
  hasOlder: EffectSchema.optionalWith(dropped(EffectSchema.Boolean), { exact: true }),
}).annotations({ parseOptions: { onExcessProperty: "ignore" } });

const conversationAnswerFieldsTo = EffectSchema.Struct({
  messages: EffectSchema.mutable(EffectSchema.Array(conversationMessageFieldsTo)),
  lastMessageId: EffectSchema.optionalWith(EffectSchema.String, { exact: true }),
  hasMore: EffectSchema.Boolean,
  firstOffset: EffectSchema.optionalWith(EffectSchema.Number, { exact: true }),
  hasOlder: EffectSchema.optionalWith(EffectSchema.Boolean, { exact: true }),
});

/** A malformed message is skipped, not fatal; a dropped position leaves its key out entirely. */
const hostedConversationAnswerCore = EffectSchema.transform(
  conversationAnswerFieldsFrom,
  conversationAnswerFieldsTo,
  {
    strict: false,
    decode: (value) => ({
      messages: value.messages,
      ...(value.lastMessageId === undefined ? undefined : { lastMessageId: value.lastMessageId }),
      hasMore: value.hasMore,
      ...(value.firstOffset === undefined ? undefined : { firstOffset: value.firstOffset }),
      ...(value.hasOlder === undefined ? undefined : { hasOlder: value.hasOlder }),
    }),
    encode: (value) => value,
  },
);

export const hostedConversationAnswerSchema: Schema<HostedConversationAnswer> = fromEffect(
  hostedConversationAnswerCore,
);
