import assert from "node:assert/strict";
import { eq, getTableName, type SQL, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, test } from "vitest";
import { user } from "../server/db/auth-schema";
import { devices } from "../server/db/devices-schema";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSessionUsage,
  voiceSessions,
  voiceTranscriptSegments,
} from "../server/db/voice-schema";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

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

const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the driver's error, so the Postgres code stands on the cause rather than the top. */
async function assertUniqueViolation(insert: Promise<unknown>): Promise<void> {
  await assert.rejects(insert, (error) => {
    assert.ok(error instanceof Error);
    const { cause } = error;
    assert.ok(cause instanceof Error && "code" in cause);
    assert.equal(cause.code, UNIQUE_VIOLATION);
    return true;
  });
}

let liveSessions = 0;

async function insertSession(
  userId: string,
  row: Partial<typeof voiceSessions.$inferInsert> = {},
): Promise<string> {
  liveSessions += 1;
  const [inserted] = await database.db
    .insert(voiceSessions)
    .values({
      userId,
      liveSessionId: `sess_${liveSessions}`,
      delegationMode: VOICE_DELEGATION_MODE.CLIENT,
      ...row,
    })
    .returning({ id: voiceSessions.id });
  assert.ok(inserted);
  return inserted.id;
}

async function insertSegment(
  voiceSessionId: string,
  row: Partial<typeof voiceTranscriptSegments.$inferInsert> = {},
): Promise<void> {
  await database.db.insert(voiceTranscriptSegments).values({
    voiceSessionId,
    seq: 1,
    role: VOICE_SEGMENT_ROLE.USER,
    text: "what is the fixture session waiting on",
    startMs: 1200,
    endMs: 4800,
    ...row,
  });
}

async function countRows(table: PgTable, where: SQL): Promise<number> {
  const [row] = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row?.count ?? 0;
}

async function segmentCount(voiceSessionId: string): Promise<number> {
  return countRows(
    voiceTranscriptSegments,
    eq(voiceTranscriptSegments.voiceSessionId, voiceSessionId),
  );
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

  await database.db.delete(user).where(eq(user.id, userId));

  assert.equal(
    await countRows(voiceSessions, eq(voiceSessions.userId, userId)),
    0,
    `${getTableName(voiceSessions)} still holds rows for the deleted user`,
  );
  for (const id of gone) assert.equal(await segmentCount(id), 0);
  assert.equal(await countRows(voiceSessions, eq(voiceSessions.userId, other)), 2);
  for (const id of kept) assert.equal(await segmentCount(id), 2);
});

test("deleting a session takes its segments and leaves its neighbour's", async () => {
  const userId = await database.createUser();
  const [gone, kept] = await populateAccount(userId);
  assert.ok(gone !== undefined && kept !== undefined);

  await database.db.delete(voiceSessions).where(eq(voiceSessions.id, gone));

  assert.equal(await segmentCount(gone), 0);
  assert.equal(await segmentCount(kept), 2);
});

test("one live session is one row, for its owner and for anyone else", async () => {
  const userId = await database.createUser();
  const other = await database.createUser();
  await insertSession(userId, { liveSessionId: "sess_shared" });

  await assertUniqueViolation(insertSession(userId, { liveSessionId: "sess_shared" }));
  await assertUniqueViolation(insertSession(other, { liveSessionId: "sess_shared" }));
  await insertSession(userId, { liveSessionId: "sess_other" });

  const owners = await database.db
    .select({ userId: voiceSessions.userId })
    .from(voiceSessions)
    .where(eq(voiceSessions.liveSessionId, "sess_shared"));
  assert.deepEqual(owners, [{ userId }]);
});

test("a segment's position is taken once within its session and free in another", async () => {
  const userId = await database.createUser();
  const [first, second] = await populateAccount(userId);
  assert.ok(first !== undefined && second !== undefined);

  await assertUniqueViolation(insertSegment(first, { seq: 2 }));
  await insertSegment(first, { seq: 3 });
  await insertSegment(second, { seq: 3 });

  assert.equal(await segmentCount(first), 3);
  assert.equal(await segmentCount(second), 3);
});

test("a device's departure leaves the session's record standing with the device named", async () => {
  const userId = await database.createUser();
  await database.db
    .insert(devices)
    .values({ id: "device-1", userId, installationId: `install-${userId}`, platform: "macos" });
  const id = await insertSession(userId, { deviceId: "device-1" });

  await database.db.delete(devices).where(eq(devices.id, "device-1"));

  const [row] = await database.db.select().from(voiceSessions).where(eq(voiceSessions.id, id));
  assert.ok(row);
  assert.equal(row.deviceId, "device-1");
});

test("a new session is open with no close, no reason, and no usage; a closed one keeps all three", async () => {
  const userId = await database.createUser();
  const opened = await insertSession(userId);
  const [open] = await database.db.select().from(voiceSessions).where(eq(voiceSessions.id, opened));
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

  const rows = await database.db
    .select({
      id: voiceSessions.id,
      closedAt: voiceSessions.closedAt,
      closeReason: voiceSessions.closeReason,
      usage: voiceSessions.usage,
    })
    .from(voiceSessions)
    .where(eq(voiceSessions.userId, userId));
  const byId = new Map(rows.map((row) => [row.id, row]));
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
