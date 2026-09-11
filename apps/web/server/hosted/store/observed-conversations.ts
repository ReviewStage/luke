import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import type { SessionIdentity } from "../../core.js";
import { CONVERSATION_KIND } from "../../db/storage-schema.js";

/**
 * The conversation the brain keeps for one observed session: a row of kind
 * `observed`, keyed by the provider and the session's id there, opened on
 * the first roster diff that names the session and standing for every later
 * one. The unique index over the three is what makes two openers landing at
 * once one row: the loser's insert does nothing and both read the same id
 * back. A row Clear stamped is not standing, and an observed conversation is
 * never Clear's to stamp, so a stamped one is another build's doing and is
 * answered as no conversation rather than reopened beside it.
 */

/** How a statement here fails: the driver's own refusal, or a row this build could not decode. */
type ObservedConversationFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const ObservedSessionSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
});

const ConversationIdRowSchema = Schema.Struct({ id: Schema.String });

const findStandingObservedConversationId = SqlSchema.findOne({
  Request: ObservedSessionSchema,
  Result: ConversationIdRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select id from conversations
        where user_id = ${request.userId}
          and kind = ${CONVERSATION_KIND.OBSERVED}
          and provider_id = ${request.providerId}
          and provider_session_id = ${request.providerSessionId}
          and deleted_at is null
      `,
    ),
});

function standingObservedConversationId(
  userId: string,
  identity: SessionIdentity,
): Effect.Effect<string | undefined, ObservedConversationFailure, SqlClient.SqlClient> {
  return Effect.map(
    findStandingObservedConversationId({
      userId,
      providerId: identity.providerId,
      providerSessionId: identity.providerSessionId,
    }),
    (row) => Option.getOrUndefined(Option.map(row, (found) => found.id)),
  );
}

const insertObservedConversation = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    providerId: Schema.String,
    providerSessionId: Schema.String,
    now: Schema.DateFromSelf,
  }),
  execute: (write) =>
    statement(
      (sql) => sql`
        insert into conversations (
          user_id, kind, provider_id, provider_session_id, created_at, last_activity_at
        )
        values (
          ${write.userId}, ${CONVERSATION_KIND.OBSERVED}, ${write.providerId},
          ${write.providerSessionId}, ${write.now}, ${write.now}
        )
        on conflict (user_id, provider_id, provider_session_id) do nothing
      `,
    ),
});

/** The id of the account's standing observed conversation for the session, opened now where none stood. */
export function standingObservedConversation(
  userId: string,
  identity: SessionIdentity,
  now: Date,
): Effect.Effect<string | undefined, ObservedConversationFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const standing = yield* standingObservedConversationId(userId, identity);
    if (standing !== undefined) return standing;
    yield* insertObservedConversation({
      userId,
      providerId: identity.providerId,
      providerSessionId: identity.providerSessionId,
      now,
    });
    return yield* standingObservedConversationId(userId, identity);
  });
}
