import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import {
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
} from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { type ToolSet, tool } from "ai";
import { Deferred, Effect, Layer, Schema, Scope } from "effect";
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
  type VoiceTarget,
  type VoiceWriteResult,
  voiceWriter,
} from "../server/hosted/store";
import { VOICE_WRITE_REFUSAL } from "../server/hosted/store/voice-writer";
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
const sessionRecord = voiceSessionRecord(() => NOW);
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
  if (registered) await database.run(sessionRecord.register({ userId, sessionId: liveSessionId }));
  return { userId, liveSessionId, conversation: { userId, conversationId } };
}

/**
 * Waits a delay of the service's own out. The service keeps time on the
 * ambient `Clock`, which is the real one here — this suite runs on the store
 * runtime the rest of the function does, over a real database — so the wait is
 * real, with a margin for the turns the settled delay's own write takes.
 */
const ELAPSE_MARGIN_MS = 200;

async function elapse(delayMs: number): Promise<void> {
  await sleep(delayMs + ELAPSE_MARGIN_MS);
  for (let turn = 0; turn < 20; turn += 1) await sleep(0);
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  /** While set, each ask is taken at once and answered only when this settles, as a brain across the network answers. */
  answerWhen: Deferred.Deferred<void> | undefined;
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  #runs = 0;

  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen({ self: this }, function* () {
      this.asks.push(ask);
      if (this.answerWhen !== undefined) yield* Deferred.await(this.answerWhen);
      this.#runs += 1;
      return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: `run-${this.#runs}` };
    });
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
async function stand(live: VoiceTarget) {
  const brain = new FakeBrain();
  // The socket's own scope, as the attachment opens one: the fiber that makes every write is forked into it.
  const scope = await database.run(Scope.make());
  const record = await database.run(
    Scope.provide(hostedLiveRecord({ writer, target: live }), scope),
  );
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
    create: (input) =>
      Effect.succeed({
        sessionId: live.liveSessionId,
        sdpAnswer: `answer-for-${input.sdpOffer}`,
        attach: () =>
          Effect.succeed(
            observedSideband(sidebandOverSocket(socket), (event) => {
              observed.push(database.run(record.observe(event)));
            }),
          ),
      }),
    setVoice: () => undefined,
    diagnostics: () => {
      throw new Error("not read here");
    },
  };
  let ids = 0;
  const service = await database.run(
    Scope.provide(
      Effect.provide(
        LiveSessionService.make({
          source: () => source,
          conversationEntries: () => [],
          quietNow: () => Effect.succeed(false),
          releaseHeldBriefings: () => Effect.void,
          emit: () => undefined,
          createId: () => `id-${++ids}`,
          report: () => undefined,
        }),
        Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
      ),
      scope,
    ),
  );
  return {
    brain,
    socket,
    service,
    observed,
    async open() {
      const created = await database.run(service.createSession("offer"));
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
async function until(predicate: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
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
  const f = await stand(live);
  await f.open();

  f.socket.receive(said("Hi there.", 0, 900));
  f.socket.receive(heard("What needs me", 1000, 1800));
  f.socket.receive(delegated("dl_1", 2500));
  // Spoken before the delegation, delivered after it: still the ask's.
  f.socket.receive(heard(" right now?", 1800, 2400));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  // The ask on record is what says the service has the exchange the run's
  // events belong to: it composes the ask, hears the run's id, and writes the
  // line under the delegation, in that order.
  await until(async () => (await messageRows(live.conversation)).length === 1, "the ask on record");
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
  const f = await stand(live);
  await f.open();

  f.socket.receive(heard("Open the failing one.", 1000, 2200));
  await Promise.all(f.observed);
  // The settle timer writes the utterance with no delegation: the developer's line stands as a row of its own.
  await elapse(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  const settled = await messageRows(live.conversation);
  assert.deepEqual(
    settled.map((row) => [row.role, row.parts]),
    [[MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]]],
  );
  const undelegated = settled[0];
  assert.ok(undelegated);
  assert.notEqual(undelegated.clientId, "dl_late");
  assert.equal(
    Schema.is(Schema.Struct({ delegation_id: Schema.String }))(undelegated.metadata),
    false,
  );

  f.socket.receive(delegated("dl_late", 5000));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  // The ask on record is what says the service has the exchange the run's
  // events belong to: it composes the ask, hears the run's id, and writes the
  // line under the delegation, in that order.
  await until(
    async () => (await messageRows(live.conversation))[0]?.clientId === "dl_late",
    "the ask on record",
  );
  f.brain.reply("run-1", "Opening it.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  // The delegation adopted the settled line rather than cutting a second: one row, now under the
  // delegation's id and naming it, with the span it settled at.
  const rows = await messageRows(live.conversation);
  assert.deepEqual(
    rows.map((row) => [row.clientId, row.role, row.parts]),
    [
      [
        "dl_late",
        MESSAGE_ROLE.USER,
        [{ type: "text", text: "Open the failing one.", state: "done" }],
      ],
    ],
  );
  const settledMetadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    undelegated.metadata,
  );
  assert.deepEqual(rows[0]?.metadata, {
    ...settledMetadata,
    delegation_id: "dl_late",
    to_ms: 5000,
  });
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_late", "Opening it."]],
  );
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, WRITTEN, IGNORED]);
});

test("a delegation delivered ahead of the words it is about is held, and is the ask on record once the service composes it on the words", async () => {
  const live = await target();
  const f = await stand(live);
  await f.open();

  f.socket.receive(delegated("dl_early", 2500));
  await Promise.all(f.observed);
  assert.equal(f.brain.asks.length, 0);
  assert.deepEqual(await messageRows(live.conversation), []);

  f.socket.receive(heard("What needs me?", 1000, 2400));
  await until(() => f.brain.asks.length === 1, "the retained delegation to be composed");
  await until(async () => (await messageRows(live.conversation)).length === 1, "the ask on record");
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

test("an ask the record refuses is answered all the same: nothing is said of the record, and the reply is spoken", async () => {
  const live = await target(false);
  const f = await stand(live);
  await f.open();

  f.socket.receive(heard("Stop the fixture.", 600, 1800));
  f.socket.receive(delegated("dl_2", 2000));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  f.brain.reply("run-1", "Stopping it.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_2", "Stopping it."]],
  );
  assert.deepEqual(await messageRows(live.conversation), []);
  const refused = { ok: false, refusal: VOICE_WRITE_REFUSAL.NO_SESSION } as const;
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, refused, IGNORED]);
});

test("the record door answers from the stream: an undelegated utterance and Luke's answer to it are rows cut from the segments, a delegation is held until its ask is written, a repeated write is the same message, and an unseen delegation is refused", async () => {
  const live = await target();
  const scope = await database.run(Scope.make());
  const record = await database.run(
    Scope.provide(hostedLiveRecord({ writer, target: live }), scope),
  );
  const utterance = {
    rowId: "row-1",
    voiceSessionId: live.liveSessionId,
    askContext: undefined,
    startMs: 0,
    endMs: 900,
    recordedAt: NOW,
  };

  assert.deepEqual(
    await database.run(record.observe(heard("Open the failing one.", 0, 900))),
    WRITTEN,
  );
  assert.deepEqual(await database.run(record.observe(said("Opening it.", 1200, 2000))), WRITTEN);
  // The developer's settled utterance, undelegated, is a row cut from its segments under the ledger's id.
  assert.equal(
    await database.run(
      record.writeDeveloperUtterance({
        ...utterance,
        text: "Open the failing one.",
        delegationId: null,
      }),
    ),
    true,
  );
  // Luke's answer to it is a row too, under its own id and over its own span.
  assert.equal(
    await database.run(
      record.writeLukeUtterance({
        ...utterance,
        rowId: "row-2",
        startMs: 1200,
        endMs: 2000,
        role: CONVERSATION_ENTRY_KIND.REPLY,
        text: "Opening it.",
      }),
    ),
    true,
  );
  assert.equal(
    await database.run(
      record.writeDeveloperUtterance({ ...utterance, text: "x", delegationId: "dl_unseen" }),
    ),
    false,
  );
  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.role, row.parts]),
    [
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]],
      [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Opening it.", state: "done" }]],
    ],
  );

  // A delegation on the next words is held until its ask is written, and cuts those words alone.
  assert.deepEqual(await database.run(record.observe(heard("Now run it.", 3000, 3800))), WRITTEN);
  assert.deepEqual(await database.run(record.observe(delegated("dl_3", 4000))), IGNORED);
  assert.equal((await messageRows(live.conversation)).length, 2);
  const ask = {
    ...utterance,
    rowId: "row-3",
    startMs: 3000,
    endMs: 3800,
    text: "Now run it.",
    delegationId: "dl_3",
  };
  assert.equal(await database.run(record.writeDeveloperUtterance(ask)), true);
  assert.equal(await database.run(record.writeDeveloperUtterance(ask)), true);
  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.role, row.parts]),
    [
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]],
      [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Opening it.", state: "done" }]],
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Now run it.", state: "done" }]],
    ],
  );
  assert.equal((await messageRows(live.conversation))[2]?.clientId, "dl_3");
  assert.deepEqual(await segments(live.liveSessionId), [
    [1, VOICE_SEGMENT_ROLE.USER, "Open the failing one.", 0, 900],
    [2, VOICE_SEGMENT_ROLE.ASSISTANT, "Opening it.", 1200, 2000],
    [3, VOICE_SEGMENT_ROLE.USER, "Now run it.", 3000, 3800],
  ]);
});

test("a delegation placed ahead of the ask's last fragment, the fragment landing while the brain is asked, leaves the whole utterance on record as the ask, once", async () => {
  const live = await target();
  const f = await stand(live);
  await f.open();
  f.brain.answerWhen = Deferred.makeUnsafe<void>();

  f.socket.receive(heard("Open the failing", 1000, 2200));
  // The API places the delegation's offset inside the utterance, ahead of its last fragment.
  f.socket.receive(delegated("dl_1", 2300));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  f.socket.receive(heard(" one.", 2400, 2600));
  await until(
    async () => (await segments(live.liveSessionId)).length === 2,
    "the last fragment on record",
  );
  await database.run(Deferred.succeed(f.brain.answerWhen, undefined));
  await until(async () => (await messageRows(live.conversation)).length === 1, "the ask on record");

  const voiceSessionId = await sessionRowId(live.liveSessionId);
  const metadata: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1000,
    to_ms: 2600,
  };
  assert.deepEqual(await messageRows(live.conversation), [
    {
      clientId: "dl_1",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Open the failing one.", state: "done" }],
      metadata,
    },
  ]);
  // The settle timer finds the row on record and writes it no second time.
  await elapse(UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal((await messageRows(live.conversation)).length, 1);
});
