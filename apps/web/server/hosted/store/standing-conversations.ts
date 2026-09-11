import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { CONVERSATION_KIND, conversations } from "../../db/schema.js";
import type { HostedStoreDatabase } from "./database.js";

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

const VIEW_KINDS = [CONVERSATION_KIND.MAIN, CONVERSATION_KIND.OBSERVED];

export async function standingConversations(
  db: HostedStoreDatabase,
  userId: string,
): Promise<readonly StandingConversation[]> {
  const rows = await db
    .select({
      id: conversations.id,
      kind: conversations.kind,
      providerId: conversations.providerId,
      providerSessionId: conversations.providerSessionId,
      createdAt: conversations.createdAt,
      nextMessageSeq: conversations.nextMessageSeq,
      nextEventSeq: conversations.nextEventSeq,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        inArray(conversations.kind, VIEW_KINDS),
        isNull(conversations.deletedAt),
      ),
    )
    .orderBy(asc(conversations.kind), asc(conversations.id));
  const standing: StandingConversation[] = [];
  for (const row of rows) {
    const counters = { nextMessageSeq: row.nextMessageSeq, nextEventSeq: row.nextEventSeq };
    if (row.kind === CONVERSATION_KIND.MAIN) {
      standing.push({ id: row.id, kind: row.kind, openedAt: row.createdAt, ...counters });
      continue;
    }
    // An observed row without its session is a row no observation wrote, and it observes nothing the view could name.
    if (row.kind !== CONVERSATION_KIND.OBSERVED || !row.providerId || !row.providerSessionId) {
      continue;
    }
    standing.push({
      id: row.id,
      kind: row.kind,
      providerId: row.providerId,
      providerSessionId: row.providerSessionId,
      ...counters,
    });
  }
  return standing;
}
