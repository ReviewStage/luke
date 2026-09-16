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
  type ConversationTarget,
  claimSpeech,
  offerSpeech,
  STORE_WRITE_EFFECT,
  storeWriter,
  type VoiceTarget,
  type VoiceWriteResult,
  type VoiceWriter,
  voiceWriter,
} from "../server/hosted/store";
import { SPEECH_OFFER } from "../server/hosted/store/speech";
import {
  type CommentaryAppend,
  type SpokenRowWrite,
  VOICE_WRITE_REFUSAL,
} from "../server/hosted/store/voice-writer";
import { LIVE_SERVER_EVENT, type LiveServerEvent, TRANSCRIPT_SPEAKER } from "../server/live";
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
 * spoken; which rows a delegation attaches as the developer's ask — and never
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

const store = await database.run(storeWriter({ tools: TOOLS, now: () => new Date(NOW) }));
const record = voiceSessionRecord(() => NOW);
const speech = { writer: store };
/** The installation the fixture sessions belong to, which is the device a briefing must be claimed by before its speech is marked. */
const DEVICE_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";

let liveSessions = 0;
const WRITTEN: VoiceWriteResult = { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN };

function writer(): VoiceWriter {
  return voiceWriter({ store });
}

/** A user with a main conversation and a registered live session, the shape every stream lands on. */
async function target(): Promise<VoiceTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  liveSessions += 1;
  const liveSessionId = `sess_fixture_${liveSessions}`;
  await database.run(record.register({ userId, sessionId: liveSessionId }));
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
  assert.equal(
    (await database.run(offerSpeech(speech, conversation.userId, messageId, NOW))).ok,
    true,
  );
  assert.equal(
    (await database.run(claimSpeech(speech, conversation.userId, messageId, DEVICE_ID, NOW))).ok,
    true,
  );
}

/** An assistant message of the brain's, as the relay leaves one, offered to nobody yet. */
async function announced(conversation: ConversationTarget): Promise<string> {
  const enqueued = await database.run(store.enqueueTurn(conversation, { origin: "roster_diff" }));
  assert.ok(enqueued.ok);
  const standing = await readMessagesByConversationTyped(database.run, conversation.conversationId);
  return await insertMessage(database.run, {
    userId: conversation.userId,
    conversationId: conversation.conversationId,
    seq: standing.length + 1,
    turnId: enqueued.turnId,
    clientId: `briefing-${enqueued.turnId}`,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: "A briefing.", state: "done" }],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    finishedAt: new Date(NOW),
  });
}

/**
 * A row as the service names it to the writer: the id its ledger minted and
 * the span it holds the utterance at. The ids here read as the row's start so
 * a test reads as its timeline; the writer reads nothing from the name.
 */
function developerRow(rowId: string, startMs: number, endMs: number): SpokenRowWrite {
  return { rowId, speaker: TRANSCRIPT_SPEAKER.USER, startMs, endMs };
}

function lukeRow(rowId: string, startMs: number, endMs: number): SpokenRowWrite {
  return { rowId, speaker: TRANSCRIPT_SPEAKER.ASSISTANT, startMs, endMs };
}

async function speechEvents(conversation: ConversationTarget) {
  const rows = await readEventsByConversation(database.run, conversation.conversationId);
  return rows.map((row) => ({ kind: row.kind, messageId: row.message_id, payload: row.payload }));
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
  assert.deepEqual(await speechEvents(live.conversation), []);
});

test("segments after a gap land on the same open row, from a fresh writer, with closed_at still null", async () => {
  const live = await target();
  const first = writer();
  await database.run(first.consume(live, heard("before the gap", 1000, 2000)));
  await database.run(record.noteUsage({ sessionId: live.liveSessionId, seconds: 12 }));

  const attached = writer();
  await database.run(record.register({ userId: live.userId, sessionId: live.liveSessionId }));
  assert.deepEqual(
    await database.run(attached.consume(live, heard("after the gap", 900_000, 901_000))),
    WRITTEN,
  );

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
    await database.run(voice.consume({ ...live, liveSessionId: "sess_unknown" }, heard("x", 0, 1))),
    {
      ok: false,
      refusal: VOICE_WRITE_REFUSAL.NO_SESSION,
    },
  );
  const other = await database.createUser();
  assert.deepEqual(
    await database.run(voice.consume({ ...live, userId: other }, heard("x", 0, 1))),
    {
      ok: false,
      refusal: VOICE_WRITE_REFUSAL.NO_SESSION,
    },
  );
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
    assert.deepEqual(await database.run(voice.consume(live, event)), {
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
  await database.run(voice.consume(live, said("Earlier words.", 100, 900)));
  assert.deepEqual(await database.run(voice.consume(live, appended("append-1", 1000, 4000))), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  // A delta that begins before the appended commentary ends is not its speech.
  await database.run(voice.consume(live, said("The fixture", 3800, 4100)));
  assert.equal(
    (await speechEvents(live.conversation)).some(
      (event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
    ),
    false,
  );
  // The first delta beginning at or after the end is.
  await database.run(voice.consume(live, said(" session is waiting", 4000, 5200)));
  await database.run(voice.consume(live, said(" on a permission prompt.", 5200, 6400)));

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
  assert.deepEqual(
    await database.run(voice.consume(live, appended("append-unknown", 7000, 8000))),
    {
      ok: true,
      effect: STORE_WRITE_EFFECT.IGNORED,
    },
  );
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
  await database.run(voice.consume(live, appended("append-a", 0, 1000)));
  await database.run(voice.consume(live, appended("append-b", 1000, 2000)));
  assert.deepEqual(
    await database.run(voice.consume(live, said("Both said.", 2000, 3000))),
    WRITTEN,
  );
  const spokenOf = async () =>
    (await speechEvents(live.conversation))
      .filter((event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN)
      .map((event) => event.messageId);
  assert.deepEqual(await spokenOf(), [first, secondBriefingId]);
  // Neither is marked a second time.
  await database.run(voice.consume(live, said("And more.", 3000, 4000)));
  assert.deepEqual(await spokenOf(), [first, secondBriefingId]);
});

test("a briefing this session's device did not claim is not marked spoken by its voice: unclaimed, another device's, or a session with no device", async () => {
  const live = await target();
  const unclaimed = await announced(live.conversation);
  assert.equal((await database.run(offerSpeech(speech, live.userId, unclaimed, NOW))).ok, true);
  const voice = writer();
  voice.noteAppend(live, { clientEventId: "append-u", messageId: unclaimed });
  await database.run(voice.consume(live, appended("append-u", 0, 1000)));
  assert.deepEqual(await database.run(voice.consume(live, said("Said anyway.", 1000, 2000))), {
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
  await database.run(otherVoice.consume(other, appended("append-o", 0, 1000)));
  assert.deepEqual(await database.run(otherVoice.consume(other, said("Not mine.", 1000, 2000))), {
    ok: false,
    refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
  });

  const deviceless = await target();
  const claimed = await briefing(deviceless.conversation);
  await setVoiceSessionDeviceId(database.run, deviceless.liveSessionId, null);
  const noDevice = writer();
  noDevice.noteAppend(deviceless, { clientEventId: "append-n", messageId: claimed });
  await database.run(noDevice.consume(deviceless, appended("append-n", 0, 1000)));
  assert.deepEqual(
    await database.run(noDevice.consume(deviceless, said("Nobody's.", 1000, 2000))),
    {
      ok: false,
      refusal: VOICE_WRITE_REFUSAL.NOT_CLAIMANT,
    },
  );

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
  await database.run(voice.consume(live, appended("append-2", 0, 500)));
  assert.deepEqual(await database.run(voice.consume(live, said("Words.", 600, 900))), {
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

test("a delegation attaches the developer's rows on record in place, under their own ids; the next delegation's rows are its own; a row another delegation owns, or none, attaches nothing; the stream's own delegation event writes nothing", async () => {
  const live = await target();
  const voice = writer();
  const voiceSessionId = await sessionRowId(live.liveSessionId);
  await database.run(voice.consume(live, heard("What is the fixture", 1200, 2600)));
  await database.run(voice.consume(live, heard(" waiting on?", 2500, 4800)));
  await database.run(
    voice.consume(live, said("It is waiting on a permission prompt.", 5000, 7000)),
  );
  // The stream's delegation event is consumed like any other and leaves nothing: the ask reaches the
  // record only through the rows the service names.
  assert.deepEqual(await database.run(voice.consume(live, delegated("dl_1", 4900))), {
    ok: true,
    effect: STORE_WRITE_EFFECT.IGNORED,
  });
  assert.deepEqual(await spokenAsks(live.conversation), []);
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, developerRow(`developer-1200`, 1200, 4800))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(live, { delegationId: "dl_1", rowIds: ["developer-1200"] }),
    ),
    WRITTEN,
  );
  await database.run(voice.consume(live, heard("Tell it to go ahead.", 8000, 9400)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, developerRow(`developer-8000`, 8000, 9400))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(live, { delegationId: "dl_2", rowIds: ["developer-8000"] }),
    ),
    WRITTEN,
  );

  const first: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1200,
    to_ms: 4800,
  };
  const second: UserMessageMetadata = {
    ...first,
    delegation_id: "dl_2",
    from_ms: 8000,
    to_ms: 9400,
  };
  assert.deepEqual(await spokenAsks(live.conversation), [
    {
      clientId: "developer-1200",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "What is the fixture waiting on?", state: "done" }],
      metadata: first,
      finishedAt: new Date(NOW),
    },
    {
      clientId: "developer-8000",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Tell it to go ahead.", state: "done" }],
      metadata: second,
      finishedAt: new Date(NOW),
    },
  ]);
  // A row a delegation owns is not another's to take, and a row not on record is nothing to attach.
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(live, { delegationId: "dl_3", rowIds: ["developer-1200"] }),
    ),
    { ok: true, effect: STORE_WRITE_EFFECT.IGNORED },
  );
  assert.deepEqual(
    await database.run(voice.attachSpokenAsk(live, { delegationId: "dl_3", rowIds: ["nowhere"] })),
    { ok: true, effect: STORE_WRITE_EFFECT.IGNORED },
  );
  // Told again, the delegation finds its own row and nothing changes.
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(live, { delegationId: "dl_1", rowIds: ["developer-1200"] }),
    ),
    WRITTEN,
  );
  assert.equal((await spokenAsks(live.conversation)).length, 2);
  // The delegation writes nothing of Luke's: his words are segments until his own row is written,
  // which names the delegation the developer's line before them was handed to.
  assert.equal((await segments(live.liveSessionId)).length, 4);
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, lukeRow(`luke-5000`, 5000, 7000))),
    WRITTEN,
  );
  const rows = await spokenAsks(live.conversation);
  assert.deepEqual(
    rows.map((row) => [row.clientId, row.role]),
    [
      ["developer-1200", MESSAGE_ROLE.USER],
      ["developer-8000", MESSAGE_ROLE.USER],
      ["luke-5000", MESSAGE_ROLE.ASSISTANT],
    ],
  );
  assert.deepEqual(rows[2]?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    from_ms: 5000,
    to_ms: 7000,
    delegation_id: "dl_1",
  });
});

test("an exchange the voice model answers itself leaves both utterances as finished rows cut from the segments, the developer's line first, once each", async () => {
  const live = await target();
  const voice = writer();
  const voiceSessionId = await sessionRowId(live.liveSessionId);
  await database.run(voice.consume(live, heard("Which agent is", 1200, 2600)));
  await database.run(voice.consume(live, heard(" waiting on me?", 2500, 4800)));
  await database.run(voice.consume(live, said("The fixture agent is,", 5000, 6200)));
  await database.run(voice.consume(live, said(" on a permission prompt.", 6100, 7400)));

  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, developerRow(`developer-1200`, 1200, 4800))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, lukeRow(`luke-5000`, 5000, 7400))),
    WRITTEN,
  );
  // Told again, from this writer or a fresh one, each row is grown in place rather than doubled.
  assert.deepEqual(
    await database.run(writer().upsertSpokenRow(live, developerRow(`developer-1200`, 1200, 4800))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(writer().upsertSpokenRow(live, lukeRow(`luke-5000`, 5000, 7400))),
    WRITTEN,
  );

  const rows = await readMessagesByConversationTyped(
    database.run,
    live.conversation.conversationId,
  );
  assert.deepEqual(
    rows.map((row) => [row.role, row.turnId, row.parts, row.metadata, row.finishedAt]),
    [
      [
        MESSAGE_ROLE.USER,
        null,
        [{ type: "text", text: "Which agent is waiting on me?", state: "done" }],
        {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: voiceSessionId,
          from_ms: 1200,
          to_ms: 4800,
        },
        new Date(NOW),
      ],
      [
        MESSAGE_ROLE.ASSISTANT,
        null,
        [{ type: "text", text: "The fixture agent is, on a permission prompt.", state: "done" }],
        {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: voiceSessionId,
          from_ms: 5000,
          to_ms: 7400,
        },
        new Date(NOW),
      ],
    ],
  );
  assert.ok((rows[0]?.seq ?? 0) < (rows[1]?.seq ?? 0));
  // An utterance whose span holds no segment writes nothing: the words are not there to write.
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(live, developerRow(`developer-9000`, 9000, 9500))),
    { ok: true, effect: STORE_WRITE_EFFECT.IGNORED },
  );
  assert.equal((await segments(live.liveSessionId)).length, 4);
});

test("every settled utterance of Luke's is his row: before any line, a briefing read aloud beside the briefing's own message, and beside an ask handed to the brain", async () => {
  // Words before any developer line are the voice model's own, and the Conversation shows them.
  const first = await target();
  const firstSessionId = await sessionRowId(first.liveSessionId);
  const voice = writer();
  await database.run(voice.consume(first, said("Good morning.", 100, 900)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(first, lukeRow(`luke-100`, 100, 900))),
    WRITTEN,
  );
  assert.deepEqual(
    (await spokenAsks(first.conversation)).map((row) => [row.role, row.parts, row.metadata]),
    [
      [
        MESSAGE_ROLE.ASSISTANT,
        [{ type: "text", text: "Good morning.", state: "done" }],
        {
          author: MESSAGE_AUTHOR.VOICE_MODEL,
          channel: MESSAGE_CHANNEL.VOICE,
          voice_session_id: firstSessionId,
          from_ms: 100,
          to_ms: 900,
        },
      ],
    ],
  );

  // The voice following a commentary append this writer was told of: a briefing read aloud, marked spoken on the
  // briefing's message and written as its own row too, since what the developer heard is the reading.
  const second = await target();
  const messageId = await briefing(second.conversation);
  await database.run(voice.consume(second, heard("Anything new?", 100, 900)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(second, developerRow(`developer-100`, 100, 900))),
    WRITTEN,
  );
  voice.noteAppend(second, { clientEventId: "append-2", messageId });
  await database.run(voice.consume(second, appended("append-2", 1000, 2000)));
  await database.run(voice.consume(second, said("One agent finished.", 2000, 3200)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(second, lukeRow(`luke-2000`, 2000, 3200))),
    WRITTEN,
  );
  // The rows are the briefing the fixture announced, the developer's line, and the reading as Luke's
  // own row, which names the briefing it was read from: the speech began inside its span.
  const secondRows = await spokenAsks(second.conversation);
  assert.deepEqual(
    secondRows.map((row) => [row.role, row.clientId.startsWith("briefing-")]),
    [
      [MESSAGE_ROLE.ASSISTANT, true],
      [MESSAGE_ROLE.USER, false],
      [MESSAGE_ROLE.ASSISTANT, false],
    ],
  );
  assert.deepEqual(secondRows[2]?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: await sessionRowId(second.liveSessionId),
    from_ms: 2000,
    to_ms: 3200,
    read_from: messageId,
  });
  assert.equal(
    (await speechEvents(second.conversation)).some(
      (event) => event.kind === CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
    ),
    true,
  );

  // What Luke said while handing the ask to the brain is his own words too: the delegation takes the
  // developer's line, and his words stand as his row beside the turn's journal rather than vanishing.
  const third = await target();
  await database.run(voice.consume(third, heard("Open the failing one.", 100, 1400)));
  await database.run(voice.consume(third, said("Let me look.", 1500, 2300)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(third, developerRow(`developer-100`, 100, 1400))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(third, { delegationId: "dl_pre", rowIds: ["developer-100"] }),
    ),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(third, lukeRow(`luke-1500`, 1500, 2300))),
    WRITTEN,
  );
  const thirdRows = await spokenAsks(third.conversation);
  assert.deepEqual(
    thirdRows.map((row) => [row.role, row.clientId, row.parts]),
    [
      [
        MESSAGE_ROLE.USER,
        "developer-100",
        [{ type: "text", text: "Open the failing one.", state: "done" }],
      ],
      [
        MESSAGE_ROLE.ASSISTANT,
        thirdRows[1]?.clientId,
        [{ type: "text", text: "Let me look.", state: "done" }],
      ],
    ],
  );
  // His words name the delegation they followed; with no turn known for it yet, they were read from nothing.
  const thirdSessionId = await sessionRowId(third.liveSessionId);
  assert.deepEqual(thirdRows[1]?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: thirdSessionId,
    from_ms: 1500,
    to_ms: 2300,
    delegation_id: "dl_pre",
  });
  // A briefing read after that: the line before it is still the delegation's, and the reading is
  // still read from the briefing, since the speech began inside its span.
  const briefingId = await briefing(third.conversation);
  voice.noteAppend(third, { clientEventId: "append-3", messageId: briefingId });
  await database.run(voice.consume(third, appended("append-3", 4000, 5000)));
  await database.run(voice.consume(third, said("One agent finished.", 5000, 6200)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(third, lukeRow(`luke-5000`, 5000, 6200))),
    WRITTEN,
  );
  assert.deepEqual((await spokenAsks(third.conversation)).at(-1)?.metadata, {
    author: MESSAGE_AUTHOR.VOICE_MODEL,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: thirdSessionId,
    from_ms: 5000,
    to_ms: 6200,
    delegation_id: "dl_pre",
    read_from: briefingId,
  });
});

test("Luke's later words are his rows too, and so is the brain's reply read aloud, sentence by sentence, beside the turn's journal", async () => {
  // Answered, then more of Luke's words later in the session: a second row of his own.
  const answered = await target();
  const voice = writer();
  await database.run(voice.consume(answered, heard("Which agent is waiting?", 1000, 2400)));
  await database.run(voice.consume(answered, said("The fixture agent.", 3000, 4000)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(answered, developerRow(`developer-1000`, 1000, 2400))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(answered, lukeRow(`luke-3000`, 3000, 4000))),
    WRITTEN,
  );
  await database.run(
    voice.consume(answered, said("By the way, one agent finished.", 20_000, 22_000)),
  );
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(answered, lukeRow(`luke-20_000`, 20_000, 22_000))),
    WRITTEN,
  );
  assert.deepEqual(
    (await spokenAsks(answered.conversation)).map((row) => [row.role, row.parts]),
    [
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Which agent is waiting?", state: "done" }]],
      [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "The fixture agent.", state: "done" }]],
      [
        MESSAGE_ROLE.ASSISTANT,
        [{ type: "text", text: "By the way, one agent finished.", state: "done" }],
      ],
    ],
  );

  // The brain's reply read aloud after a delegated ask: the appends carry no briefing, so nothing is
  // marked spoken, and each settled utterance of the reading is Luke's own row like any other — the
  // words the developer heard, beside the turn's journal the brain wrote.
  const reading = await target();
  await database.run(voice.consume(reading, heard("Open the failing one.", 100, 1400)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(reading, developerRow(`developer-100`, 100, 1400))),
    WRITTEN,
  );
  assert.deepEqual(
    await database.run(
      voice.attachSpokenAsk(reading, { delegationId: "dl_read", rowIds: ["developer-100"] }),
    ),
    WRITTEN,
  );
  await database.run(voice.consume(reading, appended("reply-1", 5000, 5100)));
  await database.run(voice.consume(reading, said("Opening it now.", 5200, 6400)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(reading, lukeRow(`luke-5200`, 5200, 6400))),
    WRITTEN,
  );
  await database.run(voice.consume(reading, said("It is on the failing test.", 8000, 9500)));
  assert.deepEqual(
    await database.run(voice.upsertSpokenRow(reading, lukeRow(`luke-8000`, 8000, 9500))),
    WRITTEN,
  );
  assert.deepEqual(
    (await spokenAsks(reading.conversation)).map((row) => [row.role, row.clientId, row.parts]),
    [
      [
        MESSAGE_ROLE.USER,
        "developer-100",
        [{ type: "text", text: "Open the failing one.", state: "done" }],
      ],
      [
        MESSAGE_ROLE.ASSISTANT,
        (await spokenAsks(reading.conversation))[1]?.clientId,
        [{ type: "text", text: "Opening it now.", state: "done" }],
      ],
      [
        MESSAGE_ROLE.ASSISTANT,
        (await spokenAsks(reading.conversation))[2]?.clientId,
        [{ type: "text", text: "It is on the failing test.", state: "done" }],
      ],
    ],
  );
  assert.deepEqual(await speechEvents(reading.conversation), []);
});
