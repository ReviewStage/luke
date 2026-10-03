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
  sweepVoiceOrphans,
  VOICE_DETACH_GRACE_MS,
  type VoiceOrphanSweepOutcome,
} from "../server/voice/orphan-sweep";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { readVoiceSessionsByUserTyped } from "./support/store-rows";
import { readSocket, sendText, startFakeOpenAi } from "./support/voice-fakes";

/**
 * The bound on a detached voice session, over the real record on PGlite and
 * a fake OpenAI: the tick's sweep ends only an open session detached longer
 * ago than the grace and never re-attached, through a fresh sideband and the
 * docs' graceful close, recording its seconds once; and closes a session
 * OpenAI will no longer attach to as a lost connection, so it is not swept
 * again.
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
      for (const sessionId of [orphan, recent, returned, held]) {
        await database.run(record.register({ userId, sessionId }));
      }
      clock.now = NOW - VOICE_DETACH_GRACE_MS - 60_000;
      await database.run(record.detach({ sessionId: orphan }));
      await database.run(record.detach({ sessionId: returned }));
      await database.run(record.attached({ sessionId: returned }));
      clock.now = NOW - 10_000;
      await database.run(record.detach({ sessionId: recent }));
      clock.now = NOW;
      await database.run(record.noteUsage({ sessionId: orphan, seconds: 30 }));
      // A detach stamps the open row; a re-attach clears the stamp.
      const before = await rowsOf(userId);
      assert.deepEqual(
        [orphan, recent, returned, held].map((sessionId) => before.get(sessionId)?.detached),
        [true, true, false, false],
      );

      const seams = {
        upstream: createLiveUpstream({ apiKey: API_KEY, baseUrl: openAi.baseUrl }),
        record,
        recordSeconds: (input: { userId: string; sessionId: string; seconds: number }) =>
          recordVoiceSeconds({ ...input, now: NOW }),
      };
      const sweeping = database.run(sweepVoiceOrphans(seams, { now: NOW }));
      const attach = await openAi.nextAttach();
      assert.equal(attach.sessionId, orphan);
      const upstream = readSocket(attach.socket);
      const close = JSON.parse(await upstream.next());
      assert.equal(close.type, LIVE_CLIENT_EVENT.CLOSE);
      await sendText(
        attach.socket,
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_CLOSED,
          event_id: "closed",
          reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
          usage: { seconds: 42 },
        }),
      );
      const outcome: VoiceOrphanSweepOutcome = await sweeping;
      assert.deepEqual(outcome, { closed: 1, lost: 0, failed: 0 });
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

      // A tick later, with the recent one still inside its grace, the closed session is swept no more.
      assert.deepEqual(await database.run(sweepVoiceOrphans(seams, { now: NOW + 1_000 })), {
        closed: 0,
        lost: 0,
        failed: 0,
      });
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
      const { clock, record } = clockedRecord();
      const userId = await database.createUser();
      const gone = `live_${randomUUID()}`;
      await database.run(record.register({ userId, sessionId: gone }));
      await database.run(record.noteUsage({ sessionId: gone, seconds: 120 }));
      clock.now = NOW - VOICE_DETACH_GRACE_MS - 1_000;
      await database.run(record.detach({ sessionId: gone }));
      clock.now = NOW;

      const seams = {
        upstream: createLiveUpstream({ apiKey: API_KEY, baseUrl: openAi.baseUrl }),
        record,
        recordSeconds: (input: { userId: string; sessionId: string; seconds: number }) =>
          recordVoiceSeconds({ ...input, now: NOW }),
      };
      assert.deepEqual(await database.run(sweepVoiceOrphans(seams, { now: NOW })), {
        closed: 0,
        lost: 1,
        failed: 0,
      });
      assert.deepEqual((await rowsOf(userId)).get(gone), {
        closed: true,
        reason: VOICE_CLOSE_REASON.CONNECTION_LOST,
        usage: { seconds: 120, confirmed: false },
        detached: true,
      });
      assert.deepEqual(await usageRows(gone), []);
      assert.deepEqual(await database.run(sweepVoiceOrphans(seams, { now: NOW + 1_000 })), {
        closed: 0,
        lost: 0,
        failed: 0,
      });
      await openAi.close();
    }),
);
