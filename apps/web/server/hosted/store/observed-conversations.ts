import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { SessionIdentity } from "../../core.js";
import { db } from "../../db/query.js";
import { conversations } from "../../db/storage-schema.js";
import { CONVERSATION_KIND } from "../../db/storage-vocabulary.js";

/**
 * The conversation the brain keeps for one observed session: a row of kind
 * `observed`, keyed by the provider and the session's id there, opened on
 * the first transcript change that names the session and standing for every later
 * one. The unique index over the three is what makes two openers landing at
 * once one row: the loser's insert does nothing and both read the same id
 * back. A row Clear stamped is not standing, and an observed conversation is
 * never Clear's to stamp, so a stamped one is another build's doing and is
 * answered as no conversation rather than reopened beside it. The row also
 * keeps the session's title and workspace name as the roster last showed
 * them, written on the open and refreshed on every later wake, so a device
 * can name the agent once its own roster no longer lists the session.
 */

/** How a statement here fails: the driver's own refusal, or a row this build could not decode. */
type ObservedConversationFailure = SqlError | Schema.SchemaError;

/** What the roster calls the session at a wake: its title, and the name of the workspace holding it where the provider reports one. */
export interface ObservedSessionNaming {
  readonly title: string;
  readonly workspace?: string;
}

const ObservedSessionSchema = Schema.Struct({
  userId: Schema.String,
  providerId: Schema.String,
  providerSessionId: Schema.String,
});

const ConversationIdRowSchema = Schema.Struct({ id: Schema.String });

const findStandingObservedConversationId = SqlSchema.findOneOption({
  Request: ObservedSessionSchema,
  Result: ConversationIdRowSchema,
  execute: (request) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, request.userId),
          eq(conversations.kind, CONVERSATION_KIND.OBSERVED),
          eq(conversations.providerId, request.providerId),
          eq(conversations.providerSessionId, request.providerSessionId),
          isNull(conversations.deletedAt),
        ),
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

const NamingColumnsSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  workspace: Schema.NullOr(Schema.String),
});

const insertObservedConversation = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    providerId: Schema.String,
    providerSessionId: Schema.String,
    now: Schema.Date,
    ...NamingColumnsSchema.fields,
  }),
  execute: (write) =>
    db
      .insert(conversations)
      .values({
        userId: write.userId,
        kind: CONVERSATION_KIND.OBSERVED,
        providerId: write.providerId,
        providerSessionId: write.providerSessionId,
        createdAt: write.now,
        lastActivityAt: write.now,
        title: write.title,
        workspace: write.workspace,
      })
      .onConflictDoNothing({
        target: [conversations.userId, conversations.providerId, conversations.providerSessionId],
      }),
});

/**
 * A name the row already carries is no change at all. The builder has no
 * operator for a comparison that counts two nulls as equal, so each column's
 * is a fragment; both stand inside the one rendered statement.
 */
const movedNaming = (title: string | null, workspace: string | null) =>
  or(
    sql`${conversations.title} is distinct from ${title}`,
    sql`${conversations.workspace} is distinct from ${workspace}`,
  );

/** The row's naming follows the roster's: a write that changes nothing touches no row. */
const refreshObservedNaming = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String, ...NamingColumnsSchema.fields }),
  execute: (write) =>
    db
      .update(conversations)
      .set({ title: write.title, workspace: write.workspace })
      .where(and(eq(conversations.id, write.id), movedNaming(write.title, write.workspace))),
});

/** The naming as the columns hold it: a blank title or workspace is no name at all. */
function namingColumns(naming: ObservedSessionNaming | undefined) {
  const settled = (text: string | undefined) => {
    const trimmed = text?.trim();
    return trimmed ? trimmed : null;
  };
  return { title: settled(naming?.title), workspace: settled(naming?.workspace) };
}

/**
 * The id of the account's standing observed conversation for the session,
 * opened now where none stood, its naming brought level with the roster's
 * where a wake carries one; a caller with no roster for the session (one it
 * has let go) leaves the naming as it stands.
 */
export const standingObservedConversation = /* @__PURE__ */ Effect.fn(
  "standingObservedConversation",
)(function* (
  userId: string,
  identity: SessionIdentity,
  now: Date,
  naming?: ObservedSessionNaming,
): Effect.fn.Return<string | undefined, ObservedConversationFailure, SqlClient.SqlClient> {
  const standing = yield* standingObservedConversationId(userId, identity);
  if (standing !== undefined) {
    if (naming) yield* refreshObservedNaming({ id: standing, ...namingColumns(naming) });
    return standing;
  }
  yield* insertObservedConversation({
    userId,
    providerId: identity.providerId,
    providerSessionId: identity.providerSessionId,
    now,
    ...namingColumns(naming),
  });
  return yield* standingObservedConversationId(userId, identity);
});
