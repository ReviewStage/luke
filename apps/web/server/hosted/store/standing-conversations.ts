import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type ParseResult, Schema } from "effect";
import { CONVERSATION_KIND } from "../../db/schema.js";
import { EpochMillisColumnSchema } from "./database.js";

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
    }
  | {
      readonly id: string;
      readonly kind: typeof CONVERSATION_KIND.OBSERVED;
      readonly providerId: string;
      readonly providerSessionId: string;
      readonly nextMessageSeq: number;
      readonly nextEventSeq: number;
    };

type StandingConversationFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

/** The row as `conversations` holds it for the view: only a main or an observed row ever reaches this select. */
const StandingConversationRowSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal(CONVERSATION_KIND.MAIN, CONVERSATION_KIND.OBSERVED),
  providerId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("provider_id"),
  ),
  providerSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("provider_session_id"),
  ),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  nextMessageSeq: Schema.propertySignature(EpochMillisColumnSchema).pipe(
    Schema.fromKey("next_message_seq"),
  ),
  nextEventSeq: Schema.propertySignature(EpochMillisColumnSchema).pipe(
    Schema.fromKey("next_event_seq"),
  ),
});

const findStandingConversations = SqlSchema.findAll({
  Request: Schema.String,
  Result: StandingConversationRowSchema,
  execute: (userId) =>
    statement(
      (sql) => sql`
        select id, kind, provider_id, provider_session_id, created_at, next_message_seq, next_event_seq
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
      const counters = { nextMessageSeq: row.nextMessageSeq, nextEventSeq: row.nextEventSeq };
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
