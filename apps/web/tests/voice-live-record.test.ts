import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
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
import { arrival, FakeLiveSocket, onFakeChange } from "@sidecar/voice/testing";
import { type ToolSet, tool } from "ai";
import { Deferred, Duration, Effect, Fiber, Layer, Result, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
import { afterAll } from "vitest";
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
 *
 * The service keeps time on the ambient `TestClock`, so the debounce is
 * advanced rather than waited out, and every write takes the one `SqlClient`
 * the suite's runtime holds. No wait here is a wait on the machine: a wait
 * for the brain to be asked or for a reply to be spoken is woken by the fake
 * that moved (`arrival`), and a wait for a row is the record's own drain with
 * every observed write awaited beside it.
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

const store = await database.run(storeWriter({ tools: TOOLS }));
const sessionRecord = voiceSessionRecord(() => NOW);
const writer = voiceWriter({ store });
/** The one client the suite's runtime holds, provided to the service's fibers so every statement takes the same permit. */
const sqlClient = await database.run(Effect.service(SqlClient.SqlClient));

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

/** How many fiber steps a settle gives the fibers a socket arrival or a clock tick started. */
const SETTLE_TURNS = 20;
/** How often the drain is taken: a delegation's compose enqueues its attach some steps after the flush it began with. */
const SETTLE_ROUNDS = 3;

/** Lets the fibers a socket arrival or a clock tick started run their course. */
function turns(): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) yield* Effect.yieldNow;
  });
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  /** While set, each ask is taken at once and answered only when this settles, as a brain across the network answers. */
  answerWhen: Deferred.Deferred<void> | undefined;
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  readonly #askListeners = new Set<() => void>();
  #runs = 0;

  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen({ self: this }, function* () {
      this.asks.push(ask);
      for (const listener of [...this.#askListeners]) listener();
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

  /** Tells a waiter that an ask arrived, so a wait on the brain being asked is woken rather than polled. */
  onAsk = (listener: () => void): (() => void) => {
    this.#askListeners.add(listener);
    return () => {
      this.#askListeners.delete(listener);
    };
  };

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

/** What a standing fixture hands the test; `stand` answers it, the socket's scope the test's own. */
interface RunningFixture {
  readonly brain: FakeBrain;
  readonly socket: FakeLiveSocket;
  readonly service: LiveSessionService;
  /** The session's stream as the record observes it, so a failed write fails the test rather than vanishing. */
  readonly observed: Promise<VoiceWriteResult>[];
  /** Waits out every write the record has been handed so far. */
  settle(): Effect.Effect<void>;
  /** The debounce passes on the clock the test keeps, and what it put off is written. */
  debounce(): Effect.Effect<void>;
  commentary(): LiveAppendEvent[];
  /** Waits for the brain to have been asked as many times as named, woken by the ask itself. */
  asked(count: number): Effect.Effect<void>;
  /** Waits for as many replies to have been spoken as named, woken by the socket's own send. */
  spoken(count: number): Effect.Effect<void>;
}

/**
 * The service composed as the voice service composes it: the record observing
 * the sideband ahead of the service, the session opened and started, and the
 * socket's scope the test's own.
 */
function stand(
  live: VoiceTarget,
): Effect.Effect<RunningFixture, never, Scope.Scope | SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const brain = new FakeBrain();
    const record = yield* hostedLiveRecord({ writer, target: live });
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
    const service = yield* Effect.provide(
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
    );
    const created = yield* service.createSession("offer");
    assert.ok(created);
    socket.receive(sessionStarted(live.liveSessionId));
    const commentary = (): LiveAppendEvent[] =>
      socket.sent
        .map((frame): LiveClientEvent => JSON.parse(frame))
        .filter(
          (event): event is LiveAppendEvent => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
        );
    const settle = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        // The drain is taken more than once with turns between, because a write
        // a settling fiber enqueues after the last drain is one this must cover.
        for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
          yield* turns();
          yield* record.drained();
        }
        yield* Effect.promise(() => Promise.all(observed));
      });
    return {
      brain,
      socket,
      service,
      observed,
      settle,
      commentary,
      debounce: () =>
        Effect.gen(function* () {
          // The turns before the move let a delay the service armed reach its sleep.
          yield* turns();
          yield* TestClock.adjust(Duration.millis(ROW_WRITE_DEBOUNCE_MS));
          yield* settle();
        }),
      asked: (count) =>
        arrival(brain.onAsk, () => brain.asks.length >= count, "the ask to reach the brain"),
      spoken: (count) =>
        arrival(onFakeChange, () => commentary().length >= count, "the reply to be spoken"),
    };
  });
}

const VoiceSessionIdRowSchema = Schema.Struct({ id: Schema.String });

const SegmentRowSchema = Schema.Struct({
  seq: Schema.Number,
  role: Schema.String,
  text: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
});

const MessageRowSchema = Schema.Struct({
  clientId: Schema.String,
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
    .map((row) => [row.seq, row.role, row.text, row.startMs, row.endMs]);
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
      clientId: decoded.clientId,
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

const IGNORED = Result.succeed(STORE_WRITE_EFFECT.IGNORED);
const WRITTEN = Result.succeed(STORE_WRITE_EFFECT.WRITTEN);

it.effect(
  "a spoken ask is the developer's row attached to the delegation, its words including a delta that arrived after the delegation, and the reply is spoken under the delegation once that row is on record",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);

      f.socket.receive(said("Hi there.", 0, 900));
      f.socket.receive(heard("What needs me", 1000, 1800));
      f.socket.receive(delegated("dl_1", 2500));
      // Spoken before the delegation, delivered after it: still the ask's.
      f.socket.receive(heard(" right now?", 1800, 2400));
      yield* f.asked(1);
      // The ask on record is what says the service has the exchange the run's
      // events belong to: it composes the ask, hears the run's id, and attaches
      // the row to the delegation, in that order.
      yield* f.settle();
      assert.ok(yield* Effect.promise(() => askRow(live.conversation)), "the ask on record");
      f.brain.reply("run-1", "Nothing yet.");
      yield* f.spoken(1);

      const voiceSessionId = yield* Effect.promise(() => sessionRowId(live.liveSessionId));
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
      const rows = yield* Effect.promise(() => messageRows(live.conversation));
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
      assert.deepEqual(yield* Effect.promise(() => segments(live.liveSessionId)), [
        [1, VOICE_SEGMENT_ROLE.ASSISTANT, "Hi there.", 0, 900],
        [2, VOICE_SEGMENT_ROLE.USER, "What needs me", 1000, 1800],
        [3, VOICE_SEGMENT_ROLE.USER, " right now?", 1800, 2400],
      ]);
      assert.deepEqual(
        f.commentary().map((event) => [event.type, event.delegation_id, event.content]),
        [[LIVE_CLIENT_EVENT.COMMENTARY_APPEND, "dl_1", "Nothing yet."]],
      );
      assert.deepEqual(yield* Effect.promise(() => Promise.all(f.observed)), [
        IGNORED,
        WRITTEN,
        WRITTEN,
        IGNORED,
        WRITTEN,
      ]);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "an utterance whose row is on record before its delegation arrives takes the delegation in place, under its own id, before its reply is spoken",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);

      f.socket.receive(heard("Open the failing one.", 1000, 2200));
      yield* Effect.promise(() => Promise.all(f.observed));
      // The row's own write puts the utterance on record with no delegation: the developer's line stands as a row of its own.
      yield* f.debounce();
      const onRecord = yield* Effect.promise(() => messageRows(live.conversation));
      assert.deepEqual(
        onRecord.map((row) => [row.role, row.parts]),
        [[MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]]],
      );
      const undelegated = onRecord[0];
      assert.ok(undelegated);
      assert.notEqual(undelegated.clientId, "dl_late");
      assert.equal(delegationOf(undelegated), undefined);

      f.socket.receive(delegated("dl_late", 5000));
      yield* f.asked(1);
      // The ask on record is what says the service has the exchange the run's
      // events belong to: it composes the ask, hears the run's id, and attaches
      // the row to the delegation, in that order.
      yield* f.settle();
      assert.ok(
        yield* Effect.promise(() => askRow(live.conversation, "dl_late")),
        "the ask on record",
      );
      f.brain.reply("run-1", "Opening it.");
      yield* f.spoken(1);

      // The delegation attached the row rather than cutting a second: one row, its id the ledger's
      // still, naming the delegation, with its own span.
      const rows = yield* Effect.promise(() => messageRows(live.conversation));
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
      const settledMetadata = Schema.decodeUnknownSync(
        Schema.Record(Schema.String, Schema.Unknown),
      )(undelegated.metadata);
      assert.deepEqual(rows[0]?.metadata, { ...settledMetadata, delegation_id: "dl_late" });
      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [["dl_late", "Opening it."]],
      );
      assert.deepEqual(yield* Effect.promise(() => Promise.all(f.observed)), [
        IGNORED,
        WRITTEN,
        IGNORED,
      ]);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a row is on record within the debounce of its first fragment and grows in place with the next: the same id, the words so far, the span's end moved, and the revision bumped",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);

      f.socket.receive(heard("Open the", 1000, 1400));
      yield* f.debounce();
      const [first] = yield* Effect.promise(() => messageRows(live.conversation));
      assert.ok(first);
      assert.deepEqual(first.parts, [{ type: "text", text: "Open the", state: "done" }]);

      f.socket.receive(heard(" failing one.", 1400, 2200));
      yield* f.debounce();
      const rows = yield* Effect.promise(() => messageRows(live.conversation));
      const voiceSessionId = yield* Effect.promise(() => sessionRowId(live.liveSessionId));
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
      yield* f.debounce();
      assert.deepEqual(yield* Effect.promise(() => messageRows(live.conversation)), rows);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a delegation delivered ahead of the words it is about is retained by the service, and its row is on record under it once the service composes it on the words",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);

      f.socket.receive(delegated("dl_early", 2500));
      yield* Effect.promise(() => Promise.all(f.observed));
      assert.equal(f.brain.asks.length, 0);
      assert.deepEqual(yield* Effect.promise(() => messageRows(live.conversation)), []);

      f.socket.receive(heard("What needs me?", 1000, 2400));
      yield* f.asked(1);
      yield* f.settle();
      assert.equal(
        (yield* Effect.promise(() => messageRows(live.conversation))).length,
        1,
        "the ask on record",
      );
      f.brain.reply("run-1", "Nothing yet.");
      yield* f.spoken(1);

      assert.deepEqual(
        (yield* Effect.promise(() => messageRows(live.conversation))).map((row) => [
          delegationOf(row),
          row.parts,
        ]),
        [["dl_early", [{ type: "text", text: "What needs me?", state: "done" }]]],
      );
      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [["dl_early", "Nothing yet."]],
      );
      assert.deepEqual(yield* Effect.promise(() => Promise.all(f.observed)), [
        IGNORED,
        IGNORED,
        WRITTEN,
      ]);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "an ask the record refuses is answered all the same: nothing is said of the record, and the reply is spoken",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target(false));
      const f = yield* stand(live);

      f.socket.receive(heard("Stop the fixture.", 600, 1800));
      f.socket.receive(delegated("dl_2", 2000));
      yield* f.asked(1);
      // The exchange the run's events belong to stands once the ask's own fiber
      // is past the submission, so the settle precedes the reply.
      yield* f.settle();
      f.brain.reply("run-1", "Stopping it.");
      yield* f.spoken(1);

      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [["dl_2", "Stopping it."]],
      );
      assert.deepEqual(yield* Effect.promise(() => messageRows(live.conversation)), []);
      const refused = Result.fail(VOICE_WRITE_REFUSAL.NO_SESSION);
      assert.deepEqual(yield* Effect.promise(() => Promise.all(f.observed)), [
        IGNORED,
        refused,
        IGNORED,
      ]);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "the record door answers from the stream: the developer's row and Luke's answer to it are rows cut from the segments, the stream's delegation event writes nothing, an attach names the ask's rows once however often it is made, and a row not on record attaches nothing",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const record = yield* hostedLiveRecord({ writer, target: live });
      const utterance = {
        rowId: "row-1",
        voiceSessionId: live.liveSessionId,
        startMs: 0,
        endMs: 900,
      };

      assert.deepEqual(yield* record.observe(heard("Open the failing one.", 0, 900)), WRITTEN);
      assert.deepEqual(yield* record.observe(said("Opening it.", 1200, 2000)), WRITTEN);
      // The developer's row, undelegated, is cut from its segments.
      assert.equal(
        yield* record.upsertSpokenRow({ ...utterance, speaker: TRANSCRIPT_SPEAKER.USER }),
        true,
      );
      // Luke's answer to it is a row too, over its own span.
      assert.equal(
        yield* record.upsertSpokenRow({
          ...utterance,
          rowId: "row-2",
          speaker: TRANSCRIPT_SPEAKER.ASSISTANT,
          startMs: 1200,
          endMs: 2000,
        }),
        true,
      );
      // A row whose span holds no segment is not on record, and nothing is attached.
      assert.equal(
        yield* record.attachSpokenAsk({
          delegationId: "dl_unseen",
          voiceSessionId: live.liveSessionId,
          rows: [
            {
              ...utterance,
              rowId: "row-nowhere",
              speaker: TRANSCRIPT_SPEAKER.USER,
              startMs: 5000,
              endMs: 5500,
            },
          ],
        }),
        false,
      );
      assert.deepEqual(
        (yield* Effect.promise(() => messageRows(live.conversation))).map((row) => [
          row.role,
          row.parts,
        ]),
        [
          [MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]],
          [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Opening it.", state: "done" }]],
        ],
      );

      // The stream's delegation event writes nothing; the service's attach hands over the ask's row.
      assert.deepEqual(yield* record.observe(heard("Now run it.", 3000, 3800)), WRITTEN);
      assert.deepEqual(yield* record.observe(delegated("dl_3", 4000)), IGNORED);
      assert.equal((yield* Effect.promise(() => messageRows(live.conversation))).length, 2);
      const ask = {
        delegationId: "dl_3",
        voiceSessionId: live.liveSessionId,
        rows: [
          {
            ...utterance,
            rowId: "row-3",
            speaker: TRANSCRIPT_SPEAKER.USER,
            startMs: 3000,
            endMs: 3800,
          },
        ],
      };
      // The drain a closing session waits on covers the attach with the row's write: once drained, the
      // row is the delegation's, never written and left for an attach the close would cut. The attach
      // is forked so the drain is taken while it stands, as a closing session takes it.
      const attaching = yield* Effect.forkChild(record.attachSpokenAsk(ask), {
        startImmediately: true,
      });
      yield* record.drained();
      assert.equal(
        delegationOf(
          (yield* Effect.promise(() => messageRows(live.conversation)))[2] ?? { metadata: null },
        ),
        "dl_3",
      );
      assert.equal(yield* Fiber.join(attaching), true);
      assert.equal(yield* record.attachSpokenAsk(ask), true);
      assert.deepEqual(
        (yield* Effect.promise(() => messageRows(live.conversation))).map((row) => [
          row.role,
          row.parts,
        ]),
        [
          [MESSAGE_ROLE.USER, [{ type: "text", text: "Open the failing one.", state: "done" }]],
          [MESSAGE_ROLE.ASSISTANT, [{ type: "text", text: "Opening it.", state: "done" }]],
          [MESSAGE_ROLE.USER, [{ type: "text", text: "Now run it.", state: "done" }]],
        ],
      );
      const attached = (yield* Effect.promise(() => messageRows(live.conversation)))[2];
      assert.deepEqual(
        [attached?.clientId, delegationOf(attached ?? { metadata: null })],
        ["row-3", "dl_3"],
      );
      assert.deepEqual(yield* Effect.promise(() => segments(live.liveSessionId)), [
        [1, VOICE_SEGMENT_ROLE.USER, "Open the failing one.", 0, 900],
        [2, VOICE_SEGMENT_ROLE.ASSISTANT, "Opening it.", 1200, 2000],
        [3, VOICE_SEGMENT_ROLE.USER, "Now run it.", 3000, 3800],
      ]);
    }).pipe(Effect.orDie, Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a delegation placed ahead of the ask's last fragment, the fragment landing while the brain is asked, leaves the whole utterance on record as the ask, once, and the row keeps growing under the delegation after the handover",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);
      const answerWhen = Deferred.makeUnsafe<void>();
      f.brain.answerWhen = answerWhen;

      f.socket.receive(heard("Open the failing", 1000, 2200));
      // The API places the delegation's offset inside the utterance, ahead of its last fragment.
      f.socket.receive(delegated("dl_1", 2300));
      yield* f.asked(1);
      f.socket.receive(heard(" one.", 2400, 2600));
      yield* f.settle();
      assert.equal(
        (yield* Effect.promise(() => segments(live.liveSessionId))).length,
        2,
        "the last fragment on record",
      );
      yield* Deferred.succeed(answerWhen, undefined);
      yield* f.settle();
      assert.ok(yield* Effect.promise(() => askRow(live.conversation)), "the ask on record");

      const voiceSessionId = yield* Effect.promise(() => sessionRowId(live.liveSessionId));
      const metadata: UserMessageMetadata = {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.VOICE,
        voice_session_id: voiceSessionId,
        delegation_id: "dl_1",
        from_ms: 1000,
        to_ms: 2600,
      };
      const [ask] = yield* Effect.promise(() => messageRows(live.conversation));
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
      // The row is the ask's now and keeps growing: a word said after the handover lands on the same
      // row, under the same id, with the delegation kept and the revision moved. One row throughout.
      yield* f.debounce();
      assert.equal((yield* Effect.promise(() => messageRows(live.conversation))).length, 1);
      f.socket.receive(heard(" Please.", 2700, 3000));
      yield* f.debounce();
      const grown = yield* Effect.promise(() => messageRows(live.conversation));
      assert.deepEqual(shownRows(grown), [
        {
          clientId: ask.clientId,
          role: MESSAGE_ROLE.USER,
          parts: [{ type: "text", text: "Open the failing one. Please.", state: "done" }],
          metadata: { ...metadata, to_ms: 3000 },
        },
      ]);
      assert.ok((grown[0]?.revision ?? 0) > ask.revision);
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

/**
 * The 2026-09-14 shape, with synthetic words: the developer speaks in bursts
 * with Luke's acknowledgments between, and the delegation names an offset at
 * the developer's last word, arriving two seconds later. However the gap
 * constant groups the bursts, every developer word must be on a row the
 * delegation attached, in the order said, and Luke's three rows must stand
 * unattached: the assertions read the rows against the segments and never
 * count them.
 */
it.effect(
  "the 2026-09-14 shape: every developer word is on a row attached to the delegation, in the order said, Luke's rows unattached, nothing dropped",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* stand(live);

      const spoken = [
        heard("alpha bravo charlie", 215_200, 217_200),
        heard(" delta echo", 219_200, 220_800),
        said("Mm-hmm.", 220_600, 221_000),
        heard(" foxtrot golf hotel", 222_200, 224_600),
        said("'Kay.", 225_000, 225_400),
        heard(" india juliet kilo lima mike november oscar papa", 225_400, 237_600),
        said("Okay. On it.", 237_000, 238_200),
      ];
      for (const event of spoken) f.socket.receive(event);
      yield* Effect.promise(() => Promise.all(f.observed));
      yield* f.debounce();
      f.socket.receive(delegated("dl_shape", 237_600));
      yield* f.asked(1);
      yield* f.settle();
      assert.ok(
        yield* Effect.promise(() => askRow(live.conversation, "dl_shape")),
        "the ask on record",
      );

      const rows = yield* Effect.promise(() => messageRows(live.conversation));
      const developer = rows.filter((row) => row.role === MESSAGE_ROLE.USER);
      const luke = rows.filter((row) => row.role === MESSAGE_ROLE.ASSISTANT);
      // Every developer row is the delegation's, and no row of Luke's is.
      assert.ok(developer.length > 0);
      assert.ok(developer.every((row) => delegationOf(row) === "dl_shape"));
      assert.ok(luke.length > 0);
      assert.ok(luke.every((row) => delegationOf(row) === undefined));
      // The segments-to-rows word invariant, for each speaker: the rows, read in the order they
      // were spoken, carry exactly the speaker's segments in the order they arrived.
      const words = (row: { parts: unknown }) =>
        Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ text: Schema.String })))(row.parts)
          .map((part) => part.text)
          .join("");
      const rowFrom = (row: { metadata: unknown }) =>
        Schema.decodeUnknownSync(Schema.Struct({ from_ms: Schema.Number }))(row.metadata).from_ms;
      const rowWords = (speaker: typeof rows) =>
        [...speaker]
          .sort((left, right) => rowFrom(left) - rowFrom(right))
          .map((row) => words(row))
          .join("");
      const spokenSegments = yield* Effect.promise(() => segments(live.liveSessionId));
      const segmentWords = (role: string) =>
        spokenSegments
          .filter(([, segmentRole]) => segmentRole === role)
          .map(([, , text]) => text)
          .join("");
      assert.equal(rowWords(developer), segmentWords(VOICE_SEGMENT_ROLE.USER));
      assert.equal(
        rowWords(developer),
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa",
      );
      assert.equal(rowWords(luke), segmentWords(VOICE_SEGMENT_ROLE.ASSISTANT));
      assert.equal(rowWords(luke), "Mm-hmm.'Kay.Okay. On it.");
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);
