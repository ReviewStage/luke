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
  SCHEMA_REFUSAL,
  type SchemaRead,
  STANDING_RATING,
  type StandingRating,
  TURN_ORIGIN,
  TURN_STATUS,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { declareReader, readEither, wireRefusal } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Result, SchemaTransformation } from "effect";
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
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name; `conversation-client.ts`, `changes-client.ts`,
 * and `apps/web` read one through `readEither` and show it through
 * `emitJsonSchema`. Every record is a plain struct: whether a key a newer
 * service added is dropped or refused is the read's to say now, so an answer
 * is read through `readEither(schema, { excess: EXCESS_KEYS.DROP })` and a
 * request as declared, and the option each passes reaches every record nested
 * inside.
 */

/**
 * The bound of one read: the most rows one page answers. A device with more
 * to take asks again from the cursor the answer handed back. A row still
 * being written is a row like any other here: the cursor passes it, and the
 * conversation's revision in the cursor is what brings it back, so a page
 * never holds more than this.
 */
export const READ_PAGE_BOUNDS = {
  MAX_LIMIT: 200,
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
 * The value an Effect declaration admitted, or nothing, for a caller that
 * never has to tell one refusal from another. The read is the strict one: the
 * only declarations taken through it here are the cursors this build mints
 * itself, whose shape no newer service widens.
 */
function admitted<Value, Encoded>(
  schema: EffectSchema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Result.getOrUndefined(readEither(schema)(value));
}

/** An integer at or above its minimum, the way `s.wholeNumber({ minimum })` reads one. */
function wholeNumber(minimum: number) {
  return EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(minimum));
}

/**
 * A text settled with its ends trimmed and refused when nothing but
 * whitespace stands, the way `s.text()` reads one; `allowEmpty` skips that
 * refusal, the way `s.text({ allowEmpty: true })` does.
 */
function trimmedText(
  options: { readonly max?: number; readonly allowEmpty?: boolean } = {},
): EffectSchema.Codec<string, string> {
  const settled =
    options.allowEmpty === true
      ? EffectSchema.Trim
      : EffectSchema.Trim.check(EffectSchema.isNonEmpty());
  return options.max === undefined ? settled : settled.check(EffectSchema.isMaxLength(options.max));
}

/** A tool's name or a call's id as the row spells it: read as written, refused only when empty. */
const writtenIdentifier = trimmedText({ max: 256 });

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
function encodedCursorSchema<Value, Encoded>(record: EffectSchema.Codec<Value, Encoded>) {
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
      return Result.match(read(parsed), {
        onFailure: ({ refusal, path }) => ({ ok: false, refusal, path }),
        onSuccess: (value) => ({ ok: true, value }),
      });
    },
    { type: "string", maxLength: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH },
  );
}

function encodeCursor<Value, Encoded>(
  record: EffectSchema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): string {
  const read = readEither(record)(value);
  if (Result.isFailure(read)) {
    throw new TypeError(`a cursor was minted outside its own shape: ${read.failure.refusal}`);
  }
  return base64UrlEncode(JSON.stringify(read.success));
}

/**
 * Where a device's read of one conversation's numbered rows stands: the last
 * sequence it took, zero for none, and, for a resource whose rows can change
 * in place after they are numbered, the conversation's revision those rows
 * were read under. The service moves the revision on every in-place write,
 * so a head and a cursor read equal exactly when nothing was numbered or
 * written since; a resource whose rows never change carries none.
 */
export interface SequencePosition {
  readonly conversationId: string;
  readonly seq: number;
  readonly revision?: number;
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

const sequencePositionSchema = EffectSchema.Struct({
  conversationId: wireUuidSchema,
  seq: wholeNumber(0),
  revision: EffectSchema.optionalKey(wholeNumber(0)),
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

const sequenceReadCursorRecord = EffectSchema.Struct({
  positions: EffectSchema.Array(sequencePositionSchema).check(
    EffectSchema.isMaxLength(READ_CURSOR_BOUNDS.MAX_CONVERSATIONS),
  ),
}).check(EffectSchema.makeFilter(positionsCanonical));

/** Reads a sequence cursor a device handed back, or refuses one this build did not mint the shape of. */
export const sequenceReadCursorSchema = encodedCursorSchema(sequenceReadCursorRecord);

/** The cursor as an answer carries it: the encoded string, admitted only where it reads back as one this build mints. */
const encodedSequenceReadCursorSchema = trimmedText({
  max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH,
  allowEmpty: true,
}).check(
  EffectSchema.makeFilter((encoded) => admitted(sequenceReadCursorSchema, encoded) !== undefined),
);

/** Mints the one string that stands for these positions, whatever order they arrived in. */
export function encodeSequenceReadCursor(positions: Iterable<SequencePosition>): string {
  const sorted = [...positions].sort((a, b) =>
    compareCodePoints(a.conversationId, b.conversationId),
  );
  return encodeCursor(sequenceReadCursorRecord, {
    positions: sorted.map(({ conversationId, seq, revision }) => ({
      conversationId,
      seq,
      ...(revision === undefined ? undefined : { revision }),
    })),
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

const turnReadCursorRecord = EffectSchema.Struct({
  changedAt: trimmedText({ max: 40 }).check(
    EffectSchema.makeFilter((instant) => STORE_INSTANT_TEXT.test(instant)),
  ),
  id: wireUuidSchema,
});

export const turnReadCursorSchema = encodedCursorSchema(turnReadCursorRecord);

const encodedTurnReadCursorSchema = trimmedText({
  max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH,
}).check(
  EffectSchema.makeFilter((encoded) => admitted(turnReadCursorSchema, encoded) !== undefined),
);

export function encodeTurnReadCursor(cursor: TurnReadCursor): string {
  return encodeCursor(turnReadCursorRecord, { changedAt: cursor.changedAt, id: cursor.id });
}

/**
 * Where the children read stands: the instant the child that last changed
 * did, as the store renders it to the microsecond, and that child's id to
 * break a tie. A child changes when it is opened, when its latest turn is
 * queued, starts, or settles, when its completion reaches its parent, and
 * when a Clear stamps it out of the list, so the head moves exactly when the
 * list would read differently. The same shape
 * as a turn cursor, and opaque to a device all the same: the children read
 * takes no cursor, and a device compares the head to the one it last saw.
 */
export interface ChildrenHead {
  readonly changedAt: string;
  readonly id: string;
}

export const childrenHeadSchema = encodedCursorSchema(turnReadCursorRecord);

const encodedChildrenHeadSchema = trimmedText({
  max: READ_CURSOR_BOUNDS.MAX_ENCODED_LENGTH,
}).check(EffectSchema.makeFilter((encoded) => admitted(childrenHeadSchema, encoded) !== undefined));

export function encodeChildrenHead(head: ChildrenHead): string {
  return encodeCursor(turnReadCursorRecord, { changedAt: head.changedAt, id: head.id });
}

/** The page bound a read may ask for: at least one row, at most the page's own maximum. */
export const readLimitSchema = wholeNumber(1).check(
  EffectSchema.isLessThanOrEqualTo(READ_PAGE_BOUNDS.MAX_LIMIT),
);

const sessionIdentitySchema = EffectSchema.Struct({
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

const conversationReadConversationSchema = EffectSchema.Union([
  EffectSchema.Struct({
    id: wireUuidSchema,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.MAIN),
    openedAt: countedNumber,
  }),
  EffectSchema.Struct({
    id: wireUuidSchema,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.OBSERVED),
    session: sessionIdentitySchema,
  }),
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

const conversationViewSourceSchema = EffectSchema.Union([
  EffectSchema.Struct({ kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.MAIN) }),
  EffectSchema.Struct({
    kind: EffectSchema.Literal(CONVERSATION_VIEW_SOURCE.OBSERVED),
    session: sessionIdentitySchema,
  }),
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

const TURN_ORIGIN_NAMES = Object.values(TURN_ORIGIN);
const TURN_STATUS_NAMES = Object.values(TURN_STATUS);
const TOOL_PART_STATE_NAMES = Object.values(TOOL_PART_STATE);
const CONVERSATION_EVENT_KIND_NAMES = Object.values(CONVERSATION_EVENT_KIND);
const ACTION_OUTCOME_NAMES = Object.values(CONVERSATION_VIEW_ACTION_OUTCOME);

/** The columns of a turn row a view reads, instants as epoch milliseconds. */
const conversationViewTurnSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  origin: EffectSchema.Literals(TURN_ORIGIN_NAMES),
  status: EffectSchema.Literals(TURN_STATUS_NAMES),
  queuedAt: countedNumber,
  startedAt: EffectSchema.optionalKey(countedNumber),
  settledAt: EffectSchema.optionalKey(countedNumber),
});

const TOOL_PART_IDENTITY_FIELDS_EFFECT = {
  toolCallId: writtenIdentifier,
  toolName: writtenIdentifier,
  state: EffectSchema.Literals(TOOL_PART_STATE_NAMES),
} as const;

/** A tool call as the view decided it, the one fact of its kind the part alone cannot say beside it. */
const conversationViewToolPartSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE),
    unspoken: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.ACTION),
    outcome: EffectSchema.Literals(ACTION_OUTCOME_NAMES),
  }),
  EffectSchema.Struct({
    ...TOOL_PART_IDENTITY_FIELDS_EFFECT,
    kind: EffectSchema.Literal(CONVERSATION_VIEW_TOOL_KIND.DETAIL),
  }),
]).annotate(wireRefusal(SCHEMA_REFUSAL.MALFORMED));

/**
 * A stored message as the wire carries it: the row's `UIMessage` exactly as
 * the service read it back. Holding it to the vocabulary is the reader's own
 * step, through `readStoredUIMessages` under the registry it holds, because
 * the SDK's validator and the tool registry both sit above this package; the
 * wire admits a record here and nothing narrower, so no second statement of
 * the message's shape can drift from the one the SDK makes.
 */
const storedMessageRecordSchema = declareReader<WireRecord>(
  (value) => (isRecord(value) ? { ok: true, value } : refuse(SCHEMA_REFUSAL.MALFORMED)),
  { type: "object", properties: {}, required: [], additionalProperties: false },
);

/** Any JSON an event's payload holds, carried as it was written. */
const wireValueSchema = declareReader<WireValue>(
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
  readonly rating?: StandingRating;
}

const conversationReadMessageSchema = EffectSchema.Struct({
  message: storedMessageRecordSchema,
  seq: wholeNumber(1),
  createdAt: countedNumber,
  tools: EffectSchema.Array(conversationViewToolPartSchema),
  rating: EffectSchema.optionalKey(STANDING_RATING),
});

/**
 * The messages one turn wrote that the view selected, in sequence, under
 * the turn row where the store holds one. A group may continue on a later
 * page — a turn still running writes rows after a page was cut — so a device
 * merges groups by `turnId`, holds each message once by its id at the `seq`
 * and in the group its latest delivery gave it, and orders groups by their
 * earliest message, then the turn's queue instant, then the id, the order
 * the view itself keeps. The sequence is the store's order and the device's
 * cursor both, so a row the store moves — a spoken ask's line taken into
 * the turn that ran it, a turn's own rows placed behind the line that
 * arrived after them — takes a fresh sequence and is answered again past
 * every cursor; the device lets go of the copy it held at the old sequence,
 * a group emptied that way going with it. A message still being written is
 * answered on every read until it is finished, its parts as they then
 * stand, and the cursor passes it only then; a device replaces the message
 * it holds rather than keeping the first copy.
 */
export interface ConversationReadTurnGroup {
  readonly turnId: string;
  readonly conversationId: string;
  readonly source: ConversationViewSource;
  readonly turn?: ConversationViewTurn;
  readonly messages: readonly ConversationReadMessage[];
}

const conversationReadTurnGroupSchema = EffectSchema.Struct({
  turnId: wireUuidSchema,
  conversationId: wireUuidSchema,
  source: conversationViewSourceSchema,
  turn: EffectSchema.optionalKey(conversationViewTurnSchema),
  messages: EffectSchema.Array(conversationReadMessageSchema).check(EffectSchema.isMinLength(1)),
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

/** A group holds at least one row, so a page holds at most as many groups as rows. */
const MAX_MESSAGE_GROUPS = READ_PAGE_BOUNDS.MAX_LIMIT;

export const conversationMessagesAnswerSchema = EffectSchema.Struct({
  conversations: EffectSchema.Array(conversationReadConversationSchema).check(
    EffectSchema.isMaxLength(READ_CURSOR_BOUNDS.MAX_CONVERSATIONS),
  ),
  groups: EffectSchema.Array(conversationReadTurnGroupSchema).check(
    EffectSchema.isMaxLength(MAX_MESSAGE_GROUPS),
  ),
  next: encodedSequenceReadCursorSchema,
  hasMore: EffectSchema.Boolean,
});

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

const conversationReadEventSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  conversationId: wireUuidSchema,
  seq: wholeNumber(1),
  messageId: wireUuidSchema,
  kind: EffectSchema.Literals(CONVERSATION_EVENT_KIND_NAMES),
  deviceId: EffectSchema.optionalKey(trimmedText()),
  payload: EffectSchema.optionalKey(wireValueSchema),
  createdAt: countedNumber,
});

export interface ConversationEventsAnswer {
  readonly events: readonly ConversationReadEvent[];
  readonly next: string;
  readonly hasMore: boolean;
}

export const conversationEventsAnswerSchema = EffectSchema.Struct({
  events: EffectSchema.Array(conversationReadEventSchema).check(
    EffectSchema.isMaxLength(READ_PAGE_BOUNDS.MAX_LIMIT),
  ),
  next: encodedSequenceReadCursorSchema,
  hasMore: EffectSchema.Boolean,
});

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

const brainTurnRecordSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  conversationId: wireUuidSchema,
  origin: EffectSchema.Literals(TURN_ORIGIN_NAMES),
  status: EffectSchema.Literals(TURN_STATUS_NAMES),
  model: EffectSchema.optionalKey(trimmedText()),
  queuedAt: countedNumber,
  startedAt: EffectSchema.optionalKey(countedNumber),
  settledAt: EffectSchema.optionalKey(countedNumber),
  failure: EffectSchema.optionalKey(trimmedText()),
  cancelRequestedAt: EffectSchema.optionalKey(countedNumber),
  cursor: encodedTurnReadCursorSchema,
});

/** The turns endpoint's answer; `next` is absent only when nothing has ever been taken and nothing stood to take. */
export interface BrainTurnsAnswer {
  readonly turns: readonly BrainTurnRecord[];
  readonly next?: string;
  readonly hasMore: boolean;
}

export const brainTurnsAnswerSchema = EffectSchema.Struct({
  turns: EffectSchema.Array(brainTurnRecordSchema).check(
    EffectSchema.isMaxLength(READ_PAGE_BOUNDS.MAX_LIMIT),
  ),
  next: EffectSchema.optionalKey(encodedTurnReadCursorSchema),
  hasMore: EffectSchema.Boolean,
});

/**
 * Where a child stands, derived from its latest turn: accepted before one
 * runs (no turn yet, or one still queued), then the turn's own status. The
 * store derives it and the wire carries it; a child has no run record of its
 * own to fall out of step with.
 */
export const CHILD_STATUS = {
  ACCEPTED: "accepted",
  RUNNING: TURN_STATUS.RUNNING,
  SETTLED: TURN_STATUS.SETTLED,
  CANCELLED: TURN_STATUS.CANCELLED,
  FAILED: TURN_STATUS.FAILED,
} as const;

export type ChildStatus = (typeof CHILD_STATUS)[keyof typeof CHILD_STATUS];

const CHILD_STATUS_NAMES = Object.values(CHILD_STATUS);

/** The bounds of the children read: the most children one answer lists, and the most of a task's words it carries. */
export const CHILDREN_READ_BOUNDS = {
  MAX_CHILDREN: 100,
  TASK_EXCERPT_CHARS: 200,
} as const;

/** The kind of conversation a child was delegated from: the main, or an observed session's. */
const CHILD_PARENT_KIND_NAMES = Object.values(CONVERSATION_VIEW_SOURCE);

/**
 * One child as the children read answers it: the conversation a delegation
 * opened, under the conversation that delegated it, where it stands now. The
 * task is an excerpt — the first words the parent handed it, cut at
 * `TASK_EXCERPT_CHARS` — and never the child's own words or its result, which
 * are read as a conversation's messages are. The stamps are the latest turn's,
 * each absent until the turn reached it; `acceptedAt` is the child's own
 * opening. A child is answered whole on every read, so a device replaces the
 * child it holds by id rather than appending.
 */
export interface ChildRead {
  readonly id: string;
  readonly parentConversationId: string;
  readonly parentKind: ConversationViewSource["kind"];
  readonly label?: string;
  readonly task?: string;
  readonly status: ChildStatus;
  readonly acceptedAt: number;
  readonly startedAt?: number;
  readonly settledAt?: number;
  readonly failure?: string;
}

const childReadSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  parentConversationId: wireUuidSchema,
  parentKind: EffectSchema.Literals(CHILD_PARENT_KIND_NAMES),
  label: EffectSchema.optionalKey(trimmedText()),
  task: EffectSchema.optionalKey(trimmedText({ max: CHILDREN_READ_BOUNDS.TASK_EXCERPT_CHARS })),
  status: EffectSchema.Literals(CHILD_STATUS_NAMES),
  acceptedAt: countedNumber,
  startedAt: EffectSchema.optionalKey(countedNumber),
  settledAt: EffectSchema.optionalKey(countedNumber),
  failure: EffectSchema.optionalKey(trimmedText()),
});

/**
 * The children endpoint's answer: the account's standing children, newest
 * first, at most `MAX_CHILDREN` of them and no cursor, since a child's status
 * changes in place and the list is short. The change signal's `children` head
 * says when to read it again.
 */
export interface ChildrenAnswer {
  readonly children: readonly ChildRead[];
}

export const childrenAnswerSchema = EffectSchema.Struct({
  children: EffectSchema.Array(childReadSchema).check(
    EffectSchema.isMaxLength(CHILDREN_READ_BOUNDS.MAX_CHILDREN),
  ),
});

const unreadableRowSchema = EffectSchema.Struct({
  conversationId: wireUuidSchema,
  seq: wholeNumber(1),
});

/**
 * The one refusal a messages read answers with a body a device acts on: a
 * page holding a row this build cannot read is refused whole, naming the
 * row, and a device must surface it rather than draw the page as empty.
 */
const unreadableRowRefusalRecord = EffectSchema.Struct({
  error: EffectSchema.Literal(HOSTED_API_ERROR.UNREADABLE_ROW),
  unreadableRow: unreadableRowSchema,
});

export const unreadableRowRefusalSchema = unreadableRowRefusalRecord.pipe(
  EffectSchema.decodeTo(
    unreadableRowSchema,
    SchemaTransformation.transform<
      (typeof unreadableRowSchema)["Encoded"],
      (typeof unreadableRowRefusalRecord)["Type"]
    >({
      decode: (refusal) => refusal.unreadableRow,
      encode: (row) => ({ error: HOSTED_API_ERROR.UNREADABLE_ROW, unreadableRow: row }),
    }),
  ),
);

/**
 * The change-signal poll's request: the device asking, and what it reports
 * of itself on the way. `activeUntil` is the instant its presence holds
 * until, `quietUntil` the instant the quiet it observes ends — a meeting's
 * end, or the bounded instant a Mac restates its announcement pause or its
 * owed introduction as on every beat; each is epoch milliseconds, `null` to
 * clear the one on file, and absent to leave it. The service reports them and decides nothing from them here: what a
 * quiet instant does is hold speech, and holding is the whole of its power.
 */
export interface ChangesRequest {
  readonly deviceId: string;
  readonly activeUntil?: number | null;
  readonly quietUntil?: number | null;
}

const presenceInstantSchema = EffectSchema.Union([wholeNumber(0), EffectSchema.Null]).annotate(
  wireRefusal(SCHEMA_REFUSAL.MALFORMED),
);

export const changesRequestSchema = EffectSchema.Struct({
  deviceId: wireUuidSchema,
  activeUntil: EffectSchema.optionalKey(presenceInstantSchema),
  quietUntil: EffectSchema.optionalKey(presenceInstantSchema),
});

/**
 * Where every resource's read stands now: the cursor a device reading each
 * to its end would hold. A device compares each against the cursor it holds
 * and reads the resource whose head differs; `turns` is absent while the
 * account has no turn, `children` while no child was ever opened (a Clear
 * that stamped one moves the head rather than clearing it, since the list
 * reads differently after it), and `rosterObservedAt` while no roster
 * snapshot stands. `seen` says whether
 * the device row the request named is the account's, exactly as the
 * heartbeat says it; `false` tells the device to register again, and the
 * signal is answered either way.
 */
export interface ChangesAnswer {
  readonly seen: boolean;
  readonly messages: string;
  readonly events: string;
  readonly turns?: string;
  /** The children head: compared to the one last seen, since the children read takes no cursor. */
  readonly children?: string;
  /** Epoch milliseconds of the latest roster snapshot the scheduled observation wrote. */
  readonly rosterObservedAt?: number;
}

export const changesAnswerSchema = EffectSchema.Struct({
  seen: EffectSchema.Boolean,
  messages: encodedSequenceReadCursorSchema,
  events: encodedSequenceReadCursorSchema,
  turns: EffectSchema.optionalKey(encodedTurnReadCursorSchema),
  children: EffectSchema.optionalKey(encodedChildrenHeadSchema),
  rosterObservedAt: EffectSchema.optionalKey(countedNumber),
});
