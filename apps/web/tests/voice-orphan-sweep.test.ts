import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterAll } from "vitest";
import { db } from "../server/db/query";
import { voiceSessionUsage } from "../server/db/usage-schema";
import { VOICE_CLOSE_REASON } from "../server/db/voice-vocabulary";
import { recordVoiceSeconds } from "../server/hosted/quota";
import { LIVE_CLIENT_EVENT, LIVE_CLOSE_REASON, LIVE_SERVER_EVENT } from "../server/live";
import { createLiveUpstream } from "../server/voice/openai";
import {
  NOTHING_ORPHANED,
  sweepVoiceOrphans,
  VOICE_DETACH_GRACE_MS,
  VOICE_SESSION_LIMIT_MS,
  type VoiceOrphanSweepOutcome,
} from "../server/voice/orphan-sweep";
import { type VoiceSessionRecord, voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { readVoiceSessionsByUserTyped } from "./support/store-rows";
import { type FakeOpenAi, readSocket, sendText, startFakeOpenAi } from "./support/voice-fakes";

/**
 * The bound on a detached voice session, over the real record on PGlite and
 * a fake OpenAI: the scheduled sweep ends only an open session detached longer
 * ago than the grace and never re-attached, through a fresh sideband and the
 * docs' graceful close, recording its seconds once; closes a session
 * OpenAI answers the attach for as gone as a lost connection, so it is not
 * swept again; and leaves one that answered nothing conclusive stamped for
 * the next sweep, unless it is past OpenAI's duration limit.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
const API_KEY = "sk-test-project-key";

/** The record on a clock the test moves, so a detach is stamped at the instant the test names. */
function clockedRecord() {
  const clock = { now: NOW };
  return { clock, record: voiceSessionRecord(() => clock.now) };
}

/** The sweep's seams over the fake OpenAI and the record, seconds landing through the real ledger. */
function sweepSeams(openAi: FakeOpenAi, record: VoiceSessionRecord) {
  return {
    upstream: createLiveUpstream({ apiKey: API_KEY, baseUrl: openAi.baseUrl }),
    record,
    recordSeconds: (input: { userId: string; sessionId: string; seconds: number }) =>
      recordVoiceSeconds({ ...input, now: NOW }),
  };
}

/** One open session, registered at `startedAt` and stamped detached past the grace by the connection that held it. */
async function orphanOf(
  clocked: ReturnType<typeof clockedRecord>,
  userId: string,
  startedAt: number = NOW - VOICE_DETACH_GRACE_MS - 60_000,
) {
  const sessionId = `live_${randomUUID()}`;
  const attachId = randomUUID();
  clocked.clock.now = startedAt;
  await database.run(
    clocked.record.register({ userId, sessionId, planId: randomUUID(), attachId }),
  );
  await database.run(clocked.record.noteUsage({ sessionId, seconds: 120 }));
  clocked.clock.now = NOW - VOICE_DETACH_GRACE_MS - 1_000;
  await database.run(clocked.record.detach({ sessionId, attachId }));
  clocked.clock.now = NOW;
  return sessionId;
}

/** OpenAI's `session.closed` for a sweep's close, naming the seconds. */
function sessionClosed(seconds: number): string {
  return JSON.stringify({
    type: LIVE_SERVER_EVENT.SESSION_CLOSED,
    event_id: "closed",
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
    usage: { seconds },
  });
}

/** The account's rows by live session id: whether each is closed, why, its usage, and whether it is stamped detached. */
async function rowsOf(userId: string) {
  const rows = await readVoiceSessionsByUserTyped(database.run, userId);
  return new Map(
    rows.map((row) => [
      row.liveSessionId,
      {
        closed: row.closedAt !== null,
        reason: row.closeReason,
        usage: row.usage,
        detached: row.detachedAt !== null,
      },
    ]),
  );
}

function usageRows(sessionId: string) {
  return database.run(
    db
      .select({ seconds: voiceSessionUsage.seconds })
      .from(voiceSessionUsage)
      .where(eq(voiceSessionUsage.sessionId, sessionId)),
  );
}

it.effect(
  "the sweep ends only a session detached past the grace and never re-attached, through session.close, and records its seconds once",
  () =>
    Effect.promise(async () => {
      const openAi = await startFakeOpenAi();
      const { clock, record } = clockedRecord();
      const userId = await database.createUser();
      const orphan = `live_${randomUUID()}`;
      const recent = `live_${randomUUID()}`;
      const returned = `live_${randomUUID()}`;
      const held = `live_${randomUUID()}`;
      const attachId = randomUUID();
      for (const sessionId of [orphan, recent, returned, held]) {
        await database.run(record.register({ userId, sessionId, planId: randomUUID(), attachId }));
      }
      clock.now = NOW - VOICE_DETACH_GRACE_MS - 60_000;
      await database.run(record.detach({ sessionId: orphan, attachId }));
      await database.run(record.detach({ sessionId: returned, attachId }));
      await database.run(record.attached({ sessionId: returned, attachId: randomUUID() }));
      clock.now = NOW - 10_000;
      await database.run(record.detach({ sessionId: recent, attachId }));
      clock.now = NOW;
      await database.run(record.noteUsage({ sessionId: orphan, seconds: 30 }));
      // A detach stamps the open row; a re-attach clears the stamp.
      const before = await rowsOf(userId);
      assert.deepEqual(
        [orphan, recent, returned, held].map((sessionId) => before.get(sessionId)?.detached),
        [true, true, false, false],
      );

      const seams = sweepSeams(openAi, record);
      const sweeping = database.run(sweepVoiceOrphans(seams, { now: NOW }));
      const attach = await openAi.nextAttach();
      assert.equal(attach.sessionId, orphan);
      const upstream = readSocket(attach.socket);
      const close = JSON.parse(await upstream.next());
      assert.equal(close.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(attach.socket, sessionClosed(42));
      const outcome: VoiceOrphanSweepOutcome = await sweeping;
      assert.deepEqual(outcome, { closed: 1, lost: 0, pending: 0, failed: 0 });
      assert.equal(openAi.attaches.length, 1);

      const rows = await rowsOf(userId);
      assert.deepEqual(rows.get(orphan), {
        closed: true,
        reason: VOICE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: 42, confirmed: true },
        detached: true,
      });
      for (const standing of [recent, returned, held]) {
        assert.equal(rows.get(standing)?.closed, false);
      }
      assert.deepEqual(await usageRows(orphan), [{ seconds: 42 }]);

      // A sweep later, with the recent one still inside its grace, the closed session is swept no more.
      assert.deepEqual(
        await database.run(sweepVoiceOrphans(seams, { now: NOW + 1_000 })),
        NOTHING_ORPHANED,
      );
      assert.equal(openAi.attaches.length, 1);
      assert.deepEqual(await usageRows(orphan), [{ seconds: 42 }]);
      await openAi.close();
    }),
);

it.effect(
  "a detached session OpenAI will not attach to is closed as a lost connection with its snapshot standing, and is not swept again",
  () =>
    Effect.promise(async () => {
      const openAi = await startFakeOpenAi();
      openAi.attachStatus = 404;
      const clocked = clockedRecord();
      const userId = await database.createUser();
      const gone = await orphanOf(clocked, userId);

      const seams = sweepSeams(openAi, clocked.record);
      assert.deepEqual(await database.run(sweepVoiceOrphans(seams, { now: NOW })), {
        ...NOTHING_ORPHANED,
        lost: 1,
      });
      assert.deepEqual((await rowsOf(userId)).get(gone), {
        closed: true,
        reason: VOICE_CLOSE_REASON.CONNECTION_LOST,
        usage: { seconds: 120, confirmed: false },
        detached: true,
      });
      assert.deepEqual(await usageRows(gone), []);
      assert.deepEqual(
        await database.run(sweepVoiceOrphans(seams, { now: NOW + 1_000 })),
        NOTHING_ORPHANED,
      );
      await openAi.close();
    }),
);

it.effect(
  "a session that answered nothing conclusive, an attach throttled or failed or a close never confirmed, is left stamped, and a later sweep ends it with its seconds",
  () =>
    Effect.promise(async () => {
      const openAi = await startFakeOpenAi();
      const clocked = clockedRecord();
      const userId = await database.createUser();
      // The whole timeline runs before `NOW`, where no row another test left stamped is due yet.
      let at = NOW - 10 * VOICE_DETACH_GRACE_MS;
      const running = `live_${randomUUID()}`;
      const attachId = randomUUID();
      clocked.clock.now = at - 2 * VOICE_DETACH_GRACE_MS;
      await database.run(
        clocked.record.register({ userId, sessionId: running, planId: randomUUID(), attachId }),
      );
      await database.run(clocked.record.noteUsage({ sessionId: running, seconds: 120 }));
      clocked.clock.now = at - VOICE_DETACH_GRACE_MS - 1_000;
      await database.run(clocked.record.detach({ sessionId: running, attachId }));
      const seams = sweepSeams(openAi, clocked.record);
      const pending = { ...NOTHING_ORPHANED, pending: 1 };
      const standing = {
        closed: false,
        reason: null,
        usage: { seconds: 120, confirmed: false },
        detached: true,
      };

      // Each sweep that ends nothing stamps the row again, so the next try is a grace later.
      const sweepAt = (instant: number) => {
        clocked.clock.now = instant;
        return database.run(sweepVoiceOrphans(seams, { now: instant }));
      };
      for (const status of [429, 503]) {
        openAi.attachStatus = status;
        assert.deepEqual(await sweepAt(at), pending);
        assert.deepEqual((await rowsOf(userId)).get(running), standing);
        // Within the grace the row waits behind any orphan stamped since, and is not tried.
        assert.deepEqual(await sweepAt(at + 1_000), NOTHING_ORPHANED);
        at += VOICE_DETACH_GRACE_MS + 1_000;
      }

      // Attached, but the sideband drops before `session.closed`: the session may still run.
      openAi.attachStatus = undefined;
      const dropping = sweepAt(at);
      const dropped = await openAi.nextAttach();
      assert.equal(
        JSON.parse(await readSocket(dropped.socket).next()).type,
        LIVE_CLIENT_EVENT.CLOSE,
      );
      dropped.socket.terminate();
      assert.deepEqual(await dropping, pending);
      assert.deepEqual((await rowsOf(userId)).get(running), standing);

      at += VOICE_DETACH_GRACE_MS + 1_000;
      const closing = sweepAt(at);
      const attach = await openAi.nextAttach();
      assert.equal(
        JSON.parse(await readSocket(attach.socket).next()).type,
        LIVE_CLIENT_EVENT.CLOSE,
      );
      await sendText(attach.socket, sessionClosed(150));
      assert.deepEqual(await closing, { ...NOTHING_ORPHANED, closed: 1 });
      assert.deepEqual((await rowsOf(userId)).get(running), {
        closed: true,
        reason: VOICE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: 150, confirmed: true },
        detached: true,
      });
      assert.deepEqual(await usageRows(running), [{ seconds: 150 }]);
      await openAi.close();
    }),
);

it.effect(
  "a session past OpenAI's duration limit that answers nothing conclusive is closed as expired with its snapshot standing",
  () =>
    Effect.promise(async () => {
      const openAi = await startFakeOpenAi();
      openAi.attachStatus = 503;
      const clocked = clockedRecord();
      const userId = await database.createUser();
      const expired = await orphanOf(clocked, userId, NOW - VOICE_SESSION_LIMIT_MS - 1_000);

      const seams = sweepSeams(openAi, clocked.record);
      assert.deepEqual(await database.run(sweepVoiceOrphans(seams, { now: NOW })), {
        ...NOTHING_ORPHANED,
        lost: 1,
      });
      assert.deepEqual((await rowsOf(userId)).get(expired), {
        closed: true,
        reason: VOICE_CLOSE_REASON.EXPIRED,
        usage: { seconds: 120, confirmed: false },
        detached: true,
      });
      assert.deepEqual(await usageRows(expired), []);
      await openAi.close();
    }),
);
