import { and, eq, isNull } from "drizzle-orm";
import type { SessionIdentity } from "../../core.js";
import { CONVERSATION_KIND, conversations } from "../../db/storage-schema.js";
import type { HostedStoreDatabase } from "./database.js";

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
async function standingObservedConversationId(
  db: Pick<HostedStoreDatabase, "select">,
  userId: string,
  identity: SessionIdentity,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        eq(conversations.kind, CONVERSATION_KIND.OBSERVED),
        eq(conversations.providerId, identity.providerId),
        eq(conversations.providerSessionId, identity.providerSessionId),
        isNull(conversations.deletedAt),
      ),
    );
  return row?.id;
}

/** The id of the account's standing observed conversation for the session, opened now where none stood. */
export async function standingObservedConversation(
  db: Pick<HostedStoreDatabase, "select" | "insert">,
  userId: string,
  identity: SessionIdentity,
  now: Date,
): Promise<string | undefined> {
  const standing = await standingObservedConversationId(db, userId, identity);
  if (standing !== undefined) return standing;
  await db
    .insert(conversations)
    .values({
      userId,
      kind: CONVERSATION_KIND.OBSERVED,
      providerId: identity.providerId,
      providerSessionId: identity.providerSessionId,
      createdAt: now,
      lastActivityAt: now,
    })
    .onConflictDoNothing({
      target: [conversations.userId, conversations.providerId, conversations.providerSessionId],
    });
  return standingObservedConversationId(db, userId, identity);
}
