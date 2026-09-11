import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEVICE_PLATFORM } from "@sidecar/hosted";
import { eq } from "drizzle-orm";
import { test } from "vitest";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  voiceSessions,
} from "../server/db/voice-schema";
import { registerDevice } from "../server/hosted/device-store";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

test("a registered session names its account, keeps its first owner, and answers the owner's re-attach alone", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const owner = await opened.createUser();
    const other = await opened.createUser();
    const record = voiceSessionRecord(opened.run, () => NOW);
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

test("usage snapshots overwrite one another unconfirmed, the close confirms the seconds with when and why, and a late snapshot leaves the close standing", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const owner = await opened.createUser();
    const record = voiceSessionRecord(opened.run, () => NOW);
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
    await record.noteUsage({ sessionId: "live_u", seconds: 30 });
    assert.deepEqual(
      (await read()).map((row) => row.usage),
      [{ seconds: 26.5, confirmed: true }],
    );
    await record.noteUsage({ sessionId: "live_unknown", seconds: 1 });
    assert.equal(
      (
        await opened.db
          .select()
          .from(voiceSessions)
          .where(eq(voiceSessions.liveSessionId, "live_unknown"))
      ).length,
      0,
    );
  } finally {
    await opened.close();
  }
});

test("a session names the device the handshake claimed only where the account holds that row, and another account's row leaves it unnamed", async () => {
  const opened = await openHostedStoreTestDatabase();
  try {
    const owner = await opened.createUser();
    const other = await opened.createUser();
    const record = voiceSessionRecord(opened.run, () => NOW);
    const { deviceId } = await opened.run(
      registerDevice({
        id: randomUUID(),
        userId: owner,
        installationId: randomUUID(),
        platform: DEVICE_PLATFORM.MACOS,
        now: new Date(NOW),
        push: undefined,
      }),
    );

    assert.equal(await record.deviceOwned({ userId: owner, deviceId }), true);
    assert.equal(await record.deviceOwned({ userId: other, deviceId }), false);
    assert.equal(await record.deviceOwned({ userId: owner, deviceId: randomUUID() }), false);

    await record.register({ userId: owner, sessionId: "live_d_owned", deviceId });
    await record.register({ userId: other, sessionId: "live_d_foreign", deviceId });
    await record.register({ userId: owner, sessionId: "live_d_none" });
    const named = async (sessionId: string) =>
      (
        await opened.db
          .select({ deviceId: voiceSessions.deviceId })
          .from(voiceSessions)
          .where(eq(voiceSessions.liveSessionId, sessionId))
      )[0]?.deviceId;

    assert.equal(await named("live_d_owned"), deviceId);
    assert.equal(await named("live_d_foreign"), null);
    assert.equal(await named("live_d_none"), null);
  } finally {
    await opened.close();
  }
});
