import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import type { ConversationTarget } from "../store/index.js";

/**
 * The one read of a conversation's record the opener needs: the eve session
 * it runs in, where one has been recorded. It stands apart from the
 * admission in `conversation.ts` on purpose. The admission reads the caller
 * through the door's authenticators, which import the eve package, and the
 * opener's bundle is the scheduled tick's function, which talks to eve over
 * HTTP and must load nothing of eve's own code; a leaf with no path to the
 * door is what keeps the tick's bundle free of it.
 */

const StandingSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("runtime_session_id"),
  ),
});

const findStandingSession = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: StandingSessionSchema,
  execute: (target) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`
        select runtime_session_id
        from conversations
        where id = ${target.conversationId} and user_id = ${target.userId} and deleted_at is null
      `,
    ),
});

/** The eve session the account's own standing conversation runs in, where one has been recorded; a cleared or foreign conversation records none. */
export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}
