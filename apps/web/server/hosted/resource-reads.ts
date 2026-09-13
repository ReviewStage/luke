import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { readEither } from "@sidecar/wire/effect";
import { Data, Effect, type Schema as EffectSchema, Either, type ParseResult } from "effect";
import {
  type BrainTurnRecord,
  type BrainTurnsAnswer,
  type ClientUIMessage,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_VIEW_SOURCE,
  type ConversationEventsAnswer,
  type ConversationMessagesAnswer,
  type ConversationReadConversation,
  type ConversationReadEvent,
  type ConversationReadMessage,
  type ConversationReadTurnGroup,
  type ConversationViewEvent,
  type ConversationViewObservedConversation,
  type ConversationViewSource,
  type ConversationViewStoredMessage,
  type ConversationViewTurn,
  clientUIMessage,
  encodeSequenceReadCursor,
  encodeTurnReadCursor,
  RATING_EVENT_PAYLOAD,
  READ_PAGE_BOUNDS,
  READ_QUERY,
  readLimitSchema,
  type SequencePosition,
  type SequenceReadCursor,
  selectConversationView,
  sequenceReadCursorSchema,
  type TurnReadCursor,
  turnReadCursorSchema,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  type WireValue,
} from "../core.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { CATALOG_TOOL_SET, CATALOG_VIEW_TOOL_KINDS } from "./brain-tool-set.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { makeRateBrake } from "./rate-brake.js";
import type {
  HostedStore,
  StandingConversation,
  StoredEventRecord,
  StoredMessageRecord,
  StoredTurnRecord,
} from "./store/index.js";

/**
 * The per-resource reads a device polls: the Conversation's messages as the
 * view selects them, the events about those messages, and the account's
 * turns, each behind a cursor the device holds and the answer moves. There is
 * no feed and no endpoint that answers everything. Every read goes through
 * the store, never a table: a message page is read back under the catalog's
 * registry, and a page holding a row this build cannot read is refused whole,
 * naming the row, rather than answered without it. The view is D1's
 * `selectConversationView`, run here over the page's rows with the catalog's
 * own classification of which tools announce and which act; the route
 * composes its input and words nothing.
 *
 * The brake is generous enough for every device a person owns to poll each
 * resource every few seconds and tight enough that a client stuck in a loop
 * is a trickle.
 */
const READ_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 180,
  MAX_TRACKED_USERS: 10_000,
} as const;

const readBrake = makeRateBrake({
  windowMs: READ_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: READ_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: READ_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface ResourceReadOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  store: Pick<HostedStore, "messages" | "events" | "turns" | "directory">;
}

/** What a read answers: an effect over the ambient client, run by the store route's own edge. */
type ReadEffect<A> = Effect.Effect<A, SqlError | ParseResult.ParseError, SqlClient.SqlClient>;

type ReadGate = { readonly userId: string; readonly query: URLSearchParams } | Response;

/** The gate every read shares, in the hosted order: method, bearer, brake. */
function readGate(options: ResourceReadOptions): Effect.Effect<ReadGate> {
  return Effect.gen(function* () {
    const { request, resolveUserId } = options;
    if (request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }
    const userId = yield* Effect.promise(() => resolveUserId(request));
    if (!userId) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }
    if (!(yield* readBrake.check(userId))) {
      return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
    }
    return { userId, query: new URL(request.url).searchParams };
  });
}

interface ReadPage<Cursor> {
  readonly after: Cursor | undefined;
  readonly limit: number;
}

/**
 * The page a query asks for: a cursor an earlier answer minted, or none for
 * the beginning, and a bound inside the page's own. A cursor this build did
 * not mint the shape of, or a bound outside it, is the one refusal, so a
 * refused request says nothing about which was wrong.
 */
function readPage<Cursor>(
  query: URLSearchParams,
  cursorSchema: EffectSchema.Schema<Cursor, UnparsedWireValue>,
): ReadPage<Cursor> | undefined {
  const afterText = query.get(READ_QUERY.AFTER);
  const after =
    afterText === null ? undefined : Either.getOrUndefined(readEither(cursorSchema)(afterText));
  if (afterText !== null && after === undefined) return undefined;
  const limitText = query.get(READ_QUERY.LIMIT);
  const limit =
    limitText === null
      ? READ_PAGE_BOUNDS.MAX_LIMIT
      : Either.getOrUndefined(readEither(readLimitSchema)(Number(limitText)));
  if (limit === undefined) return undefined;
  return { after, limit };
}

function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

function viewSource(conversation: StandingConversation): ConversationViewSource {
  return conversation.kind === CONVERSATION_KIND.MAIN
    ? { kind: CONVERSATION_VIEW_SOURCE.MAIN }
    : {
        kind: CONVERSATION_VIEW_SOURCE.OBSERVED,
        session: {
          providerId: conversation.providerId,
          providerSessionId: conversation.providerSessionId,
        },
      };
}

function readConversation(conversation: StandingConversation): ConversationReadConversation {
  if (conversation.kind === CONVERSATION_KIND.MAIN) {
    return {
      id: conversation.id,
      kind: CONVERSATION_VIEW_SOURCE.MAIN,
      openedAt: conversation.openedAt.getTime(),
    };
  }
  return {
    id: conversation.id,
    kind: CONVERSATION_VIEW_SOURCE.OBSERVED,
    session: {
      providerId: conversation.providerId,
      providerSessionId: conversation.providerSessionId,
    },
  };
}

/**
 * Where the view's window starts: the instant the standing main was opened.
 * A Clear stamps the main and its descendants and opens a new main, but an
 * observed conversation is the brain's own per-session context and is never
 * stamped, so its rows from before the new main opened would otherwise keep
 * crossing into a thread the developer just emptied. The window is a cut on
 * what a read returns, not a rule of the view's selection, which stays pure.
 */
function viewWindowStart(standing: readonly StandingConversation[]): Date | undefined {
  const main = standing.find((conversation) => conversation.kind === CONVERSATION_KIND.MAIN);
  return main?.kind === CONVERSATION_KIND.MAIN ? main.openedAt : undefined;
}

/** The row a page could not read back under the registry, named so the answer can say which. */
class UnreadableRow extends Data.TaggedError("UnreadableRow")<{
  readonly row: { readonly conversationId: string; readonly seq: number };
}> {}

/** A page's worth of one conversation's numbered rows, taken in the directory's order. */
interface TakenRows<Row> {
  readonly conversation: StandingConversation;
  readonly rows: readonly Row[];
}

interface SequenceWalk<Row> {
  readonly taken: readonly TakenRows<Row>[];
  readonly next: string;
  readonly hasMore: boolean;
}

/**
 * Where a resource's numbered rows stand for one conversation: the last
 * sequence handed out and, for a resource whose rows can change in place
 * after they are numbered, the revision those writes have reached. A
 * resource whose rows never change carries no revision, and its cursor none.
 */
interface SequenceHead {
  readonly seq: number;
  readonly revision?: number;
}

/** Where a read of one conversation starts: after this sequence, and, where the head carries one, after this revision. */
interface SequenceAfter {
  readonly seq: number;
  readonly revision?: number;
}

/** How a walk reads a row: its place in the sequence, and the revision it was last written in place under, where the resource keeps one. */
interface SequenceRowReading<Row> {
  readonly seqOf: (row: Row) => number;
  readonly revisionOf?: (row: Row) => number | undefined;
}

/**
 * Walks the standing conversations in the directory's order, taking each
 * one's rows past the cursor's position until the page is full. A
 * conversation the cursor stands level with is left where it stands, one the
 * page has no room left for keeps its position and marks more, and a
 * position for a conversation no longer standing is dropped, which is how a
 * Clear leaves the cursor. The head is the counters' word, so `hasMore` says
 * whether rows stood past a page the bound cut rather than guessing from a
 * full page.
 *
 * A row still being written is passed like any other: the cursor takes its
 * sequence, and the conversation's journal revision beside it, which the
 * store moves on every write to a numbered row in place. A read from an
 * earlier revision answers the rows written since, whatever their sequence,
 * first and in the order they were written, then the rows past the sequence;
 * so a device is handed the running turn's journal again exactly when it
 * changed, and once more when it finished, and holds a stale copy of no row
 * for longer than one poll. A cursor minted before rows carried a revision,
 * or for a resource whose rows never change, stands level with the head's
 * revision: the sequence alone says what it has yet to read. A read that
 * answers nothing up to the head passes the head: every row up to it exists,
 * so a read that cut them all is one whose window they fall outside of, for
 * good.
 */
function walkSequences<Row, Failure>(
  standing: readonly StandingConversation[],
  page: ReadPage<SequenceReadCursor>,
  headOf: (conversation: StandingConversation) => SequenceHead,
  read: (
    conversation: StandingConversation,
    after: SequenceAfter,
    limit: number,
  ) => Effect.Effect<readonly Row[], Failure, SqlClient.SqlClient>,
  reading: SequenceRowReading<Row>,
): Effect.Effect<SequenceWalk<Row>, Failure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const positions = new Map(
      (page.after?.positions ?? []).map((position) => [position.conversationId, position]),
    );
    const next: SequencePosition[] = [];
    const taken: TakenRows<Row>[] = [];
    let remaining = page.limit;
    let hasMore = false;
    const at = (conversationId: string, seq: number, revision: number | undefined) => {
      next.push({ conversationId, seq, ...(revision === undefined ? undefined : { revision }) });
    };
    for (const conversation of standing) {
      const head = headOf(conversation);
      const position = positions.get(conversation.id);
      const from = position?.seq ?? 0;
      const revision =
        head.revision === undefined ? undefined : (position?.revision ?? head.revision);
      const behindInPlace = head.revision !== undefined && (revision ?? 0) < head.revision;
      if (from >= head.seq && !behindInPlace) {
        at(conversation.id, from, head.revision);
        continue;
      }
      if (remaining === 0) {
        at(conversation.id, from, revision);
        hasMore = true;
        continue;
      }
      const fetched = yield* read(
        conversation,
        { seq: from, ...(revision === undefined ? undefined : { revision }) },
        remaining,
      );
      const last = fetched.at(-1);
      remaining -= fetched.length;
      taken.push({ conversation, rows: fetched });
      if (last === undefined) {
        at(conversation.id, head.seq, head.revision);
        continue;
      }
      const lastSeq = reading.seqOf(last);
      const cut = fetched.length > 0 && remaining === 0 && lastSeq < head.seq;
      if (cut) hasMore = true;
      // A page cut among the rows written in place, which stand at or before
      // the position and come first, keeps the position and names the last
      // revision it took; one that reached the rows past the position took
      // every row written in place with it and stands at the head's revision.
      if (cut && lastSeq <= from) {
        at(conversation.id, from, reading.revisionOf?.(last) ?? revision);
        continue;
      }
      at(conversation.id, Math.max(from, lastSeq), head.revision);
    }
    return { taken, next: encodeSequenceReadCursor(next), hasMore };
  });
}

/**
 * A stored message as the view reads it. A row no turn owns stands in a
 * group of its own under its message id, with no turn row beside it, rather
 * than being left out of the view.
 */
function viewRow(record: StoredMessageRecord): ConversationViewStoredMessage {
  return {
    message: record.message,
    seq: record.seq,
    turnId: record.turnId ?? record.id,
    createdAt: record.createdAt.getTime(),
  };
}

function viewTurn(turn: StoredTurnRecord): ConversationViewTurn {
  return {
    id: turn.id,
    origin: turn.origin,
    status: turn.status,
    queuedAt: turn.queuedAt.getTime(),
    ...(turn.startedAt ? { startedAt: turn.startedAt.getTime() } : undefined),
    ...(turn.settledAt ? { settledAt: turn.settledAt.getTime() } : undefined),
  };
}

function viewEvent(event: StoredEventRecord): ConversationViewEvent {
  const rating =
    event.kind === CONVERSATION_EVENT_KIND.RATING
      ? // SAFETY: the payload column is jsonb, which the driver hands back as the JSON it holds; the read is the validation.
        Either.getOrUndefined(
          readEither(RATING_EVENT_PAYLOAD)(unparsedWire(event.payload as WireBoundaryInput)),
        )
      : undefined;
  return {
    messageId: event.messageId,
    kind: event.kind,
    seq: event.seq,
    ...(rating === undefined ? undefined : { rating }),
  };
}

/**
 * The wire's message with the stored row, in the one shape a route may hand a
 * device, in place of the record the wire admits; the JSON is the same. The
 * shape is minted by the strip alone, so a stored row cannot reach this
 * answer with its replay slot still on it.
 */
type ServerReadMessage = Omit<ConversationReadMessage, "message"> & {
  readonly message: ClientUIMessage;
};

type ServerTurnGroup = Omit<ConversationReadTurnGroup, "messages"> & {
  readonly messages: readonly ServerReadMessage[];
};

type ServerMessagesAnswer = Omit<ConversationMessagesAnswer, "groups"> & {
  readonly groups: readonly ServerTurnGroup[];
};

/** GET: the view over the page's rows, grouped by turn, with the cursor to read on from. */
export function handleConversationMessages(options: ResourceReadOptions): ReadEffect<Response> {
  return Effect.gen(function* () {
    const gate = yield* readGate(options);
    if (gate instanceof Response) return gate;
    const { userId, query } = gate;
    const page = readPage(query, sequenceReadCursorSchema);
    if (!page) return invalidRequest();
    const { store } = options;

    const standing = yield* store.directory.standing(userId);
    const windowStart = viewWindowStart(standing);
    const walked = yield* Effect.catchTag(
      walkSequences(
        standing,
        page,
        (conversation) => ({
          seq: conversation.nextMessageSeq - 1,
          revision: conversation.journalRevision,
        }),
        (conversation, after, limit) => {
          const since = conversation.kind === CONVERSATION_KIND.OBSERVED ? windowStart : undefined;
          return Effect.flatMap(
            store.messages.list(userId, conversation.id, CATALOG_TOOL_SET, {
              after: after.seq,
              limit,
              ...(after.revision !== undefined ? { revisionAfter: after.revision } : undefined),
              ...(since !== undefined ? { since } : undefined),
            }),
            (read) =>
              read.ok
                ? Effect.succeed(read.value)
                : Effect.fail(
                    new UnreadableRow({ row: { conversationId: conversation.id, seq: read.seq } }),
                  ),
          );
        },
        { seqOf: (record) => record.seq, revisionOf: (record) => record.revision },
      ),
      "UnreadableRow",
      (unreadable) => Effect.succeed(unreadable),
    );
    if (walked instanceof UnreadableRow) {
      return errorResponse(HOSTED_HTTP_STATUS.INTERNAL_ERROR, HOSTED_API_ERROR.UNREADABLE_ROW, {
        unreadableRow: walked.row,
      });
    }
    const walk: SequenceWalk<StoredMessageRecord> = walked;

    const main: ConversationViewStoredMessage[] = [];
    const observed: ConversationViewObservedConversation[] = [];
    const conversationOfTurn = new Map<string, StandingConversation>();
    const messageIds: string[] = [];
    for (const { conversation, rows } of walk.taken) {
      const viewRows = rows.map(viewRow);
      for (const row of viewRows) conversationOfTurn.set(row.turnId, conversation);
      for (const record of rows) messageIds.push(record.id);
      if (conversation.kind === CONVERSATION_KIND.MAIN) main.push(...viewRows);
      else {
        observed.push({
          session: {
            providerId: conversation.providerId,
            providerSessionId: conversation.providerSessionId,
          },
          messages: viewRows,
        });
      }
    }
    const [turns, events] = yield* Effect.all([
      store.turns.named(userId, [...conversationOfTurn.keys()]),
      store.events.forMessages(userId, messageIds),
    ]);
    const groups = selectConversationView({
      main,
      observed,
      turns: turns.map(viewTurn),
      events: events.map(viewEvent),
      toolKinds: CATALOG_VIEW_TOOL_KINDS,
    });

    const answer: ServerMessagesAnswer = {
      conversations: standing.map(readConversation),
      groups: groups.map((group) => {
        const conversation = conversationOfTurn.get(group.turnId);
        if (conversation === undefined) throw new Error("the view grouped a row no page held");
        return {
          turnId: group.turnId,
          conversationId: conversation.id,
          source: viewSource(conversation),
          ...(group.turn ? { turn: group.turn } : undefined),
          messages: group.messages.map((message) => ({
            message: clientUIMessage(message.message),
            seq: message.seq,
            createdAt: message.createdAt,
            tools: message.tools,
            ...(message.rating === undefined ? undefined : { rating: message.rating }),
          })),
        };
      }),
      next: walk.next,
      hasMore: walk.hasMore,
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  });
}

function readEvent(event: StoredEventRecord): ConversationReadEvent {
  return {
    id: event.id,
    conversationId: event.conversationId,
    seq: event.seq,
    messageId: event.messageId,
    kind: event.kind,
    ...(event.deviceId !== undefined ? { deviceId: event.deviceId } : undefined),
    // SAFETY: the payload column is jsonb, which the driver hands back as the JSON it holds.
    ...(event.payload !== undefined ? { payload: event.payload as WireValue } : undefined),
    createdAt: event.createdAt.getTime(),
  };
}

/** GET: the events about the view's conversations' messages, each conversation's in its own sequence. */
export function handleConversationEvents(options: ResourceReadOptions): ReadEffect<Response> {
  return Effect.gen(function* () {
    const gate = yield* readGate(options);
    if (gate instanceof Response) return gate;
    const { userId, query } = gate;
    const page = readPage(query, sequenceReadCursorSchema);
    if (!page) return invalidRequest();
    const { store } = options;

    const standing = yield* store.directory.standing(userId);
    // An event is written once and never changed, so its head is the sequence alone.
    const walk = yield* walkSequences(
      standing,
      page,
      (conversation) => ({ seq: conversation.nextEventSeq - 1 }),
      (conversation, after, limit) =>
        store.events.list(userId, conversation.id, { after: after.seq, limit }),
      { seqOf: (event) => event.seq },
    );

    const answer: ConversationEventsAnswer = {
      events: walk.taken.flatMap(({ rows }) => rows.map(readEvent)),
      next: walk.next,
      hasMore: walk.hasMore,
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  });
}

function readTurn(turn: StoredTurnRecord): BrainTurnRecord {
  return {
    ...viewTurn(turn),
    conversationId: turn.conversationId,
    ...(turn.model !== null ? { model: turn.model } : undefined),
    ...(turn.failure !== null ? { failure: turn.failure } : undefined),
    ...(turn.cancelRequestedAt
      ? { cancelRequestedAt: turn.cancelRequestedAt.getTime() }
      : undefined),
    cursor: encodeTurnReadCursor(turn.cursor),
  };
}

/** GET: the account's turns past the cursor in the order they last changed, so a turn is answered again when a stamp on it moves. */
export function handleBrainTurns(options: ResourceReadOptions): ReadEffect<Response> {
  return Effect.gen(function* () {
    const gate = yield* readGate(options);
    if (gate instanceof Response) return gate;
    const { userId, query } = gate;
    const page = readPage<TurnReadCursor>(query, turnReadCursorSchema);
    if (!page) return invalidRequest();
    const { store } = options;

    const rows = yield* store.turns.list(userId, { after: page.after, limit: page.limit });
    // An empty page moves the cursor back to the last turn at or before it: a cursor can name a turn
    // a Clear has since taken, behind which the remaining turns all stand earlier, and echoing it
    // would leave the device asking the same empty page forever. Read after the page, and never past
    // the cursor, so a turn that landed meanwhile is answered by the next read rather than jumped.
    const last =
      rows.at(-1)?.cursor ??
      (page.after === undefined ? undefined : yield* store.turns.latest(userId, page.after));
    const hasMore = rows.length === page.limit;
    const answer: BrainTurnsAnswer = {
      turns: rows.map(readTurn),
      ...(last !== undefined ? { next: encodeTurnReadCursor(last) } : undefined),
      hasMore,
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  });
}
