import assert from "node:assert/strict";
import { VOICE_DELEGATION_MODE, VOICE_SEGMENT_ROLE } from "@sidecar/database/voice-vocabulary";
import { afterAll, test } from "vitest";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  deleteUser,
  insertVoiceSession,
  insertVoiceTranscriptSegment,
  readVoiceSessionsByUserTyped,
  readVoiceTranscriptSegmentsBySession,
  type VoiceSegmentInsertRow,
  type VoiceSessionInsertRow,
} from "./support/store-rows";

/**
 * The voice tables have no reader yet, so what these tests hold to is the
 * shape the migration built: a session cascades with its account and its
 * segments with it, one live session is one row however many times it is
 * attached to, a segment's position is taken once, and the usage payload
 * keeps confirmed and unconfirmed seconds apart.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/**
 * What the `usage` column holds: the session's seconds and whether they are
 * the API's own confirmed count rather than the writer's elapsed estimate.
 */
interface VoiceSessionUsage {
  readonly seconds: number;
  readonly confirmed: boolean;
}

let liveSessions = 0;

interface SessionOverrides {
  readonly liveSessionId?: string;
  readonly deviceId?: string | null;
  readonly closedAt?: Date | null;
  readonly closeReason?: VoiceSessionInsertRow["closeReason"];
  readonly usage?: VoiceSessionUsage | null;
}

async function insertSession(userId: string, row: SessionOverrides = {}): Promise<string> {
  liveSessions += 1;
  return insertVoiceSession(database.run, {
    userId,
    liveSessionId: row.liveSessionId ?? `sess_${liveSessions}`,
    delegationMode: VOICE_DELEGATION_MODE.CLIENT,
    deviceId: row.deviceId,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    usage: row.usage,
  });
}

interface SegmentOverrides {
  readonly seq?: number;
  readonly role?: VoiceSegmentInsertRow["role"];
  readonly startMs?: number;
  readonly endMs?: number;
}

async function insertSegment(voiceSessionId: string, row: SegmentOverrides = {}): Promise<void> {
  await insertVoiceTranscriptSegment(database.run, {
    voiceSessionId,
    seq: row.seq ?? 1,
    role: row.role ?? VOICE_SEGMENT_ROLE.USER,
    text: "what is the fixture session waiting on",
    startMs: row.startMs ?? 1200,
    endMs: row.endMs ?? 4800,
  });
}

async function segmentCount(voiceSessionId: string): Promise<number> {
  return (await readVoiceTranscriptSegmentsBySession(database.run, voiceSessionId)).length;
}

/** One account's rows: two sessions, each with two segments. */
async function populateAccount(userId: string): Promise<string[]> {
  const sessions = [await insertSession(userId), await insertSession(userId)];
  for (const id of sessions) {
    await insertSegment(id);
    await insertSegment(id, {
      seq: 2,
      role: VOICE_SEGMENT_ROLE.ASSISTANT,
      startMs: 5000,
      endMs: 7100,
    });
  }
  return sessions;
}

test("a session and its segments cascade with the account, and no other account's", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  const gone = await populateAccount(userId);
  const kept = await populateAccount(other);

  await deleteUser(database.run, userId);

  assert.equal(
    (await readVoiceSessionsByUserTyped(database.run, userId)).length,
    0,
    "voice_sessions still holds rows for the deleted user",
  );
  for (const id of gone) assert.equal(await segmentCount(id), 0);
  assert.equal((await readVoiceSessionsByUserTyped(database.run, other)).length, 2);
  for (const id of kept) assert.equal(await segmentCount(id), 2);
});
