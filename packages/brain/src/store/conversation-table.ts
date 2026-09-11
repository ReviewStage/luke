import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import { type ConversationLineHit, tokenize } from "@sidecar/memory";
import {
  type ConversationAppendOutcome,
  type SessionKey,
  sessionKey as sessionKeyOf,
} from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  conversationEntryIdentity,
  maximumStoredConversationEntries,
  recordedAfterClear,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
} from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import { conversationCutoffEffect } from "./conversations-table.js";
import type { StoreDatabase } from "./database.js";
import { changedRows, columnsDecoded } from "./rows.js";

/**
 * The conversation's history as the panel draws it, kept apart from the
 * brain's generation: a line names the generation that stood when it was
 * written, for attribution alone, and answers to the thread's own retention
 * and to the Clear rather than to the generation's expiry.
 *
 * A row's columns are decoded through a schema; a row's stored payload is
 * not, and stays what it has always been — the entry as the session package
 * reads it back, dropping the row alone where this build cannot vouch for it.
 */

/** The two things a line needs of the standing lifetime's own row: which generation stands, and its Clear marker. */
const StandingLineageRow = Schema.Struct({
  session_id: Schema.String,
  reset_cleared_at: Schema.NullOr(Schema.Number),
});

const standingLineage = SqlSchema.findOne({
  Request: Schema.String,
  Result: StandingLineageRow,
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT session_id, reset_cleared_at FROM conversation_sessions
            WHERE session_key = ${key}`,
    ),
});

/**
 * The Clear cutoff before which no history line may stand: the later of the
 * standing generation's marker and the conversation's own durable cutoff,
 * which outlives the generation.
 */
export const conversationClearedAtEffect = (
  key: SessionKey,
): Effect.Effect<number | undefined, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const durable = yield* conversationCutoffEffect(key);
    const standing = yield* columnsDecoded(standingLineage(key));
    const marker = Option.flatMapNullable(standing, (row) => row.reset_cleared_at).pipe(
      Option.getOrUndefined,
    );
    if (durable === undefined) return marker;
    return marker === undefined ? durable : Math.max(durable, marker);
  });

/**
 * Appends lines to the conversation, idempotently. A line the thread
 * already holds by value is not written again — though it may now learn
 * the run it opened — and a run's ask or end already published is not
 * published twice however many windows report it. Each admitted line is
 * stamped with the generation standing at the write. Retention runs after
 * the appends, against the clock given, so the table never holds more than
 * the thread may show.
 */
export const appendConversationEffect = (
  key: SessionKey,
  entries: readonly ConversationEntry[],
  now: number,
): Effect.Effect<ConversationAppendOutcome<ConversationEntry>, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const standing = yield* columnsDecoded(standingLineage(key));
        const clearedAt = yield* conversationClearedAtEffect(key);
        const sessionId = Option.map(standing, (row) => row.session_id).pipe(Option.getOrUndefined);
        let changed = false;
        for (const entry of entries) {
          if (!conversationEntryAdmitted(entry, now, clearedAt)) continue;
          if (yield* appendOne(key, sessionId, entry)) changed = true;
        }
        // Nothing is removed here: stored lines answer to Delete conversation
        // and conversation maintenance, and the bound is the projection's alone.
        return { changed, entries: yield* listRetained(key, now, clearedAt) };
      }),
    ),
  );

const HeldLineRow = Schema.Struct({
  sequence: Schema.Number,
  request_id: Schema.NullOr(Schema.String),
});

const heldLine = SqlSchema.findOne({
  Request: Schema.Struct({ sessionKey: Schema.String, eventKey: Schema.String }),
  Result: HeldLineRow,
  execute: ({ sessionKey, eventKey }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT sequence, request_id FROM conversation_events
            WHERE session_key = ${sessionKey} AND event_key = ${eventKey}`,
    ),
});

const publishedLine = SqlSchema.findOne({
  Request: Schema.Struct({
    sessionKey: Schema.String,
    requestId: Schema.String,
    kind: Schema.String,
  }),
  Result: Schema.Struct({ published: Schema.Number }),
  execute: ({ sessionKey, requestId, kind }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT 1 AS published FROM conversation_events
            WHERE session_key = ${sessionKey} AND request_id = ${requestId} AND kind = ${kind}`,
    ),
});

const appendOne = (
  key: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const eventKey = conversationEventKey(entry);
    const held = yield* columnsDecoded(heldLine({ sessionKey: key, eventKey }));
    if (Option.isSome(held)) {
      if (held.value.request_id !== null || entry.requestId === undefined) return false;
      // The once-published index refuses the update when the run's line of
      // this kind already stands elsewhere; OR IGNORE turns the refusal into
      // no change, which is the whole of how the two are told apart.
      const changes = yield* changedRows(
        sql`UPDATE OR IGNORE conversation_events
            SET request_id = ${entry.requestId}, payload = ${conversationPayload(entry)}
            WHERE session_key = ${key} AND sequence = ${held.value.sequence}`.raw,
      );
      return changes > 0;
    }
    // Asked before the sequence is taken, so a publication the index would
    // refuse burns no number and the sequence stays dense.
    if (entry.requestId !== undefined) {
      const stands = yield* columnsDecoded(
        publishedLine({ sessionKey: key, requestId: entry.requestId, kind: entry.kind }),
      );
      if (Option.isSome(stands)) return false;
    }
    yield* insertLine(key, sessionId, entry);
    return true;
  });

const insertLine = (
  key: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const sequence = yield* nextConversationSequence(key);
    yield* sql`INSERT INTO conversation_events
                 (session_key, sequence, session_id, event_key, kind, words, recorded_at, request_id,
                  provider_id, provider_session_id, payload)
               VALUES (${key}, ${sequence}, ${sessionId ?? null}, ${conversationEventKey(entry)},
                       ${entry.kind}, ${entry.words}, ${entry.recordedAt},
                       ${entry.requestId ?? null}, ${entry.identity?.providerId ?? null},
                       ${entry.identity?.providerSessionId ?? null},
                       ${conversationPayload(entry)})`;
  });

const takenConversationSequence = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ sequence: Schema.Number }),
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`UPDATE conversations
            SET next_conversation_sequence = next_conversation_sequence + 1
            WHERE session_key = ${key}
            RETURNING next_conversation_sequence - 1 AS sequence`,
    ),
});

/** The conversation's next sequence, taken from its counter so a number is never handed out twice. */
const nextConversationSequence = (
  key: SessionKey,
): Effect.Effect<number, SqlError, Client.SqlClient> =>
  Effect.flatMap(columnsDecoded(takenConversationSequence(key)), (row) =>
    Option.match(row, {
      onNone: () => Effect.die(new Error(`no conversation stands at ${key}`)),
      onSome: ({ sequence }) => Effect.succeed(sequence),
    }),
  );

/** The thread as the panel draws it: retained lines in the order they happened, oldest first. */
export const listConversationEffect = (
  key: SessionKey,
  now: number,
): Effect.Effect<readonly ConversationEntry[], SqlError, Client.SqlClient> =>
  Effect.flatMap(conversationClearedAtEffect(key), (clearedAt) =>
    listRetained(key, now, clearedAt),
  );

const PayloadRow = Schema.Struct({ payload: Schema.String });

const retainedLines = SqlSchema.findAll({
  Request: Schema.Struct({
    sessionKey: Schema.String,
    now: Schema.Number,
    since: Schema.Number,
    after: Schema.Number,
    limit: Schema.Number,
  }),
  Result: PayloadRow,
  execute: ({ sessionKey, now, since, after, limit }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT payload FROM conversation_events
            WHERE session_key = ${sessionKey} AND recorded_at <= ${now}
              AND recorded_at >= ${since} AND recorded_at > ${after}
            ORDER BY recorded_at DESC, sequence DESC LIMIT ${limit}`,
    ),
});

const listRetained = (
  key: SessionKey,
  now: number,
  clearedAt: number | undefined,
): Effect.Effect<readonly ConversationEntry[], SqlError, Client.SqlClient> =>
  Effect.map(
    columnsDecoded(
      retainedLines({
        sessionKey: key,
        now,
        since: now - storedConversationMaximumAgeMs,
        after: clearedAt ?? -1,
        limit: maximumStoredConversationEntries,
      }),
    ),
    (rows) => {
      const entries: ConversationEntry[] = [];
      for (const row of [...rows].reverse()) {
        const entry = conversationEntryFromPayload(row.payload);
        if (entry) entries.push(entry);
      }
      return entries;
    },
  );

export type ConversationSearchHit = ConversationLineHit;

/** How many rows past the limit one page asks for, since the substring prefilter admits rows the token match will drop. */
const CONVERSATION_SEARCH_PAGE_MULTIPLIER = 4;
/** The most prefiltered rows one search reads before it answers what it has. */
export const CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS = 2_000;

const SearchRow = Schema.Struct({ session_key: Schema.String, payload: Schema.String });

const searchPage = SqlSchema.findAll({
  Request: Schema.Struct({
    sessionKeys: Schema.Array(Schema.String),
    tokens: Schema.Array(Schema.String),
    now: Schema.Number,
    since: Schema.Number,
    asked: Schema.Number,
    scanned: Schema.Number,
  }),
  Result: SearchRow,
  execute: ({ sessionKeys, tokens, now, since, asked, scanned }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT session_key, payload FROM conversation_events h
            WHERE session_key IN ${sql.in(sessionKeys)}
              AND recorded_at <= ${now} AND recorded_at >= ${since}
              AND recorded_at > COALESCE(
                (SELECT conversation_cleared_at FROM conversations c
                   WHERE c.session_key = h.session_key), -1)
              AND recorded_at > COALESCE(
                (SELECT reset_cleared_at FROM conversation_sessions s
                   WHERE s.session_key = h.session_key), -1)
              AND ${sql.and(tokens.map((token) => sql`instr(lower(words), ${token}) > 0`))}
            ORDER BY recorded_at DESC, sequence DESC LIMIT ${asked} OFFSET ${scanned}`,
    ),
});

/**
 * The retained lines of the conversations named that carry every token of
 * the query, most recent first and bounded by `limit`, in one query over
 * every conversation named. Matching is by token, as the score the caller
 * gives a hit is, so a multi-word or punctuated query keeps a line that
 * shares its words in another order. SQL narrows the scan by substring,
 * which admits a line holding a longer word ("deployment" for "deploy"); the
 * token check decides admission, and it runs before the limit is spent, over
 * pages of the prefiltered rows, so recent lines that only share a substring
 * never crowd an older exact match out of the answer. The scan itself is
 * bounded: past `CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS` prefiltered rows the
 * search answers what it admitted, so a match behind more substring-only
 * lines than that is not found rather than searched for without bound. Each
 * line stands only above its own conversation's cutoff — the durable one on
 * the conversation row and the standing generation's marker both — so a
 * Clear hides its lines here as it does everywhere.
 */
export const searchConversationEffect = (
  sessionKeys: readonly SessionKey[],
  query: string,
  limit: number,
  now: number,
): Effect.Effect<readonly ConversationSearchHit[], SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const tokens = [...tokenize(query)];
    if (tokens.length === 0 || sessionKeys.length === 0 || limit <= 0) return [];
    const pageSize = Math.min(
      limit * CONVERSATION_SEARCH_PAGE_MULTIPLIER,
      CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS,
    );
    const hits: ConversationSearchHit[] = [];
    let scanned = 0;
    while (hits.length < limit && scanned < CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS) {
      const asked = Math.min(pageSize, CONVERSATION_SEARCH_MAXIMUM_SCANNED_ROWS - scanned);
      const rows = yield* columnsDecoded(
        searchPage({
          sessionKeys,
          tokens,
          now,
          since: now - storedConversationMaximumAgeMs,
          asked,
          scanned,
        }),
      );
      scanned += rows.length;
      for (const row of rows) {
        if (hits.length >= limit) break;
        const entry = conversationEntryFromPayload(row.payload);
        if (!entry) continue;
        const held = tokenize(entry.words);
        if (!tokens.every((token) => held.has(token))) continue;
        hits.push({ sessionKey: sessionKeyOf(row.session_key), entry });
      }
      if (rows.length < asked) break;
    }
    return hits;
  });

/** Whether a canonical line may stand now: recorded no later than now and after any Clear. */
function conversationEntryAdmitted(
  entry: ConversationEntry,
  now: number,
  clearedAt: number | undefined,
): entry is ConversationEntry & { recordedAt: number } {
  if (!recordedAfterClear(entry, clearedAt)) return false;
  return entry.recordedAt <= now;
}

const EXPLICIT_EVENT_KEY_PREFIX = "event:";
const VALUE_EVENT_KEY_PREFIX = "value:";
/**
 * What an append is idempotent on: the line's identity, prefixed by which
 * kind it is so an id can never collide with a value key in the one column
 * that holds both.
 */
function conversationEventKey(entry: ConversationEntry): string {
  const identity = conversationEntryIdentity(entry);
  return entry.eventId !== undefined
    ? `${EXPLICIT_EVENT_KEY_PREFIX}${identity}`
    : `${VALUE_EVENT_KEY_PREFIX}${identity}`;
}

/** The payload a line is kept as, exactly the entry, so the projection is the record read back. */
function conversationPayload(entry: ConversationEntry): string {
  return JSON.stringify(entry);
}

/** A payload read back, or nothing for one this build cannot vouch for. */
function conversationEntryFromPayload(payload: string): ConversationEntry | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the stored-entry reader is the validation.
    return storedConversationEntry(JSON.parse(payload) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}

/**
 * The synchronous doors onto the effects above, for the callers that still
 * hold a handle rather than a client: the store's own tests today, and
 * whatever the operations table has not moved yet.
 *
 * @deprecated Each goes with the caller that holds it; P5-11 runs every
 * remaining one on the worker's own runtime edge.
 */
export function conversationClearedAt(
  database: StoreDatabase,
  key: SessionKey,
): number | undefined {
  return database.run(conversationClearedAtEffect(key));
}

/** @deprecated The synchronous door onto {@link appendConversationEffect}; see {@link conversationClearedAt}. */
export function appendConversation(
  database: StoreDatabase,
  key: SessionKey,
  entries: readonly ConversationEntry[],
  now: number,
): ConversationAppendOutcome<ConversationEntry> {
  return database.run(appendConversationEffect(key, entries, now));
}

/** @deprecated The synchronous door onto {@link listConversationEffect}; see {@link conversationClearedAt}. */
export function listConversation(
  database: StoreDatabase,
  key: SessionKey,
  now: number,
): readonly ConversationEntry[] {
  return database.run(listConversationEffect(key, now));
}

/** @deprecated The synchronous door onto {@link searchConversationEffect}; see {@link conversationClearedAt}. */
export function searchConversation(
  database: StoreDatabase,
  sessionKeys: readonly SessionKey[],
  query: string,
  limit: number,
  now: number,
): readonly ConversationSearchHit[] {
  return database.run(searchConversationEffect(sessionKeys, query, limit, now));
}
