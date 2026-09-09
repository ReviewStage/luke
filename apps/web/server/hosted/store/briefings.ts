import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { isWireString, type SessionKey, type UnparsedWireValue } from "../../core.js";
import { briefing } from "../../db/schema.js";
import { lockConversation } from "./conversations.js";
import type { HostedStoreDatabase, UserSeal } from "./database.js";

/**
 * A briefing's life: offered to whichever device is active, claimed by one of
 * them in one atomic update, then spoken by that device, pushed to a phone
 * when none was active, or expired unspoken. Every transition is a
 * conditional update on the state it leaves, so two devices racing for one
 * briefing cannot both claim it and a late report cannot move a briefing
 * backwards.
 */
export const BRIEFING_STATE = {
  OFFERED: "offered",
  CLAIMED: "claimed",
  SPOKEN: "spoken",
  PUSHED: "pushed",
  EXPIRED: "expired",
} as const;

export type BriefingState = (typeof BRIEFING_STATE)[keyof typeof BRIEFING_STATE];

const BRIEFING_STATE_LIST: readonly BriefingState[] = Object.values(BRIEFING_STATE);

export function isBriefingState(value: UnparsedWireValue): value is BriefingState {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && BRIEFING_STATE_LIST.includes(value as BriefingState);
}

/** The states a briefing may still leave: the two before anything was said of it. */
const OPEN_STATES: readonly BriefingState[] = [BRIEFING_STATE.OFFERED, BRIEFING_STATE.CLAIMED];

export interface BriefingInsert {
  readonly id: string;
  readonly sessionKey: SessionKey;
  readonly runId?: string;
  readonly words: string;
  readonly decidedAt: number;
  readonly expiresAt: number;
}

export interface BriefingRecord {
  readonly id: string;
  readonly sessionKey: SessionKey;
  readonly runId?: string;
  readonly words: string;
  readonly decidedAt: number;
  readonly expiresAt: number;
  readonly state: BriefingState;
  readonly claimedByDeviceId?: string;
  readonly claimedAt?: number;
  readonly settledAt?: number;
}

/** A row read back, or nothing for one whose words this ring cannot open; a bad row drops the row, not the list. */
function recordFromRow(
  seal: UserSeal,
  row: typeof briefing.$inferSelect,
): BriefingRecord | undefined {
  let words: string;
  try {
    words = seal.open(row.sealedWords);
  } catch {
    return undefined;
  }
  return {
    id: row.id,
    // SAFETY: the column holds the key the conversation row lock admitted when the briefing was recorded.
    sessionKey: row.sessionKey as SessionKey,
    ...(row.runId !== null ? { runId: row.runId } : undefined),
    words,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    state: isBriefingState(row.state) ? row.state : BRIEFING_STATE.EXPIRED,
    ...(row.claimedByDeviceId !== null ? { claimedByDeviceId: row.claimedByDeviceId } : undefined),
    ...(row.claimedAt !== null ? { claimedAt: row.claimedAt } : undefined),
    ...(row.settledAt !== null ? { settledAt: row.settledAt } : undefined),
  };
}

/**
 * Records a briefing the brain decided, offered from the moment it lands; an
 * id already recorded is one briefing. It runs under the conversation's row
 * lock, the same lock the conversation's delete takes, so a briefing is
 * recorded only for a conversation that still stands and a delete under way
 * either takes it or was never raced.
 */
export function insertBriefing(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  insert: BriefingInsert,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await lockConversation(tx, userId, insert.sessionKey))) return false;
    const inserted = await tx
      .insert(briefing)
      .values({
        id: insert.id,
        userId,
        sessionKey: insert.sessionKey,
        runId: insert.runId ?? null,
        sealedWords: seal.seal(insert.words),
        decidedAt: insert.decidedAt,
        expiresAt: insert.expiresAt,
        state: BRIEFING_STATE.OFFERED,
      })
      .onConflictDoNothing()
      .returning({ id: briefing.id });
    return inserted.length > 0;
  });
}

/** One device takes the briefing: only while it is offered and not yet due to expire, and only once. */
export async function claimBriefing(
  db: HostedStoreDatabase,
  userId: string,
  id: string,
  deviceId: string,
  now: number,
): Promise<boolean> {
  const claimed = await db
    .update(briefing)
    .set({ state: BRIEFING_STATE.CLAIMED, claimedByDeviceId: deviceId, claimedAt: now })
    .where(
      and(
        eq(briefing.userId, userId),
        eq(briefing.id, id),
        eq(briefing.state, BRIEFING_STATE.OFFERED),
        gt(briefing.expiresAt, now),
      ),
    )
    .returning({ id: briefing.id });
  return claimed.length > 0;
}

/** The device that claimed the briefing reports it said; no other device can. */
export async function markBriefingSpoken(
  db: HostedStoreDatabase,
  userId: string,
  id: string,
  deviceId: string,
  now: number,
): Promise<boolean> {
  const spoken = await db
    .update(briefing)
    .set({ state: BRIEFING_STATE.SPOKEN, settledAt: now })
    .where(
      and(
        eq(briefing.userId, userId),
        eq(briefing.id, id),
        eq(briefing.state, BRIEFING_STATE.CLAIMED),
        eq(briefing.claimedByDeviceId, deviceId),
      ),
    )
    .returning({ id: briefing.id });
  return spoken.length > 0;
}

/** The server pushed the briefing instead: from offered, or from a claim that never became speech. */
export async function markBriefingPushed(
  db: HostedStoreDatabase,
  userId: string,
  id: string,
  now: number,
): Promise<boolean> {
  const pushed = await db
    .update(briefing)
    .set({ state: BRIEFING_STATE.PUSHED, settledAt: now })
    .where(
      and(eq(briefing.userId, userId), eq(briefing.id, id), inArray(briefing.state, OPEN_STATES)),
    )
    .returning({ id: briefing.id });
  return pushed.length > 0;
}

/** Expires every open briefing whose time has come, answering the ids so each can be recorded as unspoken. */
export async function expireBriefings(
  db: HostedStoreDatabase,
  userId: string,
  now: number,
): Promise<readonly string[]> {
  const expired = await db
    .update(briefing)
    .set({ state: BRIEFING_STATE.EXPIRED, settledAt: now })
    .where(
      and(
        eq(briefing.userId, userId),
        inArray(briefing.state, OPEN_STATES),
        lte(briefing.expiresAt, now),
      ),
    )
    .returning({ id: briefing.id });
  return expired.map((row) => row.id);
}

export async function listBriefings(
  db: HostedStoreDatabase,
  seal: UserSeal,
  userId: string,
  state?: BriefingState,
): Promise<readonly BriefingRecord[]> {
  const rows = await db
    .select()
    .from(briefing)
    .where(
      and(eq(briefing.userId, userId), state !== undefined ? eq(briefing.state, state) : undefined),
    )
    .orderBy(asc(briefing.decidedAt), asc(briefing.id));
  return rows.flatMap((row) => recordFromRow(seal, row) ?? []);
}
