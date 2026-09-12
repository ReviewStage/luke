import assert from "node:assert/strict";
import { type ToolSet, tool } from "ai";
import { Schema } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
  CONVERSATION_EVENT_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type UserMessageMetadata,
} from "../server/core";
import { VOICE_SEGMENT_ROLE } from "../server/db/voice-vocabulary";
import {
  type CommentaryAppend,
  type ConversationTarget,
  claimSpeech,
  offerSpeech,
  SPEECH_OFFER,
  STORE_WRITE_EFFECT,
  storeWriter,
  VOICE_WRITE_REFUSAL,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
  voiceWriter,
} from "../server/hosted/store";
import { LIVE_SERVER_EVENT, type LiveServerEvent } from "../server/live";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { appended, delegated, heard, liveEventId, said } from "./support/live-events";
import {
  insertConversation,
  insertMessage,
  readEventsByConversation,
  readMessagesByConversationTyped,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
  setVoiceSessionDeviceId,
} from "./support/store-rows";

/**
 * The voice writer over the real migrations on PGlite, fed a synthetic Live
 * stream: no real spoken word, title, or session. What these tests hold to is
 * the record the plan describes — which segments a stream leaves, with which
 * timings and roles, on which row; when the briefing's message is marked
 * spoken; which words a delegation cuts into the developer's ask — and never
 * the words themselves beyond the fixtures' own.
 */

const NOW = Date.parse("2026-09-10T12:00:00.000Z");

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const TOOLS: ToolSet = {
  announce: tool({
    description: "Says a briefing aloud.",
    inputSchema: z.object({ briefing: z.string() }),
    outputSchema: z.object({}),
  }),
};

const store = await storeWriter({ run: database.run, tools: TOOLS, now: () => new Date(NOW) });
const record = voiceSessionRecord(database.run, () => NOW);
const speech = { run: database.run, writer: store };
/** The installation the fixture sessions belong to, which is the device a briefing must be claimed by before its speech is marked. */
const DEVICE_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";

let liveSessions = 0;
const WRITTEN: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };

function writer(): VoiceWriter {
  return voiceWriter({ run: database.run, store });
}

/** A user with a main conversation and a registered live session, the shape every stream lands on. */
async function target(): Promise<VoiceTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  liveSessions += 1;
  const liveSessionId = `sess_fixture_${liveSessions}`;
  await record.register({ userId, sessionId: liveSessionId });
  await setVoiceSessionDeviceId(database.run, liveSessionId, DEVICE_ID);
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
    startMs: row.start_ms,
    endMs: row.end_ms,
  }));
}

/** The briefing message a `speech.spoken` hangs on: an announce written by the store writer's own path, on offer and claimed by the fixture device. */
async function briefing(conversation: ConversationTarget): Promise<string> {
  const messageId = await announced(conversation);
  await claim(conversation, messageId);
  return messageId;
}

async function claim(conversation: ConversationTarget, messageId: string): Promise<void> {
  assert.equal((await offerSpeech(speech, conversation.userId, messageId, NOW)).ok, true);
  assert.equal(
    (await claimSpeech(speech, conversation.userId, messageId, DEVICE_ID, NOW)).ok,
    true,
  );
}

/** An assistant message of the brain's, as the relay leaves one, offered to nobody yet. */
async function announced(conversation: ConversationTarget): Promise<string> {
  const enqueued = await store.enqueueTurn(conversation, { origin: "roster_diff" });
  assert.ok(enqueued.ok);
  const written = await store.recordCompaction(conversation, {
    clientId: `briefing-${enqueued.turnId}`,
    turnId: enqueued.turnId,
    text: "Earlier briefings folded.",
    firstKeptMessageId: "00000000-0000-4000-8000-000000000000",
  });
  assert.ok(written.ok);
  const rows = await readMessagesByConversationTyped(database.run, conversation.conversationId);
  const row = rows[rows.length - 1];
  assert.ok(row);
  return row.id;
}

async function speechEvents(conversation: ConversationTarget) {
  const rows = await readEventsByConversation(database.run, conversation.conversationId);
  return rows.map((row) => ({ kind: row.kind, messageId: row.message_id, payload: row.payload }));
}

test("transcript deltas become segments with their timings and roles, in the order they arrived, overlap included", async () => {
  const live = await target();
  const voice = writer();
  const results: VoiceWriteResult[] = [
    await voice.consume(live, heard("what is", 1200, 1800)),
    await voice.consume(live, heard(" the fixture waiting on", 1700, 3400)),
    await voice.consume(live, said("It is waiting", 3500, 4300)),
    await voice.consume(live, said(" on a permission prompt.", 4200, 5600)),
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
  assert.deepEqual(await speechEvents(live.conversation), []);
});

test("segments after a gap land on the same open row, from a fresh writer, with closed_at still null", async () => {
  const live = await target();
  const first = writer();
  await first.consume(live, heard("before the gap", 1000, 2000));
  await record.noteUsage({ sessionId: live.liveSessionId, seconds: 12 });

  const attached = writer();
  await record.register({ userId: live.userId, sessionId: live.liveSessionId });
  assert.deepEqual(await attached.consume(live, heard("after the gap", 900_000, 901_000)), WRITTEN);

  const rows = (await readVoiceSessionByLiveSessionId(database.run, live.liveSessionId)).map(
    (row) => ({ closedAt: row.closed_at, usage: row.usage }),
  );
  assert.deepEqual(rows, [{ closedAt: null, usage: { seconds: 12, confirmed: false } }]);
  assert.deepEqual(
    (await segments(live.liveSessionId)).map((segment) => [segment.seq, segment.startMs]),
    [
      [1, 1000],
      [2, 900_000],
    ],
  );
});

test("a session no row stands for is refused, and another account's row is not this account's", async () => {
  const live = await target();
  const voice = writer();
  assert.deepEqual(
    await voice.consume({ ...live, liveSessionId: "sess_unknown" }, heard("x", 0, 1)),
    {
      ok: false,
      refusal: VOICE_WRITE_REFUSAL.NO_SESSION,
    },
  );
  const other = await database.createUser();
  assert.deepEqual(await voice.consume({ ...live, userId: other }, heard("x", 0, 1)), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NO_SESSION,
  });
  assert.deepEqual(await segments(live.liveSessionId), []);
});

test("events the writer does not keep are ignored, and nothing is written for them", async () => {
  const live = await target();
  const voice = writer();
  const ignored: LiveServerEvent[] = [
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: liveEventId() },
    { type: LIVE_SERVER_EVENT.USAGE_UPDATED, event_id: liveEventId(), usage: { seconds: 3 } },
    { type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND },
    { type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA },
    {
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: liveEventId(),
      session: { id: live.liveSessionId },
    },
  ];
  for (const event of ignored) {
    assert.deepEqual(await voice.consume(live, event), {
      ok: true,
      effect: STORE_WRITE_EFFECT.IGNORED,
    });
  }
  assert.deepEqual(await segments(live.liveSessionId), []);
  assert.deepEqual(await speechEvents(live.conversation), []);
});

test("speech.spoken is written once, on the first output delta at or after the append's end", async () => {
  const live = await target();
  const messageId = await briefing(live.conversation);
  const voice = writer();
  const append: CommentaryAppend = { clientEventId: "append-1", messageId };
  voice.noteAppend(live, append);

  // Before the ack places the append, a delta says nothing about it.
  await voice.consume(live, said("Earlier words.", 100, 900));
  assert.deepEqual(await voice.consume(live, appended("append-1", 1000, 4000)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  // A delta that begins before the appended commentary ends is not its speech.
  await voice.consume(live, said("The fixture", 3800, 4100));
  assert.equal(
    (await speechEvents(live.conversation)).some(
      (event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
    ),
    false,
  );
  // The first delta beginning at or after the end is.
  await voice.consume(live, said(" session is waiting", 4000, 5200));
  await voice.consume(live, said(" on a permission prompt.", 5200, 6400));

  const spoken = await speechEvents(live.conversation);
  const voiceSessionId = await sessionRowId(live.liveSessionId);
  assert.deepEqual(spoken, [
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      messageId,
      payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
    },
    { kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, messageId, payload: null },
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
      messageId,
      payload: { voiceSessionId, atMs: 4000 },
    },
  ]);
  // Every delta was still a segment, whatever it said about the append.
  assert.equal((await segments(live.liveSessionId)).length, 4);
  // An ack for an append this writer was never told of is ignored rather than marked.
  assert.deepEqual(await voice.consume(live, appended("append-unknown", 7000, 8000)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.IGNORED,
  });
});

test("one delta past the ends of two acknowledged appends marks both briefings", async () => {
  const live = await target();
  const first = await briefing(live.conversation);
  const secondBriefingId = await insertMessage(database.run, {
    userId: live.userId,
    conversationId: live.conversation.conversationId,
    seq: 99,
    clientId: "second-briefing",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: "A second briefing.", state: "done" }],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
  });
  await claim(live.conversation, secondBriefingId);
  const voice = writer();
  voice.noteAppend(live, { clientEventId: "append-a", messageId: first });
  voice.noteAppend(live, { clientEventId: "append-b", messageId: secondBriefingId });
  await voice.consume(live, appended("append-a", 0, 1000));
  await voice.consume(live, appended("append-b", 1000, 2000));
  assert.deepEqual(await voice.consume(live, said("Both said.", 2000, 3000)), WRITTEN);
  const spokenOf = async () =>
    (await speechEvents(live.conversation))
      .filter((event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN)
      .map((event) => event.messageId);
  assert.deepEqual(await spokenOf(), [first, secondBriefingId]);
  // Neither is marked a second time.
  await voice.consume(live, said("And more.", 3000, 4000));
  assert.deepEqual(await spokenOf(), [first, secondBriefingId]);
});

test("a briefing this session's device did not claim is not marked spoken by its voice: unclaimed, another device's, or a session with no device", async () => {
  const live = await target();
  const unclaimed = await announced(live.conversation);
  assert.equal((await offerSpeech(speech, live.userId, unclaimed, NOW)).ok, true);
  const voice = writer();
  voice.noteAppend(live, { clientEventId: "append-u", messageId: unclaimed });
  await voice.consume(live, appended("append-u", 0, 1000));
  assert.deepEqual(await voice.consume(live, said("Said anyway.", 1000, 2000)), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
  });

  const other = await target();
  const theirs = await briefing(other.conversation);
  await setVoiceSessionDeviceId(
    database.run,
    other.liveSessionId,
    "7d2f3f25-ab1c-4d3e-9f4a-1b2c3d4e5f61",
  );
  const otherVoice = writer();
  otherVoice.noteAppend(other, { clientEventId: "append-o", messageId: theirs });
  await otherVoice.consume(other, appended("append-o", 0, 1000));
  assert.deepEqual(await otherVoice.consume(other, said("Not mine.", 1000, 2000)), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
  });

  const deviceless = await target();
  const claimed = await briefing(deviceless.conversation);
  await setVoiceSessionDeviceId(database.run, deviceless.liveSessionId, null);
  const noDevice = writer();
  noDevice.noteAppend(deviceless, { clientEventId: "append-n", messageId: claimed });
  await noDevice.consume(deviceless, appended("append-n", 0, 1000));
  assert.deepEqual(await noDevice.consume(deviceless, said("Nobody's.", 1000, 2000)), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
  });

  for (const conversation of [live.conversation, other.conversation, deviceless.conversation]) {
    assert.equal(
      (await speechEvents(conversation)).some(
        (event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
      ),
      false,
    );
  }
  // Every delta was still a segment.
  assert.equal((await segments(live.liveSessionId)).length, 1);
});

test("an append whose message is gone is refused at the speech, not the segment", async () => {
  const live = await target();
  const voice = writer();
  voice.noteAppend(live, {
    clientEventId: "append-2",
    messageId: "00000000-0000-4000-8000-000000000404",
  });
  await voice.consume(live, appended("append-2", 0, 500));
  assert.deepEqual(await voice.consume(live, said("Words.", 600, 900)), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NO_MESSAGE,
  });
  assert.equal((await segments(live.liveSessionId)).length, 1);
});

async function spokenAsks(conversation: ConversationTarget) {
  const rows = await readMessagesByConversationTyped(database.run, conversation.conversationId);
  return rows.map((row) => ({
    clientId: row.clientId,
    role: row.role,
    parts: row.parts,
    metadata: row.metadata,
    finishedAt: row.finishedAt,
  }));
}

test("a delegation cuts the developer's words before it into a spoken ask naming its span, and the next cuts from there", async () => {
  const live = await target();
  const voice = writer();
  const voiceSessionId = await sessionRowId(live.liveSessionId);
  await voice.consume(live, heard("What is the fixture", 1200, 2600));
  await voice.consume(live, heard(" waiting on?", 2500, 4800));
  await voice.consume(live, said("It is waiting on a permission prompt.", 5000, 7000));
  assert.deepEqual(await voice.consume(live, delegated("dl_1", 4900)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  await voice.consume(live, heard("Tell it to go ahead.", 8000, 9400));
  assert.deepEqual(await voice.consume(live, delegated("dl_2", 9500)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });

  const first: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1200,
    to_ms: 4900,
  };
  const second: UserMessageMetadata = {
    ...first,
    delegation_id: "dl_2",
    from_ms: 8000,
    to_ms: 9500,
  };
  assert.deepEqual(await spokenAsks(live.conversation), [
    {
      clientId: "dl_1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "What is the fixture waiting on?", state: "done" }],
      metadata: first,
      finishedAt: new Date(NOW),
    },
    {
      clientId: "dl_2",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Tell it to go ahead.", state: "done" }],
      metadata: second,
      finishedAt: new Date(NOW),
    },
  ]);
  // Nothing Luke said became a message; his words are segments alone.
  assert.equal((await segments(live.liveSessionId)).length, 4);
});

test("a delegation is one ask however many times it is told, and one with no words before it writes nothing", async () => {
  const live = await target();
  const voice = writer();
  assert.deepEqual(await voice.consume(live, delegated("dl_empty", 500)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.IGNORED,
  });
  await voice.consume(live, heard("Stop the fixture.", 600, 1800));
  assert.deepEqual(await voice.consume(live, delegated("dl_3", 2000)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  assert.deepEqual(await voice.consume(live, delegated("dl_3", 2000)), {
    ok: true,
    effect: STORE_WRITE_EFFECT.REPEATED,
  });
  assert.equal((await spokenAsks(live.conversation)).length, 1);
});
