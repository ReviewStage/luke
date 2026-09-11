import {
  CONVERSATION_VIEW_ACTION_OUTCOME,
  CONVERSATION_VIEW_SOURCE,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewSource,
  type ConversationViewToolPart,
  type ConversationViewTurn,
  type SessionIdentity,
  TOOL_PART_STATE,
} from "@sidecar/session";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isRecord,
  isWireString,
  RECORD_EXTRA_KEYS,
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
import { countedNumber, wireUuidSchema } from "./service-wire.js";

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

export const READ_CURSOR_BOUNDS = {
  /** The most conversations one sequence cursor positions; the view's standing conversations never near it. */
  MAX_CONVERSATIONS: 256,
  MAX_ENCODED_LENGTH: 32_768,
} as const;

/** A tool's name or a call's id as the row spells it: read as written, refused only when empty. */
const writtenIdentifier: Schema<string> = s.text({ max: 256 });

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
function encodedCursorSchema<Value>(record: Schema<Value>): Schema<Value> {
  return s.reader<Value>({
    read: (value) => {
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
      return record.read(parsed);
    },
    jsonSchema: () => ({ type: "string", maxLength: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH }),
  });
}

function encodeCursor<Value>(record: Schema<Value>, value: UnparsedWireValue): string {
  const read = record.read(value);
  if (!read.ok) {
    throw new TypeError(`a cursor was minted outside its own shape: ${read.refusal}`);
  }
  return base64UrlEncode(JSON.stringify(read.value));
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

const sequencePositionSchema: Schema<SequencePosition> = s.record({
  conversationId: wireUuidSchema,
  seq: s.wholeNumber({ minimum: 0 }),
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

const sequenceReadCursorRecord: Schema<SequenceReadCursor> = s.refine(
  s.record({
    positions: s.array(sequencePositionSchema, { max: READ_CURSOR_BOUNDS.MAX_CONVERSATIONS }),
  }),
  positionsCanonical,
);

/** Reads a sequence cursor a device handed back, or refuses one this build did not mint the shape of. */
export const sequenceReadCursorSchema: Schema<SequenceReadCursor> =
  encodedCursorSchema(sequenceReadCursorRecord);

/** The cursor as an answer carries it: the encoded string, admitted only where it reads back as one this build mints. */
const encodedSequenceReadCursorSchema: Schema<string> = s.refine(
  s.text({ max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH, allowEmpty: true }),
  (encoded) => sequenceReadCursorSchema.parse(encoded) !== undefined,
);

/** Mints the one string that stands for these positions, whatever order they arrived in. */
export function encodeSequenceReadCursor(positions: Iterable<SequencePosition>): string {
  const sorted = [...positions].sort((a, b) =>
    compareCodePoints(a.conversationId, b.conversationId),
  );
  return encodeCursor(sequenceReadCursorRecord, {
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

const turnReadCursorRecord: Schema<TurnReadCursor> = s.record({
  changedAt: s.refine(s.text({ max: 40 }), (instant) => STORE_INSTANT_TEXT.test(instant)),
  id: wireUuidSchema,
});

export const turnReadCursorSchema: Schema<TurnReadCursor> =
  encodedCursorSchema(turnReadCursorRecord);

const encodedTurnReadCursorSchema: Schema<string> = s.refine(
  s.text({ max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH }),
  (encoded) => turnReadCursorSchema.parse(encoded) !== undefined,
);

export function encodeTurnReadCursor(cursor: TurnReadCursor): string {
  return encodeCursor(turnReadCursorRecord, { changedAt: cursor.changedAt, id: cursor.id });
}

/** The page bound a read may ask for: at least one row, at most the page's own maximum. */
export const readLimitSchema: Schema<number> = s.wholeNumber({
  minimum: 1,
  maximum: READ_PAGE_BOUNDS.MAX_LIMIT,
});

const sessionIdentitySchema: Schema<SessionIdentity> = s.record(
  { providerId: s.text(), providerSessionId: s.text() },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/**
 * One conversation the view is selected from, as the messages answer lists
 * them: the account's standing main, or an observed session's conversation
 * with the session it observes. A device drops the rows of a conversation an
 * answer no longer lists, which is how a Clear reaches a screen that already
 * drew the cleared rows.
 */
export type ConversationReadConversation =
  | { readonly id: string; readonly kind: typeof CONVERSATION_VIEW_SOURCE.MAIN }
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_VIEW_SOURCE.OBSERVED;
      readonly session: SessionIdentity;
    };

const conversationReadConversationSchema: Schema<ConversationReadConversation> = s.union([
  s.record(
    { id: wireUuidSchema, kind: s.literal(CONVERSATION_VIEW_SOURCE.MAIN) },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  s.record(
    {
      id: wireUuidSchema,
      kind: s.literal(CONVERSATION_VIEW_SOURCE.OBSERVED),
      session: sessionIdentitySchema,
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
]);

const conversationViewSourceSchema: Schema<ConversationViewSource> = s.union([
  s.record(
    { kind: s.literal(CONVERSATION_VIEW_SOURCE.MAIN) },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  s.record(
    { kind: s.literal(CONVERSATION_VIEW_SOURCE.OBSERVED), session: sessionIdentitySchema },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
]);

const TURN_ORIGIN_NAMES = Object.values(TURN_ORIGIN);
const TURN_STATUS_NAMES = Object.values(TURN_STATUS);
const TOOL_PART_STATE_NAMES = Object.values(TOOL_PART_STATE);
const CONVERSATION_EVENT_KIND_NAMES = Object.values(CONVERSATION_EVENT_KIND);
const ACTION_OUTCOME_NAMES = Object.values(CONVERSATION_VIEW_ACTION_OUTCOME);

/** The columns of a turn row a view reads, instants as epoch milliseconds. */
const conversationViewTurnSchema: Schema<ConversationViewTurn> = s.record(
  {
    id: wireUuidSchema,
    origin: s.enumOf(TURN_ORIGIN_NAMES),
    status: s.enumOf(TURN_STATUS_NAMES),
    queuedAt: countedNumber,
    startedAt: countedNumber.optional(),
    settledAt: countedNumber.optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const TOOL_PART_IDENTITY_FIELDS = {
  toolCallId: writtenIdentifier,
  toolName: writtenIdentifier,
  state: s.enumOf(TOOL_PART_STATE_NAMES),
} as const;

/** A tool call as the view decided it, the one fact of its kind the part alone cannot say beside it. */
const conversationViewToolPartSchema: Schema<ConversationViewToolPart> = s.union([
  s.record(
    {
      ...TOOL_PART_IDENTITY_FIELDS,
      kind: s.literal(CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE),
      unspoken: s.boolean(),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  s.record(
    {
      ...TOOL_PART_IDENTITY_FIELDS,
      kind: s.literal(CONVERSATION_VIEW_TOOL_KIND.ACTION),
      outcome: s.enumOf(ACTION_OUTCOME_NAMES),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  s.record(
    { ...TOOL_PART_IDENTITY_FIELDS, kind: s.literal(CONVERSATION_VIEW_TOOL_KIND.DETAIL) },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
]);

/**
 * A stored message as the wire carries it: the row's `UIMessage` exactly as
 * the service read it back. Holding it to the vocabulary is the reader's own
 * step, through `readStoredUIMessages` under the registry it holds, because
 * the SDK's validator and the tool registry both sit above this package; the
 * wire admits a record here and nothing narrower, so no second statement of
 * the message's shape can drift from the one the SDK makes.
 */
const storedMessageRecordSchema: Schema<WireRecord> = s.reader<WireRecord>({
  read: (value) => (isRecord(value) ? { ok: true, value } : refuse(SCHEMA_REFUSAL.MALFORMED)),
  jsonSchema: () => ({ type: "object", properties: {}, required: [], additionalProperties: false }),
});

/** Any JSON an event's payload holds, carried as it was written. */
const wireValueSchema: Schema<WireValue> = s.reader<WireValue>({
  read: (value) => (value === undefined ? refuse(SCHEMA_REFUSAL.MALFORMED) : { ok: true, value }),
  jsonSchema: () => ({ type: "object", properties: {}, required: [], additionalProperties: false }),
});

/** One message of a turn group: the stored row, its place in its conversation's sequence, and its tool calls as the view decided them. */
export interface ConversationReadMessage {
  readonly message: WireRecord;
  readonly seq: number;
  /** Epoch milliseconds the row was written at; the order across conversations. */
  readonly createdAt: number;
  readonly tools: readonly ConversationViewToolPart[];
}

const conversationReadMessageSchema: Schema<ConversationReadMessage> = s.record(
  {
    message: storedMessageRecordSchema,
    seq: s.wholeNumber({ minimum: 1 }),
    createdAt: countedNumber,
    tools: s.array(conversationViewToolPartSchema),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

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

const conversationReadTurnGroupSchema: Schema<ConversationReadTurnGroup> = s.record(
  {
    turnId: wireUuidSchema,
    conversationId: wireUuidSchema,
    source: conversationViewSourceSchema,
    turn: conversationViewTurnSchema.optional(),
    messages: s.array(conversationReadMessageSchema, { minimum: 1 }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

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

export const conversationMessagesAnswerSchema: Schema<ConversationMessagesAnswer> = s.record(
  {
    conversations: s.array(conversationReadConversationSchema, {
      max: READ_CURSOR_BOUNDS.MAX_CONVERSATIONS,
    }),
    groups: s.array(conversationReadTurnGroupSchema, { max: MAX_MESSAGE_GROUPS }),
    next: encodedSequenceReadCursorSchema,
    hasMore: s.boolean(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
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

const conversationReadEventSchema: Schema<ConversationReadEvent> = s.record(
  {
    id: wireUuidSchema,
    conversationId: wireUuidSchema,
    seq: s.wholeNumber({ minimum: 1 }),
    messageId: wireUuidSchema,
    kind: s.enumOf(CONVERSATION_EVENT_KIND_NAMES),
    deviceId: s.text().optional(),
    payload: wireValueSchema.optional(),
    createdAt: countedNumber,
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export interface ConversationEventsAnswer {
  readonly events: readonly ConversationReadEvent[];
  readonly next: string;
  readonly hasMore: boolean;
}

export const conversationEventsAnswerSchema: Schema<ConversationEventsAnswer> = s.record(
  {
    events: s.array(conversationReadEventSchema, { max: READ_PAGE_BOUNDS.MAX_LIMIT }),
    next: encodedSequenceReadCursorSchema,
    hasMore: s.boolean(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
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

const brainTurnRecordSchema: Schema<BrainTurnRecord> = s.record(
  {
    id: wireUuidSchema,
    conversationId: wireUuidSchema,
    origin: s.enumOf(TURN_ORIGIN_NAMES),
    status: s.enumOf(TURN_STATUS_NAMES),
    model: s.text().optional(),
    queuedAt: countedNumber,
    startedAt: countedNumber.optional(),
    settledAt: countedNumber.optional(),
    failure: s.text().optional(),
    cancelRequestedAt: countedNumber.optional(),
    cursor: encodedTurnReadCursorSchema,
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** The turns endpoint's answer; `next` is absent only when nothing has ever been taken and nothing stood to take. */
export interface BrainTurnsAnswer {
  readonly turns: readonly BrainTurnRecord[];
  readonly next?: string;
  readonly hasMore: boolean;
}

export const brainTurnsAnswerSchema: Schema<BrainTurnsAnswer> = s.record(
  {
    turns: s.array(brainTurnRecordSchema, { max: READ_PAGE_BOUNDS.MAX_LIMIT }),
    next: encodedTurnReadCursorSchema.optional(),
    hasMore: s.boolean(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
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

const presenceInstantSchema: Schema<number | null> = s.union([
  s.wholeNumber({ minimum: 0 }),
  s.literal(null),
]);

export const changesRequestSchema: Schema<ChangesRequest> = s.record({
  deviceId: wireUuidSchema,
  activeUntil: presenceInstantSchema.optional(),
  quietUntil: presenceInstantSchema.optional(),
});

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

export const changesAnswerSchema: Schema<ChangesAnswer> = s.record(
  {
    seen: s.boolean(),
    messages: encodedSequenceReadCursorSchema,
    events: encodedSequenceReadCursorSchema,
    turns: encodedTurnReadCursorSchema.optional(),
    rosterObservedAt: countedNumber.optional(),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
