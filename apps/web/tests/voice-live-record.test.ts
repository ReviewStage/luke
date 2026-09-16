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
  ROW_WRITE_DEBOUNCE_MS,
  sidebandOverSocket,
} from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { type ToolSet, tool } from "ai";
import { Deferred, Effect, Layer, Schema, Scope } from "effect";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
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
  TRANSCRIPT_SPEAKER,
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
 * speech: each speaker's utterance is a row of its own under the id the
 * service's ledger minted, on record behind the debounce and grown in place;
 * the developer's row a delegation is about takes the delegation in place,
 * and a reply is spoken only once that row is on record under it.
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
 * real, with a margin for the turns the delay's own write takes.
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
  revision: Schema.Unknown,
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
): Promise<
  { clientId: string; role: string; parts: unknown; metadata: unknown; revision: number }[]
> {
  const rows = await readMessagesByConversation(database.run, conversation.conversationId);
  return rows.map((row) => {
    const decoded = Schema.decodeUnknownSync(MessageRowSchema)(row);
    return {
      clientId: decoded.client_id,
      role: decoded.role,
      parts: decoded.parts,
      metadata: decoded.metadata,
      // A row never written in place has no revision; the driver hands the column back as it will.
      revision: Number(decoded.revision ?? 0),
    };
  });
}

/** The rows as the plan's tests compare them: everything but the revision, which only the in-place tests read. */
function shownRows(rows: Awaited<ReturnType<typeof messageRows>>) {
  return rows.map(({ revision: _revision, ...row }) => row);
}

const DelegatedMetadataSchema = Schema.Struct({ delegation_id: Schema.String });

/** The delegation a row's metadata names, where it names one. */
function delegationOf(row: { metadata: unknown }): string | undefined {
  return Schema.is(DelegatedMetadataSchema)(row.metadata) ? row.metadata.delegation_id : undefined;
}

/** The developer's row a delegation owns, once the ask's write has attached it. */
async function askRow(conversation: ConversationTarget, delegationId = "dl_1") {
  return (await messageRows(conversation)).find(
    (row) => row.role === MESSAGE_ROLE.USER && delegationOf(row) === delegationId,
  );
}

const IGNORED = { ok: true, effect: STORE_WRITE_EFFECT.IGNORED } as const;
const WRITTEN = { ok: true, effect: STORE_WRITE_EFFECT.WRITTEN } as const;

test("a spoken ask is the developer's row attached to the delegation, its words including a delta that arrived after the delegation, and the reply is spoken under the delegation once that row is on record", async () => {
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
  // events belong to: it composes the ask, hears the run's id, and attaches
  // the row to the delegation, in that order.
  await until(async () => (await askRow(live.conversation)) !== undefined, "the ask on record");
  f.brain.reply("run-1", "Nothing yet.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  const voiceSessionId = await sessionRowId(live.liveSessionId);
  const metadata: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1000,
    to_ms: 2400,
  };
  // The delegation flushed both rows before the ask was composed: Luke's greeting stands as his own
  // row, and the developer's row, its id the ledger's still, took the delegation with the late word on it.
  const rows = await messageRows(live.conversation);
  assert.deepEqual(
    rows.map((row) => [row.role, row.parts]),
    [
      [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Hi there.", state: "done" }]],
      [MESSAGE_ROLE.USER, [{ type: "text", text: "What needs me right now?", state: "done" }]],
    ],
  );
  const ask = rows[1];
  assert.ok(ask);
  assert.notEqual(ask.clientId, "dl_1");
  assert.deepEqual(shownRows([ask]), [
    {
      clientId: ask.clientId,
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

test("an utterance whose row is on record before its delegation arrives takes the delegation in place, under its own id, before its reply is spoken", async () => {
  const live = await target();
  const f = await stand(live);
  await f.open();

  f.socket.receive(heard("Open the failing one.", 1000, 2200));
  await Promise.all(f.observed);
  // The row's own write puts the utterance on record with no delegation: the developer's line stands as a row of its own.
  await elapse(ROW_WRITE_DEBOUNCE_MS);
  const settled = await messageRows(live.conversation);
  assert.deepEqual(
    settled.map((row) => [row.role, row.parts]),
    [[MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]]],
  );
  const undelegated = settled[0];
  assert.ok(undelegated);
  assert.notEqual(undelegated.clientId, "dl_late");
  assert.equal(delegationOf(undelegated), undefined);

  f.socket.receive(delegated("dl_late", 5000));
  await until(() => f.brain.asks.length === 1, "the ask to reach the brain");
  // The ask on record is what says the service has the exchange the run's
  // events belong to: it composes the ask, hears the run's id, and attaches
  // the row to the delegation, in that order.
  await until(
    async () => (await askRow(live.conversation, "dl_late")) !== undefined,
    "the ask on record",
  );
  f.brain.reply("run-1", "Opening it.");
  await until(() => f.commentary().length === 1, "the reply to be spoken");

  // The delegation attached the row rather than cutting a second: one row, its id the ledger's
  // still, naming the delegation, with its own span.
  const rows = await messageRows(live.conversation);
  assert.deepEqual(
    rows.map((row) => [row.clientId, row.role, row.parts]),
    [
      [
        undelegated.clientId,
        MESSAGE_ROLE.USER,
        [{ type: "text", text: "Open the failing one.", state: "done" }],
      ],
    ],
  );
  const settledMetadata = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    undelegated.metadata,
  );
  assert.deepEqual(rows[0]?.metadata, { ...settledMetadata, delegation_id: "dl_late" });
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [["dl_late", "Opening it."]],
  );
  assert.deepEqual(await Promise.all(f.observed), [IGNORED, WRITTEN, IGNORED]);
});

test("a row is on record within the debounce of its first fragment and grows in place with the next: the same id, the words so far, the span's end moved, and the revision bumped", async () => {
  const live = await target();
  const f = await stand(live);
  await f.open();

  f.socket.receive(heard("Open the", 1000, 1400));
  await elapse(ROW_WRITE_DEBOUNCE_MS);
  const [first] = await messageRows(live.conversation);
  assert.ok(first);
  assert.deepEqual(first.parts, [{ type: "text", text: "Open the", state: "done" }]);

  f.socket.receive(heard(" failing one.", 1400, 2200));
  await elapse(ROW_WRITE_DEBOUNCE_MS);
  const rows = await messageRows(live.conversation);
  const voiceSessionId = await sessionRowId(live.liveSessionId);
  const metadata: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    from_ms: 1000,
    to_ms: 2200,
  };
  assert.deepEqual(shownRows(rows), [
    {
      clientId: first.clientId,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Open the failing one.", state: "done" }],
      metadata,
    },
  ]);
  assert.ok((rows[0]?.revision ?? 0) > first.revision);
  // Silence writes nothing more: the row stands as its last fragment left it.
  await elapse(ROW_WRITE_DEBOUNCE_MS);
  assert.deepEqual(await messageRows(live.conversation), rows);
});

test("a delegation delivered ahead of the words it is about is retained by the service, and its row is on record under it once the service composes it on the words", async () => {
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
    (await messageRows(live.conversation)).map((row) => [delegationOf(row), row.parts]),
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

test("the record door answers from the stream: the developer's row and Luke's answer to it are rows cut from the segments, the stream's delegation event writes nothing, the ask's write attaches its row once however often it is made, and a row with no words on record is refused", async () => {
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
  };

  assert.deepEqual(
    await database.run(record.observe(heard("Open the failing one.", 0, 900))),
    WRITTEN,
  );
  assert.deepEqual(await database.run(record.observe(said("Opening it.", 1200, 2000))), WRITTEN);
  // The developer's row, undelegated, is cut from its segments.
  assert.equal(
    await database.run(record.upsertSpokenRow({ ...utterance, speaker: TRANSCRIPT_SPEAKER.USER })),
    true,
  );
  // Luke's answer to it is a row too, over its own span.
  assert.equal(
    await database.run(
      record.upsertSpokenRow({
        ...utterance,
        rowId: "row-2",
        speaker: TRANSCRIPT_SPEAKER.ASSISTANT,
        startMs: 1200,
        endMs: 2000,
      }),
    ),
    true,
  );
  // A row whose span holds no segment is not on record and cannot be the ask's.
  assert.equal(
    await database.run(
      record.writeDeveloperUtterance({
        ...utterance,
        rowId: "row-nowhere",
        startMs: 5000,
        endMs: 5500,
        text: "x",
        delegationId: "dl_unseen",
      }),
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

  // The stream's delegation event writes nothing; the ask's own write attaches its row.
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
  // The drain a closing session waits on covers the attach with the row's write: once drained, the
  // row is the delegation's, never written and left for an attach the close would cut.
  const writing = database.run(record.writeDeveloperUtterance(ask));
  await database.run(record.drained());
  assert.equal(
    delegationOf((await messageRows(live.conversation))[2] ?? { metadata: null }),
    "dl_3",
  );
  assert.equal(await writing, true);
  assert.equal(await database.run(record.writeDeveloperUtterance(ask)), true);
  assert.deepEqual(
    (await messageRows(live.conversation)).map((row) => [row.role, row.parts]),
    [
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]],
      [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Opening it.", state: "done" }]],
      [MESSAGE_ROLE.USER, [{ type: "text", text: "Now run it.", state: "done" }]],
    ],
  );
  const attached = (await messageRows(live.conversation))[2];
  assert.deepEqual(
    [attached?.clientId, delegationOf(attached ?? { metadata: null })],
    ["row-3", "dl_3"],
  );
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
  await until(async () => (await askRow(live.conversation)) !== undefined, "the ask on record");

  const voiceSessionId = await sessionRowId(live.liveSessionId);
  const metadata: UserMessageMetadata = {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    voice_session_id: voiceSessionId,
    delegation_id: "dl_1",
    from_ms: 1000,
    to_ms: 2600,
  };
  const [ask] = await messageRows(live.conversation);
  assert.ok(ask);
  assert.notEqual(ask.clientId, "dl_1");
  assert.deepEqual(shownRows([ask]), [
    {
      clientId: ask.clientId,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Open the failing one.", state: "done" }],
      metadata,
    },
  ]);
  // The row is the ask's now and is grown no further by its own write: one row.
  await elapse(ROW_WRITE_DEBOUNCE_MS);
  assert.equal((await messageRows(live.conversation)).length, 1);
});
