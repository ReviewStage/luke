import { and, eq, isNull } from "drizzle-orm";
import {
  VOICE_DELEGATION_MODE,
  type VoiceCloseReason,
  type VoiceSessionUsage,
  voiceSessions,
} from "../db/voice-schema.js";
import type { HostedStoreDatabase } from "../hosted/store/database.js";

/**
 * The one row per live session the storage rework keeps, written only here.
 * Creation writes the row, so a later function connection can prove the
 * account asking to re-attach is the one that opened the session; every
 * `session.usage.updated` overwrites the usage with an unconfirmed snapshot,
 * never a sum, and only while the row is still open, so a snapshot arriving
 * late on an earlier connection cannot unconfirm a close; and `session.closed`
 * writes the confirmed seconds beside when and why the session ended. A connection that ends without `session.closed`
 * writes nothing more: the last snapshot standing with `closed_at` null is
 * the honest record, and a later connection's `session.closed` confirms it.
 * The seconds the quota meters are a separate ledger, `recordVoiceSeconds`.
 */
export interface VoiceSessionRecord {
  register(input: { userId: string; sessionId: string }): Promise<void>;
  /** Whether the account created the live session named: one lookup over the indexed pair. */
  owned(input: { userId: string; sessionId: string }): Promise<boolean>;
  noteUsage(input: { sessionId: string; seconds: number }): Promise<void>;
  close(input: { sessionId: string; seconds: number; reason: VoiceCloseReason }): Promise<void>;
}

type VoiceSessionDatabase = Pick<HostedStoreDatabase, "select" | "insert" | "update">;

export function voiceSessionRecord(
  database: VoiceSessionDatabase,
  now: () => number = Date.now,
): VoiceSessionRecord {
  const usage = (seconds: number, confirmed: boolean): VoiceSessionUsage => ({
    seconds,
    confirmed,
  });
  return {
    async register(input) {
      await database
        .insert(voiceSessions)
        .values({
          userId: input.userId,
          liveSessionId: input.sessionId,
          delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        })
        .onConflictDoNothing({ target: voiceSessions.liveSessionId });
    },
    async owned(input) {
      const [row] = await database
        .select({ id: voiceSessions.id })
        .from(voiceSessions)
        .where(
          and(
            eq(voiceSessions.userId, input.userId),
            eq(voiceSessions.liveSessionId, input.sessionId),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
    async noteUsage(input) {
      await database
        .update(voiceSessions)
        .set({ usage: usage(input.seconds, false) })
        .where(
          and(eq(voiceSessions.liveSessionId, input.sessionId), isNull(voiceSessions.closedAt)),
        );
    },
    async close(input) {
      await database
        .update(voiceSessions)
        .set({
          closedAt: new Date(now()),
          closeReason: input.reason,
          usage: usage(input.seconds, true),
        })
        .where(eq(voiceSessions.liveSessionId, input.sessionId));
    },
  };
}
