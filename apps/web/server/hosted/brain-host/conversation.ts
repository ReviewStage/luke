import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { SessionAuth } from "eve/context";
import { type CONVERSATION_KIND, conversations } from "../../db/storage-schema.js";
import type { HostedStoreDatabase } from "../store/database.js";
import type { ConversationTarget } from "../store/index.js";
import { conversationIdOf } from "./auth.js";
import { BRAIN_HOST_REFUSAL, type BrainHostRefusal } from "./bounds.js";

/**
 * The host's own check of who a session is for. eve authenticates a request
 * and pins the caller who created a session as its initiator, but it knows
 * nothing of conversations: which account a conversation belongs to is a
 * fact of the store, and the host enforces it here, before every tool call
 * and every write. A session is admitted for a conversation only when the
 * conversation the session was opened for exists, is not cleared, belongs to
 * the current caller, and the current caller is the one who opened the
 * session, so account B can neither speak into A's session nor be shown A's
 * rows through it. A conversation runs in one eve session at a time, the
 * one its row records: a session that is not the recorded one — one the
 * conversation rotated away from, whose hooks may still be firing — is
 * refused too, so two sessions never write one conversation. The record is
 * claimed by the session's own start, and only forward: eve's session ids
 * sort by the instant they were minted, so a start replayed for an older
 * session finds a newer one recorded and claims nothing.
 */

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export interface AdmittedConversation {
  readonly ok: true;
  readonly target: ConversationTarget;
  readonly kind: ConversationKind;
  /** The eve session id the conversation row last recorded, where one has been. */
  readonly runtimeSessionId: string | undefined;
}

export type ConversationAdmission =
  | AdmittedConversation
  | { readonly ok: false; readonly refusal: BrainHostRefusal };

/** The store's slice the check reads. */
export type ConversationDatabase = Pick<HostedStoreDatabase, "select" | "update">;

/** How a session stands to the conversation's record: it must be the recorded session, or it is the one claiming the record now. */
export const SESSION_STANDING = {
  CURRENT: "current",
  CLAIMING: "claiming",
} as const;

type SessionStanding = (typeof SESSION_STANDING)[keyof typeof SESSION_STANDING];

export async function admitConversation(
  db: ConversationDatabase,
  auth: SessionAuth,
  session: { readonly id: string; readonly standing: SessionStanding },
): Promise<ConversationAdmission> {
  const current = auth.current;
  if (!current) return { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_PRINCIPAL };
  const initiator = auth.initiator ?? current;
  if (initiator.principalId !== current.principalId) {
    return { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_INITIATOR };
  }
  const conversationId = conversationIdOf(initiator);
  if (!conversationId) return { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION };
  const [row] = await db
    .select({
      userId: conversations.userId,
      kind: conversations.kind,
      runtimeSessionId: conversations.runtimeSessionId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)));
  if (!row) return { ok: false, refusal: BRAIN_HOST_REFUSAL.NO_CONVERSATION };
  if (row.userId !== current.principalId) {
    return { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_OWNER };
  }
  if (session.standing === SESSION_STANDING.CURRENT && row.runtimeSessionId !== session.id) {
    return { ok: false, refusal: BRAIN_HOST_REFUSAL.NOT_CURRENT_SESSION };
  }
  return {
    ok: true,
    target: { userId: row.userId, conversationId },
    kind: row.kind,
    runtimeSessionId: row.runtimeSessionId ?? undefined,
  };
}

/** The account whose standing conversation recorded this runtime session; nothing while none has. */
export async function runtimeSessionOwner(
  db: Pick<HostedStoreDatabase, "select">,
  runtimeSessionId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(
      and(eq(conversations.runtimeSessionId, runtimeSessionId), isNull(conversations.deletedAt)),
    );
  return row?.userId;
}

/** Whether a conversation stands and belongs to the account. */
export async function conversationOwnedBy(
  db: Pick<HostedStoreDatabase, "select">,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), isNull(conversations.deletedAt)));
  return row?.userId === userId;
}

/**
 * Claims the conversation for the eve session now starting, only forward:
 * the row takes the id when it records none or an older one, and a start
 * replayed for a session the conversation has since rotated away from
 * changes nothing. Answers whether the row now records this session.
 */
export async function claimRuntimeSession(
  db: ConversationDatabase,
  target: ConversationTarget,
  runtimeSessionId: string,
  now: Date,
): Promise<boolean> {
  await db
    .update(conversations)
    .set({ runtimeSessionId, lastActivityAt: now })
    .where(
      and(
        eq(conversations.id, target.conversationId),
        eq(conversations.userId, target.userId),
        isNull(conversations.deletedAt),
        or(
          isNull(conversations.runtimeSessionId),
          lt(conversations.runtimeSessionId, runtimeSessionId),
        ),
      ),
    );
  const [row] = await db
    .select({ runtimeSessionId: conversations.runtimeSessionId })
    .from(conversations)
    .where(eq(conversations.id, target.conversationId));
  return row?.runtimeSessionId === runtimeSessionId;
}
