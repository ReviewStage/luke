import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import {
  VOICE_WRITE_REFUSAL,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
  voiceWriter,
} from "@luke/database/models/voice-writer";
import { STORE_WRITE_EFFECT, storeWriter } from "@luke/database/models/writer";
import {
  insertConversation,
  openHostedStoreTestDatabase,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
} from "@luke/database/testing";
import { VOICE_SEGMENT_ROLE } from "@luke/database/voice-vocabulary";
import { LIVE_DEFAULTS } from "@luke/live";
import { Result, Schema } from "effect";
import { afterAll, test } from "vitest";
import { heard, said } from "../testing/live-events.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";

/**
 * The voice writer over the real migrations on PGlite, fed a synthetic Live
 * stream: no real spoken word, title, or session. What these tests hold to is
 * the record the plan describes — which segments a stream leaves, with which
 * timings and roles, on which row; which rows a delegation attaches as the
 * developer's ask; which utterances become rows of the conversation — and never
 * the words themselves beyond the fixtures' own.
 */

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const database = await openHostedStoreTestDatabase({ at: NOW });
afterAll(() => database.close());

const store = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const record = voiceSessionRecord(() => NOW);

let liveSessions = 0;
const WRITTEN: VoiceWriteResult = Result.succeed(STORE_WRITE_EFFECT.WRITTEN);

function writer(): VoiceWriter {
  return voiceWriter({ store });
}

/** A user with a conversation and a registered live session, the shape every stream lands on. */
async function target(): Promise<VoiceTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  liveSessions += 1;
  const liveSessionId = `sess_fixture_${liveSessions}`;
  await database.run(
    record.register({
      userId,
      sessionId: liveSessionId,
      taskId: randomUUID(),
      attachId: randomUUID(),
      model: LIVE_DEFAULTS.MODEL,
    }),
  );
  return { userId, liveSessionId, conversation: { userId, conversationId } };
}
const SessionIdRowSchema = Schema.Struct({ id: Schema.String });

async function sessionRowId(liveSessionId: string): Promise<string> {
  const [row] = await readVoiceSessionByLiveSessionId(database.run, liveSessionId);
  assert.ok(row);
  return Schema.decodeUnknownSync(SessionIdRowSchema)(row).id;
}

async function segments(liveSessionId: string) {
  const rows = await readVoiceTranscriptSegmentsBySession(
    database.run,
    await sessionRowId(liveSessionId),
  );
  return rows.map((row) => ({
    seq: row.seq,
    role: row.role,
    text: row.text,
    startMs: row.startMs,
    endMs: row.endMs,
  }));
}

test("transcript deltas become segments with their timings and roles, in the order they arrived, overlap included", async () => {
  const live = await target();
  const voice = writer();
  const results: VoiceWriteResult[] = [
    await database.run(voice.consume(live, heard("what is", 1200, 1800))),
    await database.run(voice.consume(live, heard(" the fixture waiting on", 1700, 3400))),
    await database.run(voice.consume(live, said("It is waiting", 3500, 4300))),
    await database.run(voice.consume(live, said(" on a permission prompt.", 4200, 5600))),
  ];
  assert.deepEqual(results, [WRITTEN, WRITTEN, WRITTEN, WRITTEN]);
  assert.deepEqual(await segments(live.liveSessionId), [
    { seq: 1, role: VOICE_SEGMENT_ROLE.USER, text: "what is", startMs: 1200, endMs: 1800 },
    {
      seq: 2,
      role: VOICE_SEGMENT_ROLE.USER,
      text: " the fixture waiting on",
      startMs: 1700,
      endMs: 3400,
    },
    {
      seq: 3,
      role: VOICE_SEGMENT_ROLE.ASSISTANT,
      text: "It is waiting",
      startMs: 3500,
      endMs: 4300,
    },
    {
      seq: 4,
      role: VOICE_SEGMENT_ROLE.ASSISTANT,
      text: " on a permission prompt.",
      startMs: 4200,
      endMs: 5600,
    },
  ]);
});

test("a session no row stands for is refused, and another account's row is not this account's", async () => {
  const live = await target();
  const voice = writer();
  assert.deepEqual(
    await database.run(voice.consume({ ...live, liveSessionId: "sess_unknown" }, heard("x", 0, 1))),
    Result.fail(VOICE_WRITE_REFUSAL.NO_SESSION),
  );
  const other = await database.createUser();
  assert.deepEqual(
    await database.run(voice.consume({ ...live, userId: other }, heard("x", 0, 1))),
    Result.fail(VOICE_WRITE_REFUSAL.NO_SESSION),
  );
  assert.deepEqual(await segments(live.liveSessionId), []);
});
