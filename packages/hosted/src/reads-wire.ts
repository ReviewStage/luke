import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewSource,
  type ConversationViewToolPart,
  type ConversationViewTurn,
  type SessionIdentity,
  TOOL_PART_STATE,
  type UnreadableRow,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  effectSchema,
  isRecord,
  isWireString,
  RATING_EVENT_PAYLOAD,
  type RatingEventPayload,
  SCHEMA_REFUSAL,
  type Schema,
  type SchemaRead,
  s,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import {
  declareReader,
  emitJsonSchema,
  readEither,
  toSchemaRead,
  wireRefusal,
} from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { countedNumber, HOSTED_API_ERROR, wireUuidSchema } from "./service-wire.js";

/**
 * The per-resource reads a device polls, and the one change signal that says
 * which of them moved. There is no feed: the Conversation's messages, its
 * events, and the account's turns are each read behind a cursor of the
 * device's own, and every device that reads to the end holds the same rows in
 * the same order, because each conversation numbers its messages and events
 * once and a turn's place in the order of change is a total one. A cursor is
 * an opaque string the service minted and a device hands back unchanged; its
 * shape is declared here so the service can read it and a test can pin it,
 * and a device never composes one. The Swift mirror reads these answers
 * against the fixtures under `packages/hosted/fixtures/reads/`.
 *
 * Every declaration below is composed directly as an Effect `Schema`, under
 * its own `<name>Effect` export; the plain `<name>` export beside it is the
 * same declaration read through `fromEffect` (the pattern P1-04 established
 * in `packages/wire/src/ui-message-metadata.ts`), which is what still
 * answers the facade's `read`/`parse` for `conversation-client.ts`'s,
 * `changes-client.ts`'s, and `apps/web`'s callers. The facade twin is the
 * strangler shim P12-08 deletes, once every caller declares against the
 * `Effect` export directly.
 */

/**
 * The bounds of one read. `MAX_LIMIT` is the most rows the cursor passes in
 * one page; a device with more to take asks again from the cursor the answer
 * handed back. `PREVIEW_ROWS` is the most rows a conversation answers past
 * the cursor without passing them — the row still being written and what
 * follows it — which spend none of the page and are answered again next
 * poll, so a messages page holds at most `MAX_LIMIT` passed rows plus that
 * preview for each conversation the cursor stands on.
 */
export const READ_PAGE_BOUNDS = {
  MAX_LIMIT: 200,
  PREVIEW_ROWS: 2,
} as const;

/** The two query parameters every per-resource read takes: the cursor to read on from, and the page bound. */
export const READ_QUERY = {
  AFTER: "after",
  LIMIT: "limit",
} as const;

export const READ_CURSOR_BOUNDS = {
  /** The most conversations one sequence cursor positions; the view's standing conversations never near it. */
  MAX_CONVERSATIONS: 256,
  MAX_ENCODED_LENGTH: 32_768,
} as const;

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

/** The value an Effect declaration admitted, or nothing, for a caller that never has to tell one refusal from another. */
function admitted<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

/**
 * A record that ignores a key a newer service added, which is what an answer
 * does. Each record states its own rule, because Effect hands a struct's
 * parse options down to the structs inside it.
 */
const tolerantRecord = <Fields extends EffectSchema.Struct.Fields>(fields: Fields) =>
  EffectSchema.Struct(fields).annotations({ parseOptions: { onExcessProperty: "ignore" } });

/** An integer at or above its minimum, the way `s.wholeNumber({ minimum })` reads one. */
function wholeNumber(minimum: number) {
  return EffectSchema.Int.pipe(EffectSchema.greaterThanOrEqualTo(minimum));
}

/**
 * A text settled with its ends trimmed and refused when nothing but
 * whitespace stands, the way `s.text()` reads one; `allowEmpty` skips that
 * refusal, the way `s.text({ allowEmpty: true })` does.
 */
function trimmedText(options: { readonly max?: number; readonly allowEmpty?: boolean } = {}) {
  const trimmed = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
    strict: true,
    decode: (value) => value.trim(),
    encode: (value) => value,
  });
  const settled =
    options.allowEmpty === true
      ? trimmed
      : trimmed.pipe(
          EffectSchema.filter((value) => value.trim().length > 0, {
            schemaId: EffectSchema.MinLengthSchemaId,
            jsonSchema: { minLength: 1 },
          }),
        );
  return options.max === undefined ? settled : settled.pipe(EffectSchema.maxLength(options.max));
}

/** A tool's name or a call's id as the row spells it: read as written, refused only when empty. */
const writtenIdentifierEffect = trimmedText({ max: 256 });

function refuse(refusal: (typeof SCHEMA_REFUSAL)[keyof typeof SCHEMA_REFUSAL]): SchemaRead<never> {
  return { ok: false, refusal, path: [] };
}

function base64UrlEncode(text: string): string {
  return btoa(text).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

const BASE64_URL_ALPHABET = /^[A-Za-z0-9_-]*$/u;

function base64UrlDecode(text: string): string | undefined {
  if (!BASE64_URL_ALPHABET.test(text)) return undefined;
  const standard = text.replace(/-/gu, "+").replace(/_/gu, "/");
  try {
    return atob(standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), "="));
  } catch {
    return undefined;
  }
}

/**
 * A cursor as it travels: the record's JSON, base64url-encoded, so a device
 * holds one string per resource and the query string carries it whole. The
 * schema reads the string back into the record and refuses one it did not
 * mint the shape of; the encoder reads the record under the same schema
 * first, so a cursor that could not be read back is never handed out.
 */
function encodedCursorSchemaEffect<Value, Encoded>(record: EffectSchema.Schema<Value, Encoded>) {
  const read = readEither(record);
  return declareReader<Value>(
    (value) => {
      if (!isWireString(value)) return refuse(SCHEMA_REFUSAL.MALFORMED);
      if (value.length > READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH) {
        return refuse(SCHEMA_REFUSAL.TOO_LARGE);
      }
      const decoded = base64UrlDecode(value);
      if (decoded === undefined) return refuse(SCHEMA_REFUSAL.MALFORMED);
      let parsed: UnparsedWireValue;
      try {
        // SAFETY: JSON.parse answers a wire value; the record schema below is the validation.
        parsed = JSON.parse(decoded) as UnparsedWireValue;
      } catch {
        return refuse(SCHEMA_REFUSAL.MALFORMED);
      }
      return toSchemaRead(read(parsed));
    },
    { type: "string", maxLength: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH },
  );
}

function encodeCursor<Value, Encoded>(
  record: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): string {
  const read = readEither(record)(value);
  if (Either.isLeft(read)) {
    throw new TypeError(`a cursor was minted outside its own shape: ${read.left.refusal}`);
  }
  return base64UrlEncode(JSON.stringify(read.right));
}

/** Where a device's read of one conversation's numbered rows stands: the last sequence it took, zero for none. */
export interface SequencePosition {
  readonly conversationId: string;
  readonly seq: number;
}

/**
 * A cursor over the numbered rows of several conversations at once, one
 * position per conversation the view stood on when it was minted, in
 * conversation-id order so two cursors over the same positions are the same
 * string. A conversation not positioned is read from its beginning; one
 * positioned but no longer standing is dropped from the next cursor minted.
 */
export interface SequenceReadCursor {
  readonly positions: readonly SequencePosition[];
}

const sequencePositionSchemaEffect = EffectSchema.Struct({
  conversationId: effectSchema(wireUuidSchema),
  seq: wholeNumber(0),
});

function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function positionsCanonical(cursor: SequenceReadCursor): boolean {
  return cursor.positions.every(
    (position, index) =>
      index === 0 ||
      compareCodePoints(
        cursor.positions[index - 1]?.conversationId ?? "",
        position.conversationId,
      ) < 0,
  );
}

const sequenceReadCursorRecordEffect = EffectSchema.Struct({
  positions: EffectSchema.Array(sequencePositionSchemaEffect).pipe(
    EffectSchema.maxItems(READ_CURSOR_BOUNDS.MAX_CONVERSATIONS),
  ),
}).pipe(EffectSchema.filter(positionsCanonical));

/** Reads a sequence cursor a device handed back, or refuses one this build did not mint the shape of. */
export const sequenceReadCursorSchemaEffect = encodedCursorSchemaEffect(
  sequenceReadCursorRecordEffect,
);

export const sequenceReadCursorSchema: Schema<SequenceReadCursor> = fromEffect(
  sequenceReadCursorSchemaEffect,
);

/** The cursor as an answer carries it: the encoded string, admitted only where it reads back as one this build mints. */
const encodedSequenceReadCursorSchemaEffect = trimmedText({
  max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH,
  allowEmpty: true,
}).pipe(
  EffectSchema.filter((encoded) => admitted(sequenceReadCursorSchemaEffect, encoded) !== undefined),
);

/** Mints the one string that stands for these positions, whatever order they arrived in. */
export function encodeSequenceReadCursor(positions: Iterable<SequencePosition>): string {
  const sorted = [...positions].sort((a, b) =>
    compareCodePoints(a.conversationId, b.conversationId),
  );
  return encodeCursor(sequenceReadCursorRecordEffect, {
    positions: sorted.map(({ conversationId, seq }) => ({ conversationId, seq })),
  });
}

/**
 * Where a device's read of the account's turns stands: the instant the last
 * turn it took last changed, as the service's own store renders it to the
 * microsecond, and that turn's id to break a tie. The instant is text rather
 * than a number because a millisecond instant cannot tell two stamps set in
 * the same millisecond apart, and a turn that settled in the same millisecond
 * as one a device already took would otherwise never read as later.
 */
export interface TurnReadCursor {
  readonly changedAt: string;
  readonly id: string;
}

const STORE_INSTANT_TEXT =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::?\d{2})?$/u;

const turnReadCursorRecordEffect = EffectSchema.Struct({
  changedAt: trimmedText({ max: 40 }).pipe(
    EffectSchema.filter((instant) => STORE_INSTANT_TEXT.test(instant)),
  ),
  id: effectSchema(wireUuidSchema),
});

export const turnReadCursorSchemaEffect = encodedCursorSchemaEffect(turnReadCursorRecordEffect);

export const turnReadCursorSchema: Schema<TurnReadCursor> = fromEffect(turnReadCursorSchemaEffect);

const encodedTurnReadCursorSchemaEffect = trimmedText({
  max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH,
}).pipe(
  EffectSchema.filter((encoded) => admitted(turnReadCursorSchemaEffect, encoded) !== undefined),
);

export function encodeTurnReadCursor(cursor: TurnReadCursor): string {
  return encodeCursor(turnReadCursorRecordEffect, { changedAt: cursor.changedAt, id: cursor.id });
}

/** The page bound a read may ask for: at least one row, at most the page's own maximum. */
export const readLimitSchemaEffect = wholeNumber(1).pipe(
  EffectSchema.lessThanOrEqualTo(READ_PAGE_BOUNDS.MAX_LIMIT),
);

export const readLimitSchema: Schema<number> = fromEffect(readLimitSchemaEffect);

const sessionIdentitySchemaEffect = tolerantRecord({
  providerId: trimmedText(),
  providerSessionId: trimmedText(),
});

/**
 * One conversation the view is selected from, as the messages answer lists
 * them: the account's standing main, with the instant it was opened, or an
 * observed session's conversation with the session it observes. A device
 * drops the rows of a conversation an answer no longer lists, which is how a
 * Clear reaches a screen that already drew the cleared rows; and when the
 * main's id changes it drops the observed rows written before the new main's
 * `openedAt`, because the view's window starts there — an observed
 * conversation is never cleared, so the service reads its rows from that
 * instant on and a device that already holds earlier ones lets them go.
 */
export type ConversationReadConversation =
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_VIEW_SOURCE.MAIN;
      /** Epoch milliseconds the standing main was opened at; the view's window starts here. */
      readonly openedAt: number;
    }
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_VIEW_SOURCE.OBSERVED;
      readonly session: SessionIdentity;
    };

const conversationReadConversationSchemaEffect = EffectSchema.Union(
  tolerantRecord({
    id: effectSchema(wireUuidSchema),
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.MAIN),
    openedAt: effectSchema(countedNumber),
  }),
  tolerantRecord({
    id: effectSchema(wireUuidSchema),
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.OBSERVED),
    session: sessionIdentitySchemaEffect,
  }),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

const conversationViewSourceSchemaEffect = EffectSchema.Union(
  tolerantRecord({ kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.MAIN) }),
  tolerantRecord({
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.OBSERVED),
    session: sessionIdentitySchemaEffect,
  }),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

const TURN_ORIGIN_NAMES = Object.values(TURN_ORIGIN);
const TURN_STATUS_NAMES = Object.values(TURN_STATUS);
const TOOL_PART_STATE_NAMES = Object.values(TOOL_PART_STATE);
const CONVERSATION_EVENT_KIND_NAMES = Object.values(CONVERSATION_EVENT_KIND);
const ACTION_OUTCOME_NAMES = Object.values(CONVERSATION_VIEW_ACTION_OUTCOME);

/** The columns of a turn row a view reads, instants as epoch milliseconds. */
const conversationViewTurnSchemaEffect = tolerantRecord({
  id: effectSchema(wireUuidSchema),
  origin: EffectSchema.Literal(...TURN_ORIGIN_NAMES),
  status: EffectSchema.Literal(...TURN_STATUS_NAMES),
  queuedAt: effectSchema(countedNumber),
  startedAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
  settledAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
});

const TOOL_PART_IDENTITY_FIELDS_EFFECT = {
  toolCallId: writtenIdentifierEffect,
  toolName: writtenIdentifierEffect,
  state: EffectSchema.Literal(...TOOL_PART_STATE_NAMES),
} as const;

/** A tool call as the view decided it, the one fact of its kind the part alone cannot say beside it. */
const conversationViewToolPartSchemaEffect = EffectSchema.Union(
  tolerantRecord({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE),
    unspoken: EffectSchema.Boolean,
  }),
  tolerantRecord({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.ACTION),
    outcome: EffectSchema.Literal(...ACTION_OUTCOME_NAMES),
  }),
  tolerantRecord({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.DETAIL),
  }),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

/**
 * A stored message as the wire carries it: the row's `UIMessage` exactly as
 * the service read it back. Holding it to the vocabulary is the reader's own
 * step, through `readStoredUIMessages` under the registry it holds, because
 * the SDK's validator and the tool registry both sit above this package; the
 * wire admits a record here and nothing narrower, so no second statement of
 * the message's shape can drift from the one the SDK makes.
 */
const storedMessageRecordSchemaEffect = declareReader<WireRecord>(
  (value) => (isRecord(value) ? { ok: true, value } : refuse(SCHEMA_REFUSAL.MALFORMED)),
  { type: "object", properties: {}, required: [], additionalProperties: false },
);

/** Any JSON an event's payload holds, carried as it was written. */
const wireValueSchemaEffect = declareReader<WireValue>(
  (value) => (value === undefined ? refuse(SCHEMA_REFUSAL.MALFORMED) : { ok: true, value }),
  { type: "object", properties: {}, required: [], additionalProperties: false },
);

/**
 * One message of a turn group: the stored row, its place in its
 * conversation's sequence, its tool calls as the view decided them, and the
 * developer's latest rating of it, folded from the rating events the way an
 * announcement's mark is folded from the speech events. A client reads the
 * current rating from this page and never from the events resource's
 * beginning; the events remain the record, one row per rating, and a
 * re-rating is a newer row that this field then answers.
 */
export interface ConversationReadMessage {
  readonly message: WireRecord;
  readonly seq: number;
  /** Epoch milliseconds the row was written at; the order across conversations. */
  readonly createdAt: number;
  readonly tools: readonly ConversationViewToolPart[];
  readonly rating?: RatingEventPayload;
}

const conversationReadMessageSchemaEffect = tolerantRecord({
  message: storedMessageRecordSchemaEffect,
  seq: wholeNumber(1),
  createdAt: effectSchema(countedNumber),
  tools: EffectSchema.Array(conversationViewToolPartSchemaEffect),
  rating: EffectSchema.optionalWith(effectSchema(RATING_EVENT_PAYLOAD), { exact: true }),
});

/**
 * The messages one turn wrote that the view selected, in sequence, under
 * the turn row where the store holds one. A group may continue on a later
 * page — a turn still running writes rows after a page was cut — so a device
 * merges groups by `turnId`, keeps messages by `seq`, and orders groups by
 * their earliest message, then the turn's queue instant, then the id, the
 * order the view itself keeps. A message still being written is answered on
 * every read until it is finished, its parts as they then stand, and the
 * cursor passes it only then; a device replaces the message it holds at that
 * sequence rather than keeping the first copy.
 */
export interface ConversationReadTurnGroup {
  readonly turnId: string;
  readonly conversationId: string;
  readonly source: ConversationViewSource;
  readonly turn?: ConversationViewTurn;
  readonly messages: readonly ConversationReadMessage[];
}

const conversationReadTurnGroupSchemaEffect = tolerantRecord({
  turnId: effectSchema(wireUuidSchema),
  conversationId: effectSchema(wireUuidSchema),
  source: conversationViewSourceSchemaEffect,
  turn: EffectSchema.optionalWith(conversationViewTurnSchemaEffect, { exact: true }),
  messages: EffectSchema.Array(conversationReadMessageSchemaEffect).pipe(EffectSchema.minItems(1)),
});

/**
 * The messages endpoint's answer: the view's standing conversations, the
 * turn groups the page's rows selected into, the cursor to read on from,
 * and whether more stood past the page. A page may hold no group and still
 * say more stands, when the rows it read were an observed conversation's
 * ordinary work that never crosses into the view; the cursor moved all the
 * same, and a device reads on.
 */
export interface ConversationMessagesAnswer {
  readonly conversations: readonly ConversationReadConversation[];
  readonly groups: readonly ConversationReadTurnGroup[];
  readonly next: string;
  readonly hasMore: boolean;
}

/** A group holds at least one row, so a page holds at most as many groups as rows: the passed rows and every conversation's preview. */
const MAX_MESSAGE_GROUPS =
  READ_PAGE_BOUNDS.MAX_LIMIT + READ_CURSOR_BOUNDS.MAX_CONVERSATIONS * READ_PAGE_BOUNDS.PREVIEW_ROWS;

export const conversationMessagesAnswerSchemaEffect = tolerantRecord({
  conversations: EffectSchema.Array(conversationReadConversationSchemaEffect).pipe(
    EffectSchema.maxItems(READ_CURSOR_BOUNDS.MAX_CONVERSATIONS),
  ),
  groups: EffectSchema.Array(conversationReadTurnGroupSchemaEffect).pipe(
    EffectSchema.maxItems(MAX_MESSAGE_GROUPS),
  ),
  next: encodedSequenceReadCursorSchemaEffect,
  hasMore: EffectSchema.Boolean,
});

export const conversationMessagesAnswerSchema: Schema<ConversationMessagesAnswer> = fromEffect(
  conversationMessagesAnswerSchemaEffect,
);

/** One event row about a message, in its conversation's own event sequence. */
export interface ConversationReadEvent {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly kind: ConversationEventKind;
  /** The device that claimed, spoke, or rated; absent for a kind no device took part in. */
  readonly deviceId?: string;
  readonly payload?: WireValue;
  readonly createdAt: number;
}

const conversationReadEventSchemaEffect = tolerantRecord({
  id: effectSchema(wireUuidSchema),
  conversationId: effectSchema(wireUuidSchema),
  seq: wholeNumber(1),
  messageId: effectSchema(wireUuidSchema),
  kind: EffectSchema.Literal(...CONVERSATION_EVENT_KIND_NAMES),
  deviceId: EffectSchema.optionalWith(trimmedText(), { exact: true }),
  payload: EffectSchema.optionalWith(wireValueSchemaEffect, { exact: true }),
  createdAt: effectSchema(countedNumber),
});

export interface ConversationEventsAnswer {
  readonly events: readonly ConversationReadEvent[];
  readonly next: string;
  readonly hasMore: boolean;
}

export const conversationEventsAnswerSchemaEffect = tolerantRecord({
  events: EffectSchema.Array(conversationReadEventSchemaEffect).pipe(
    EffectSchema.maxItems(READ_PAGE_BOUNDS.MAX_LIMIT),
  ),
  next: encodedSequenceReadCursorSchemaEffect,
  hasMore: EffectSchema.Boolean,
});

export const conversationEventsAnswerSchema: Schema<ConversationEventsAnswer> = fromEffect(
  conversationEventsAnswerSchemaEffect,
);

/**
 * One turn as the turns endpoint answers it: the view's columns, the
 * conversation it ran over, what it ran on and how it ended, and its own
 * cursor, which is where a read that took it stands. A turn is answered
 * again each time a stamp on it moves, so a device replaces the turn it holds
 * by id rather than appending.
 */
export interface BrainTurnRecord extends ConversationViewTurn {
  readonly conversationId: string;
  readonly model?: string;
  readonly failure?: string;
  readonly cancelRequestedAt?: number;
  readonly cursor: string;
}

const brainTurnRecordSchemaEffect = tolerantRecord({
  id: effectSchema(wireUuidSchema),
  conversationId: effectSchema(wireUuidSchema),
  origin: EffectSchema.Literal(...TURN_ORIGIN_NAMES),
  status: EffectSchema.Literal(...TURN_STATUS_NAMES),
  model: EffectSchema.optionalWith(trimmedText(), { exact: true }),
  queuedAt: effectSchema(countedNumber),
  startedAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
  settledAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
  failure: EffectSchema.optionalWith(trimmedText(), { exact: true }),
  cancelRequestedAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
  cursor: encodedTurnReadCursorSchemaEffect,
});

/** The turns endpoint's answer; `next` is absent only when nothing has ever been taken and nothing stood to take. */
export interface BrainTurnsAnswer {
  readonly turns: readonly BrainTurnRecord[];
  readonly next?: string;
  readonly hasMore: boolean;
}

export const brainTurnsAnswerSchemaEffect = tolerantRecord({
  turns: EffectSchema.Array(brainTurnRecordSchemaEffect).pipe(
    EffectSchema.maxItems(READ_PAGE_BOUNDS.MAX_LIMIT),
  ),
  next: EffectSchema.optionalWith(encodedTurnReadCursorSchemaEffect, { exact: true }),
  hasMore: EffectSchema.Boolean,
});

export const brainTurnsAnswerSchema: Schema<BrainTurnsAnswer> = fromEffect(
  brainTurnsAnswerSchemaEffect,
);

const unreadableRowSchemaEffect = tolerantRecord({
  conversationId: effectSchema(wireUuidSchema),
  seq: wholeNumber(1),
});

/**
 * The one refusal a messages read answers with a body a device acts on: a
 * page holding a row this build cannot read is refused whole, naming the
 * row, and a device must surface it rather than draw the page as empty.
 */
export const unreadableRowRefusalSchemaEffect = EffectSchema.transform(
  tolerantRecord({
    error: EffectSchema.Literal(HOSTED_API_ERROR.UNREADABLE_ROW),
    unreadableRow: unreadableRowSchemaEffect,
  }),
  unreadableRowSchemaEffect,
  {
    strict: false,
    decode: (refusal) => refusal.unreadableRow,
    encode: (row) => ({ error: HOSTED_API_ERROR.UNREADABLE_ROW, unreadableRow: row }),
  },
);

export const unreadableRowRefusalSchema: Schema<UnreadableRow> = fromEffect(
  unreadableRowRefusalSchemaEffect,
);

/**
 * The change-signal poll's request: the device asking, and what it reports
 * of itself on the way. `activeUntil` is the instant its presence holds
 * until, `quietUntil` the instant a meeting hold it observes ends; each is
 * epoch milliseconds, `null` to clear the one on file, and absent to leave
 * it. The service reports them and decides nothing from them here: what a
 * quiet instant does is hold speech, and holding is the whole of its power.
 */
export interface ChangesRequest {
  readonly deviceId: string;
  readonly activeUntil?: number | null;
  readonly quietUntil?: number | null;
}

const presenceInstantSchemaEffect = EffectSchema.Union(
  wholeNumber(0),
  EffectSchema.Literal(null),
).annotations(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

export const changesRequestSchemaEffect = EffectSchema.Struct({
  deviceId: effectSchema(wireUuidSchema),
  activeUntil: EffectSchema.optionalWith(presenceInstantSchemaEffect, { exact: true }),
  quietUntil: EffectSchema.optionalWith(presenceInstantSchemaEffect, { exact: true }),
});

export const changesRequestSchema: Schema<ChangesRequest> = fromEffect(changesRequestSchemaEffect);

/**
 * Where every resource's read stands now: the cursor a device reading each
 * to its end would hold. A device compares each against the cursor it holds
 * and reads the resource whose head differs; `turns` is absent while the
 * account has no turn, and `rosterObservedAt` while no roster snapshot
 * stands. `seen` says whether the device row the request named is the
 * account's, exactly as the heartbeat says it; `false` tells the device to
 * register again, and the signal is answered either way.
 */
export interface ChangesAnswer {
  readonly seen: boolean;
  readonly messages: string;
  readonly events: string;
  readonly turns?: string;
  /** Epoch milliseconds of the latest roster snapshot the scheduled observation wrote. */
  readonly rosterObservedAt?: number;
}

export const changesAnswerSchemaEffect = tolerantRecord({
  seen: EffectSchema.Boolean,
  messages: encodedSequenceReadCursorSchemaEffect,
  events: encodedSequenceReadCursorSchemaEffect,
  turns: EffectSchema.optionalWith(encodedTurnReadCursorSchemaEffect, { exact: true }),
  rosterObservedAt: EffectSchema.optionalWith(effectSchema(countedNumber), { exact: true }),
});

export const changesAnswerSchema: Schema<ChangesAnswer> = fromEffect(changesAnswerSchemaEffect);
