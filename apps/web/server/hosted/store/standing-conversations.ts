import { Effect, type Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "./database.js";

/**
 * The conversations the Conversation view is selected from: the account's
 * standing main and every standing observed conversation, each with the
 * session it observes and the next sequence its counters would hand out. A
 * row Clear stamped is not standing and is listed by nothing here, which is
 * how a cleared main leaves a device's cursor and its screen at once; a
 * child's and a thread's rows never cross into the view and are not listed.
 * Main comes first and the observed conversations follow in id order, so
 * every device pages the same conversations in the same order. The main
 * carries the instant it was opened, which is where the view's window
 * starts: a Clear opens a new main, and what an observed conversation wrote
 * before that instant belongs to the thread the developer cleared.
 */
export type StandingConversation =
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_KIND.MAIN;
      readonly openedAt: Date;
      readonly nextMessageSeq: number;
      readonly nextEventSeq: number;
      /** Moved by every write to a numbered row in place; with the sequence, the whole of what a messages read can be behind on. */
      readonly journalRevision: number;
    }
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_KIND.OBSERVED;
      readonly providerId: string;
      readonly providerSessionId: string;
      readonly nextMessageSeq: number;
      readonly nextEventSeq: number;
      /** Moved by every write to a numbered row in place; with the sequence, the whole of what a messages read can be behind on. */
      readonly journalRevision: number;
    };

type StandingConversationFailure = SqlError | Schema.SchemaError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** The row as `conversations` holds it for the view: only a main or an observed row ever reaches this select. */
const StandingConversationRowSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([CONVERSATION_KIND.MAIN, CONVERSATION_KIND.OBSERVED]),
  providerId: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  nextMessageSeq: EpochMillisColumnSchema,
  nextEventSeq: EpochMillisColumnSchema,
  journalRevision: EpochMillisColumnSchema,
}).pipe(
  Schema.encodeKeys({
    providerId: "provider_id",
    providerSessionId: "provider_session_id",
    createdAt: "created_at",
    nextMessageSeq: "next_message_seq",
    nextEventSeq: "next_event_seq",
    journalRevision: "journal_revision",
  }),
);

const findStandingConversations = SqlSchema.findAll({
  Request: Schema.String,
  Result: StandingConversationRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id, kind, provider_id, provider_session_id, created_at,
               next_message_seq, next_event_seq, journal_revision
        from conversations
        where user_id = ${userId}
          and kind in (${CONVERSATION_KIND.MAIN}, ${CONVERSATION_KIND.OBSERVED})
          and deleted_at is null
        order by kind asc, id asc
      `,
    ),
});

export function standingConversations(
  userId: string,
): Effect.Effect<
  readonly StandingConversation[],
  StandingConversationFailure,
  SqlClient.SqlClient
> {
  return Effect.map(findStandingConversations(userId), (rows) => {
    const standing: StandingConversation[] = [];
    for (const row of rows) {
      const counters = {
        nextMessageSeq: row.nextMessageSeq,
        nextEventSeq: row.nextEventSeq,
        journalRevision: row.journalRevision,
      };
      if (row.kind === CONVERSATION_KIND.MAIN) {
        standing.push({ id: row.id, kind: row.kind, openedAt: row.createdAt, ...counters });
        continue;
      }
      // An observed row without its session is a row no observation wrote, and it observes nothing the view could name.
      if (row.providerId === null || row.providerSessionId === null) continue;
      standing.push({
        id: row.id,
        kind: row.kind,
        providerId: row.providerId,
        providerSessionId: row.providerSessionId,
        ...counters,
      });
    }
    return standing;
  });
}

/**
 * A conversation a device pages on its own, apart from the view: one of the
 * account's standing children or observed conversations, with the instant it
 * was opened and the counters its page is read against. A main is never
 * paged this way, since the view already is its page, and a stamped row is
 * standing for nothing.
 */
export interface PagedConversation {
  readonly id: string;
  readonly createdAt: Date;
  readonly nextMessageSeq: number;
  readonly nextEventSeq: number;
  readonly journalRevision: number;
}

const PagedConversationRowSchema = Schema.Struct({
  id: Schema.String,
  createdAt: InstantColumnSchema,
  nextMessageSeq: EpochMillisColumnSchema,
  nextEventSeq: EpochMillisColumnSchema,
  journalRevision: EpochMillisColumnSchema,
}).pipe(
  Schema.encodeKeys({
    createdAt: "created_at",
    nextMessageSeq: "next_message_seq",
    nextEventSeq: "next_event_seq",
    journalRevision: "journal_revision",
  }),
);

const findPagedConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: PagedConversationRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select id, created_at, next_message_seq, next_event_seq, journal_revision
        from conversations
        where user_id = ${request.userId}
          and id = ${request.conversationId}
          and kind in (${CONVERSATION_KIND.CHILD}, ${CONVERSATION_KIND.OBSERVED})
          and deleted_at is null
      `,
    ),
});

/** One of the account's standing child or observed conversations by id, or none: a main's id, a stamped row's, or another account's finds nothing. */
export function pagedConversation(
  userId: string,
  conversationId: string,
): Effect.Effect<
  Option.Option<PagedConversation>,
  StandingConversationFailure,
  SqlClient.SqlClient
> {
  return findPagedConversation({ userId, conversationId });
}

/**
 * One of the account's conversations as the brain's own `sessions_list`
 * names it: the row's kind, the label a delegation gave a child, the session
 * an observed conversation observes, and when it was opened and last
 * written to. Unlike the view's listing above, a child's row is listed
 * here, since the brain lists its own conversations; a thread's still is
 * not, and nothing hosted opens one.
 */
export interface ConversationDirectoryEntry {
  readonly id: string;
  readonly kind:
    | typeof CONVERSATION_KIND.MAIN
    | typeof CONVERSATION_KIND.OBSERVED
    | typeof CONVERSATION_KIND.CHILD;
  readonly label: string | null;
  readonly providerSessionId: string | null;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
}

const ConversationDirectoryRowSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    CONVERSATION_KIND.MAIN,
    CONVERSATION_KIND.OBSERVED,
    CONVERSATION_KIND.CHILD,
  ]),
  label: Schema.NullOr(Schema.String),
  providerSessionId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  lastActivityAt: InstantColumnSchema,
}).pipe(
  Schema.encodeKeys({
    providerSessionId: "provider_session_id",
    createdAt: "created_at",
    lastActivityAt: "last_activity_at",
  }),
);

const findConversationDirectory = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, limit: Schema.Number }),
  Result: ConversationDirectoryRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select id, kind, label, provider_session_id, created_at, last_activity_at
        from conversations
        where user_id = ${request.userId}
          and kind in (${CONVERSATION_KIND.MAIN}, ${CONVERSATION_KIND.OBSERVED}, ${CONVERSATION_KIND.CHILD})
          and deleted_at is null
        order by last_activity_at desc, id asc
        limit ${request.limit}
      `,
    ),
});

/** The account's standing main, observed, and child conversations, most recently written to first and at most `limit` of them. */
export function conversationDirectory(
  userId: string,
  limit: number,
): Effect.Effect<
  readonly ConversationDirectoryEntry[],
  StandingConversationFailure,
  SqlClient.SqlClient
> {
  return findConversationDirectory({ userId, limit });
}
