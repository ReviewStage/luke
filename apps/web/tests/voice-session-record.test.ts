import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  voiceSessions,
} from "../server/db/voice-schema";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

test("a registered session names its account, keeps its first owner, and answers the owner's re-attach alone", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const owner = await opened.createUser();
    const other = await opened.createUser();
    const record = voiceSessionRecord(opened.db, () => NOW);
    await record.register({ userId: owner, sessionId: "live_r" });
    await record.register({ userId: other, sessionId: "live_r" });

    assert.equal(await record.owned({ userId: owner, sessionId: "live_r" }), true);
    assert.equal(await record.owned({ userId: other, sessionId: "live_r" }), false);
    assert.equal(await record.owned({ userId: owner, sessionId: "live_never" }), false);
    const rows = await opened.db
      .select({
        userId: voiceSessions.userId,
        delegationMode: voiceSessions.delegationMode,
        closedAt: voiceSessions.closedAt,
        usage: voiceSessions.usage,
      })
      .from(voiceSessions)
      .where(eq(voiceSessions.liveSessionId, "live_r"));
    assert.deepEqual(rows, [
      { userId: owner, delegationMode: VOICE_DELEGATION_MODE.CLIENT, closedAt: null, usage: null },
    ]);
  } finally {
    await opened.close();
  }
});

test("usage snapshots overwrite one another unconfirmed, and the close confirms the seconds with when and why", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const owner = await opened.createUser();
    const record = voiceSessionRecord(opened.db, () => NOW);
    await record.register({ userId: owner, sessionId: "live_u" });
    await record.noteUsage({ sessionId: "live_u", seconds: 10 });
    await record.noteUsage({ sessionId: "live_u", seconds: 25 });
    const read = () =>
      opened.db
        .select({
          closedAt: voiceSessions.closedAt,
          closeReason: voiceSessions.closeReason,
          usage: voiceSessions.usage,
        })
        .from(voiceSessions)
        .where(eq(voiceSessions.liveSessionId, "live_u"));

    assert.deepEqual(await read(), [
      { closedAt: null, closeReason: null, usage: { seconds: 25, confirmed: false } },
    ]);

    await record.close({
      sessionId: "live_u",
      seconds: 26.5,
      reason: VOICE_CLOSE_REASON.REMOTE_HANGUP,
    });
    assert.deepEqual(await read(), [
      {
        closedAt: new Date(NOW),
        closeReason: VOICE_CLOSE_REASON.REMOTE_HANGUP,
        usage: { seconds: 26.5, confirmed: true },
      },
    ]);
    await record.noteUsage({ sessionId: "live_unknown", seconds: 1 });
    assert.equal((await opened.db.select().from(voiceSessions)).length, 1);
  } finally {
    await opened.close();
  }
});
