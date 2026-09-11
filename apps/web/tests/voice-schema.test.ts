import assert from "node:assert/strict";
import { afterAll, test } from "vitest";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSessionUsage,
} from "../server/db/voice-schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  assertRefusedWithCode,
  deleteDevice,
  deleteUser,
  deleteVoiceSession,
  insertDevice,
  insertVoiceSession,
  insertVoiceTranscriptSegment,
  POSTGRES_ERROR,
  readVoiceSessionByIdTyped,
  readVoiceSessionsByUserTyped,
  readVoiceTranscriptSegmentsBySession,
} from "./support/store-rows";

/**
 * The voice tables have no reader yet, so what these tests hold to is the
 * shape the migration built: a session cascades with its account and its
 * segments with it, one live session is one row however many times it is
 * attached to, a segment's position is taken once, a device's departure
 * leaves the session's record standing, and the usage payload keeps confirmed
 * and unconfirmed seconds apart.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

let liveSessions = 0;

interface SessionOverrides {
  readonly liveSessionId?: string;
  readonly deviceId?: string | null;
  readonly closedAt?: Date | null;
  readonly closeReason?: string | null;
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
  readonly role?: string;
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

test("deleting a session takes its segments and leaves its neighbour's", async () => {
  const userId = await database.createUser();
  const [gone, kept] = await populateAccount(userId);
  assert.ok(gone !== undefined && kept !== undefined);

  await deleteVoiceSession(database.run, gone);

  assert.equal(await segmentCount(gone), 0);
  assert.equal(await segmentCount(kept), 2);
});

test("one live session is one row, for its owner and for anyone else", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await insertSession(userId, { liveSessionId: "sess_shared" });

  await assertRefusedWithCode(
    insertSession(userId, { liveSessionId: "sess_shared" }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await assertRefusedWithCode(
    insertSession(other, { liveSessionId: "sess_shared" }),
    POSTGRES_ERROR.UNIQUE_VIOLATION,
  );
  await insertSession(userId, { liveSessionId: "sess_other" });

  const owners = (await readVoiceSessionsByUserTyped(database.run, userId)).filter(
    (row) => row.liveSessionId === "sess_shared",
  );
  assert.deepEqual(
    owners.map((row) => row.userId),
    [userId],
  );
});

test("a segment's position is taken once within its session and free in another", async () => {
  const userId = await database.createUser();
  const [first, second] = await populateAccount(userId);
  assert.ok(first !== undefined && second !== undefined);

  await assertRefusedWithCode(insertSegment(first, { seq: 2 }), POSTGRES_ERROR.UNIQUE_VIOLATION);
  await insertSegment(first, { seq: 3 });
  await insertSegment(second, { seq: 3 });

  assert.equal(await segmentCount(first), 3);
  assert.equal(await segmentCount(second), 3);
});

test("a device's departure leaves the session's record standing with the device named", async () => {
  const userId = await database.createUser();
  await insertDevice(database.run, {
    id: "device-1",
    userId,
    installationId: `install-${userId}`,
    platform: "macos",
  });
  const id = await insertSession(userId, { deviceId: "device-1" });

  await deleteDevice(database.run, "device-1");

  const row = await readVoiceSessionByIdTyped(database.run, id);
  assert.ok(row);
  assert.equal(row.deviceId, "device-1");
});

test("a new session is open with no close, no reason, and no usage; a closed one keeps all three", async () => {
  const userId = await database.createUser();
  const opened = await insertSession(userId);
  const open = await readVoiceSessionByIdTyped(database.run, opened);
  assert.ok(open);
  assert.ok(open.startedAt instanceof Date);
  assert.equal(open.closedAt, null);
  assert.equal(open.closeReason, null);
  assert.equal(open.usage, null);
  assert.equal(open.delegationMode, VOICE_DELEGATION_MODE.CLIENT);

  const closedAt = new Date("2026-09-10T22:00:00.000Z");
  const confirmed: VoiceSessionUsage = { seconds: 184, confirmed: true };
  const estimated: VoiceSessionUsage = { seconds: 61, confirmed: false };
  const cleanly = await insertSession(userId, {
    closedAt,
    closeReason: VOICE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: confirmed,
  });
  const lost = await insertSession(userId, {
    closedAt,
    closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
    usage: estimated,
  });

  const rows = await readVoiceSessionsByUserTyped(database.run, userId);
  const byId = new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, closedAt: row.closedAt, closeReason: row.closeReason, usage: row.usage },
    ]),
  );
  assert.deepEqual(byId.get(cleanly), {
    id: cleanly,
    closedAt,
    closeReason: VOICE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: confirmed,
  });
  assert.deepEqual(byId.get(lost), {
    id: lost,
    closedAt,
    closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
    usage: estimated,
  });
});

test("the close reasons are the Live API's five, and a segment's role is one of the two speaking roles", () => {
  assert.deepEqual(Object.values(VOICE_CLOSE_REASON).sort(), [
    "close_requested",
    "connection_lost",
    "content",
    "expired",
    "remote_hangup",
  ]);
  assert.deepEqual(Object.values(VOICE_SEGMENT_ROLE).sort(), ["assistant", "user"]);
  assert.deepEqual(Object.values(VOICE_DELEGATION_MODE).sort(), ["client", "responses"]);
});
