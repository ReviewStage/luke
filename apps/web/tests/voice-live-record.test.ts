import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  ASK_UNRECORDED_NOTE,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
  LiveSessionService,
  type LiveSessionSource,
  sidebandOverSocket,
  type TimerHandle,
} from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { type ToolSet, tool } from "ai";
import { Schema } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
  CONVERSATION_ENTRY_KIND,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type UserMessageMetadata,
} from "../server/core";
import { VOICE_SEGMENT_ROLE } from "../server/db/voice-vocabulary";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  storeWriter,
  VOICE_WRITE_REFUSAL,
  type VoiceTarget,
  type VoiceWriteResult,
  voiceWriter,
} from "../server/hosted/store";
import {
  LIVE_CLIENT_EVENT,
  type LiveAppendEvent,
  type LiveClientEvent,
  UTTERANCE_GAP_MS,
  UTTERANCE_SETTLE_MARGIN_MS,
} from "../server/live";
import { hostedLiveRecord } from "../server/voice/live-record";
import { observedSideband } from "../server/voice/live-sideband";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { delegated, heard, said, sessionStarted, thinkingAppended } from "./support/live-events";
import {
  insertConversation,
  readMessagesByConversation,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
} from "./support/store-rows";

/**
 * The live session service over the hosted record, on the real migrations in
 * PGlite: a synthetic session's stream — no real spoken word, title, or
 * session — driven through the service exactly as the voice service would
 * drive it, and the rows it leaves read back. What these tests hold to is the
 * plan's split and the service's own rule that the record precedes the
 * speech: the developer's spoken ask is the one message, cut from the
 * segments the deltas wrote, and a reply is spoken only once that ask is on
 * record, while nothing Luke said becomes a message.
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
const sessionRecord = voiceSessionRecord(database.run, () => NOW);
const writer = voiceWriter({ store });

/**
 * A user with a main conversation, and the live session's row unless the test
 * wants none. Every row is the test's own: the user is fresh, and the live
 * session id is minted rather than counted, because on CI every store test
 * file runs against one Postgres and `live_session_id` is unique across them.
 */
async function target(registered = true): Promise<VoiceTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  const liveSessionId = `sess_${randomUUID()}`;
  if (registered) await sessionRecord.register({ userId, sessionId: liveSessionId });
  return { userId, liveSessionId, conversation: { userId, conversationId } };
}

/**
 * A clock this suite drives by hand, kept beside it rather than in the
 * shared `@sidecar/voice/testing` door: nothing is due until the test
 * advances it, and firing a due timer awaits real macrotask turns (through
 * the same `node:timers/promises` `setTimeout` the store's own `until`
 * polls with) so the real database write a settled timer starts has
 * settled by the time `advance` returns.
 */
class ManualClock {
  now = 1_800_000_000_000;
  readonly delays: number[] = [];
  readonly #timers = new Map<TimerHandle, { callback: () => void; at: number }>();

  schedule = (callback: () => void, delayMs: number): TimerHandle => {
    const handle: TimerHandle = {};
    this.delays.push(delayMs);
    this.#timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };

  cancel = (timer: TimerHandle): void => {
    this.#timers.delete(timer);
  };

  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      for (let turn = 0; turn < 20; turn += 1) await sleep(0);
    }
    this.now = Math.max(this.now, untilMs);
  }
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  #runs = 0;

  async submitAsk(ask: LiveBrainAsk): Promise<LiveBrainSubmission> {
    this.asks.push(ask);
    this.#runs += 1;
    return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: `run-${this.#runs}` };
  }

  onRunEvent(listener: (event: LiveBrainRunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** The run answers: every action settled, one sentence, and its end. */
  reply(runId: string, sentence: string): void {
    const events: LiveBrainRunEvent[] = [
      { kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId },
      { kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence },
      { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId, end: LIVE_BRAIN_RUN_END.COMPLETED },
    ];
    for (const event of events) for (const listener of [...this.#listeners]) listener(event);
  }
}

/** The service composed as the voice service composes it: the record observing the sideband ahead of the service. */
function stand(live: VoiceTarget) {
  const clock = new ManualClock();
  const brain = new FakeBrain();
  const record = hostedLiveRecord({ run: database.run, writer, target: live });
  const socket = new FakeLiveSocket();
  // The session acknowledges every thinking append at once, as the real one
  // does for an append that speaks nothing; the acknowledgment is a server
  // event the record observes like any other, and ignores.
  socket.onSent((data) => {
    const event: LiveClientEvent = JSON.parse(data);
    if (event.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
      socket.receive(thinkingAppended(event.event_id));
    }
  });
  const observed: Promise<VoiceWriteResult>[] = [];
  const source: LiveSessionSource = {
    create: async (input) => ({
      sessionId: live.liveSessionId,
      sdpAnswer: `answer-for-${input.sdpOffer}`,
      attach: async () =>
        observedSideband(sidebandOverSocket(socket), (event) => {
          observed.push(record.observe(event));
        }),
    }),
    setVoice: () => undefined,
    diagnostics: () => {
      throw new Error("not read here");
    },
  };
  let ids = 0;
  const service = new LiveSessionService({
    source: () => source,
    brain,
    record,
    conversationEntries: () => [],
    quietNow: async () => false,
    releaseHeldBriefings: () => undefined,
    emit: () => undefined,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    createId: () => `id-${++ids}`,
    report: () => undefined,
  });
  return {
    clock,
    brain,
    socket,
    service,
    observed,
    async open() {
      const created = await service.createSession("offer");
      assert.ok(created);
      socket.receive(sessionStarted(live.liveSessionId));
    },
    commentary(): LiveAppendEvent[] {
      return socket.sent
        .map((frame): LiveClientEvent => JSON.parse(frame))
        .filter(
          (event): event is LiveAppendEvent => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
        );
    },
  };
}

/** Waits for a database-backed write to land; the assertion is the caller's. */
async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const VoiceSessionIdRowSchema = Schema.Struct({ id: Schema.String });

const SegmentRowSchema = Schema.Struct({
  seq: Schema.Number,
  role: Schema.String,
  text: Schema.String,
  start_ms: Schema.Number,
  end_ms: Schema.Number,
});

const MessageRowSchema = Schema.Struct({
  client_id: Schema.String,
  role: Schema.String,
  parts: Schema.Unknown,
  metadata: Schema.Unknown,
});

async function sessionRowId(liveSessionId: string): Promise<string> {
  const [row] = await readVoiceSessionByLiveSessionId(database.run, liveSessionId);
  assert.ok(row);
  return Schema.decodeUnknownSync(VoiceSessionIdRowSchema)(row).id;
}

async function segments(liveSessionId: string) {
  const rows = await readVoiceTranscriptSegmentsBySession(
    database.run,
    await sessionRowId(liveSessionId),
  );
  return rows
    .map((row) => Schema.decodeUnknownSync(SegmentRowSchema)(row))
    .map((row) => [row.seq, row.role, row.text, row.start_ms, row.end_ms]);
}

async function messageRows(
  conversation: ConversationTarget,
): Promise<{ clientId: string; role: string; parts: unknown; metadata: unknown }[]> {
  const rows = await readMessagesByConversation(database.run, conversation.conversationId);
  return rows.map((row) => {
    const decoded = Schema.decodeUnknownSync(MessageRowSchema)(row);
    return {
      clientId: decoded.client_id,
      role: decoded.role,
      parts: decoded.parts,
      metadata: decoded.metadata,
    };
  });
}

const IGNORED = { ok: true, effect: STORE_WRITE_EFFECT.IGNORED } as const;
const WRITTEN = { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN } as const;

test("a spoken ask is the one message, cut from the segments including a delta that arrived after the delegation, and the reply is spoken under the delegation once the ask is on record", async () => {
  const live = await target();
  const f = stand(live);
  await f.open();

  f.socket.receive(said("Hi there.", 0, 900));
  f.socket.receive(heard("What needs me", 1000, 1800));
  f.socket.receive(delegated("dl_1", 2500));
  // Spoken before the delegation, delivered after it: still the ask's.
  f.socket.receive(heard(" right now?", 1800, 2400));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  f.brain.reply("run-1", "Nothing yet.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  const voiceSessionId = await sessionRowId(live.liveSessionId);
  const metadata: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1000,
    to_ms: 2500,
  };
  assert.deepEqual(await messageRows(live.conversation), [
    {
      clientId: "dl_1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "What needs me right now?", state: "done" }],
      metadata,
    },
  ]);
  assert.deepEqual(await segments(live.liveSessionId), [
    [1, VOICE_SEGMENT_ROLE.ASSISTANT, "Hi there.", 0, 900],
    [2, VOICE_SEGMENT_ROLE.USER, "What needs me", 1000, 1800],
    [3, VOICE_SEGMENT_ROLE.USER, " right now?", 1800, 2400],
  ]);
  assert.deepEqual(
    f.commentary().map((event) => [event.type, event.delegation_id, event.content]),
    [[LIVE_CLIENT_EVENT.COMMENTARY_APPEND, "dl_1", "Nothing yet."]],
  );
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, WRITTEN, WRITTEN, IGNORED, WRITTEN]);
});

test("an utterance that settled before its delegation arrived is still the delegation's ask on record before its reply is spoken", async () => {
  const live = await target();
  const f = stand(live);
  await f.open();

  f.socket.receive(heard("Open the failing one.", 1000, 2200));
  await Promise.all(f.observed);
  // The settle timer writes the utterance with no delegation, and the service counts it written.
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.deepEqual(await messageRows(live.conversation), []);

  f.socket.receive(delegated("dl_late", 5000));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  f.brain.reply("run-1", "Opening it.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.clientId, row.role, row.parts]),
    [
      [
        "dl_late",
        MESSAGE_ROLE.USER,
        [{ type: "text", text: "Open the failing one.", state: "done" }],
      ],
    ],
  );
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_late", "Opening it."]],
  );
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, WRITTEN, IGNORED]);
});

test("a delegation delivered ahead of the words it is about is held, and is the ask on record once the service composes it on the words", async () => {
  const live = await target();
  const f = stand(live);
  await f.open();

  f.socket.receive(delegated("dl_early", 2500));
  await Promise.all(f.observed);
  assert.equal(f.brain.asks.length, 0);
  assert.deepEqual(await messageRows(live.conversation), []);

  f.socket.receive(heard("What needs me?", 1000, 2400));
  await until(() => f.brain.asks.length === 1, "the retained delegation to be composed");
  f.brain.reply("run-1", "Nothing yet.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.clientId, row.parts]),
    [["dl_early", [{ type: "text", text: "What needs me?", state: "done" }]]],
  );
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_early", "Nothing yet."]],
  );
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, IGNORED, WRITTEN]);
});

test("an ask the record refuses is answered with the unrecorded note alone, and its reply is dropped", async () => {
  const live = await target(false);
  const f = stand(live);
  await f.open();

  f.socket.receive(heard("Stop the fixture.", 600, 1800));
  f.socket.receive(delegated("dl_2", 2000));
  await until(() => f.commentary().length === 1, "the refusal to be spoken");
  f.brain.reply("run-1", "Stopping it.");
  await sleep(20);

  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_2", ASK_UNRECORDED_NOTE]],
  );
  assert.deepEqual(await messageRows(live.conversation), []);
  const refused = { ok: false, refusal: VOICE_WRITE_REFUSAL.NO_SESSION } as const;
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, refused, IGNORED]);
});

test("the record door answers from the stream: a delegation is held until its ask is written, a repeated write is the same message, an unseen delegation is refused, and neither an undelegated utterance nor Luke's words reach a row", async () => {
  const live = await target();
  const record = hostedLiveRecord({ run: database.run, writer, target: live });
  const utterance = {
    rowId: 1,
    voiceSessionId: live.liveSessionId,
    askContext: undefined,
    startMs: 0,
    endMs: 900,
    recordedAt: NOW,
  };

  assert.deepEqual(await record.observe(heard("Open the failing one.", 0, 900)), WRITTEN);
  assert.equal(
    await record.writeDeveloperUtterance({
      ...utterance,
      text: "Open the failing one.",
      delegationId: null,
    }),
    true,
  );
  assert.equal(
    await record.writeLukeUtterance({
      ...utterance,
      role: CONVERSATION_ENTRY_KIND.REPLY,
      text: "Opening it.",
    }),
    true,
  );
  assert.equal(
    await record.writeDeveloperUtterance({ ...utterance, text: "x", delegationId: "dl_unseen" }),
    false,
  );
  assert.deepEqual(await messageRows(live.conversation), []);

  assert.deepEqual(await record.observe(delegated("dl_3", 1000)), IGNORED);
  assert.deepEqual(await messageRows(live.conversation), []);
  const ask = { ...utterance, text: "Open the failing one.", delegationId: "dl_3" };
  assert.equal(await record.writeDeveloperUtterance(ask), true);
  assert.equal(await record.writeDeveloperUtterance(ask), true);
  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.clientId, row.role]),
    [["dl_3", MESSAGE_ROLE.USER]],
  );
  assert.deepEqual(await segments(live.liveSessionId), [
    [1, VOICE_SEGMENT_ROLE.USER, "Open the failing one.", 0, 900],
  ]);
});
