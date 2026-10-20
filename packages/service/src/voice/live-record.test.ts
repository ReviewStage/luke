import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import {
  type VoiceTarget,
  type VoiceWriteResult,
  voiceWriter,
} from "@luke/database/models/voice-writer";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  storeWriter,
} from "@luke/database/models/writer";
import {
  insertConversation,
  openHostedStoreTestDatabase,
  readMessagesByConversation,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
} from "@luke/database/testing";
import { VOICE_SEGMENT_ROLE } from "@luke/database/voice-vocabulary";
import {
  LIVE_CLIENT_EVENT,
  LIVE_DEFAULTS,
  type LiveAppendEvent,
  type LiveClientEvent,
} from "@luke/live";
import { liveBrainLayer, liveRecordLayer } from "@luke/voice/effect";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainCancel,
  type LiveBrainJoin,
  type LiveBrainRecovery,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
  LiveSessionService,
  ROW_WRITE_DEBOUNCE_MS,
} from "@luke/voice/live-session";
import { sidebandOverSocket } from "@luke/voice/live-socket";
import { FakeLiveSocket } from "@luke/voice/testing";
import { type ToolSet, tool } from "ai";
import { Deferred, Effect, Layer, Result, Schema, Scope } from "effect";
import { afterAll } from "vitest";
import { z } from "zod";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type UserMessageMetadata,
} from "../core.js";
import {
  delegated,
  heard,
  said,
  sessionStarted,
  thinkingAppended,
} from "../testing/live-events.js";
import { settled } from "../testing/settle.js";
import { hostedLiveRecord } from "./live-record.js";
import { observedSideband } from "./live-sideband.js";

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

const store = await database.run(storeWriter({ tools: TOOLS }));
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
  if (registered)
    await database.run(
      sessionRecord.register({
        userId,
        sessionId: liveSessionId,
        taskId: randomUUID(),
        attachId: randomUUID(),
        model: LIVE_DEFAULTS.MODEL,
      }),
    );
  return { userId, liveSessionId, conversation: { userId, conversationId } };
}

/**
 * Waits a delay of the service's own out. The service keeps time on the
 * ambient `Clock`, which is the real one here — this suite runs on the store
 * runtime the rest of the function does, over a real database, under
 * `it.live` — so the wait is real, with a margin for the turns the delay's
 * own write takes: a spin on the microtask queue, no second timer.
 */
const ELAPSE_MARGIN_MS = 200;
const ELAPSE_TURNS = 20;

function elapse(delayMs: number): Effect.Effect<void> {
  return Effect.andThen(
    Effect.sleep(delayMs + ELAPSE_MARGIN_MS),
    Effect.promise(async () => {
      for (let turn = 0; turn < ELAPSE_TURNS; turn += 1) await Promise.resolve();
    }),
  );
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

  /** The backend is not set exploring here, nor any earlier work taken up: what is recorded is the developer's asks alone. */
  join(): Effect.Effect<LiveBrainJoin> {
    return Effect.succeed({
      joined: false,
      runs: [],
      missed: undefined,
      questions: [],
      follow: Effect.void,
    });
  }

  cancelRun(): Effect.Effect<LiveBrainCancel> {
    return Effect.succeed(LIVE_BRAIN_CANCEL.NOT_RUNNING);
  }

  recoverRuns(): Effect.Effect<LiveBrainRecovery> {
    return Effect.succeed({ revision: 0, runs: [], follow: Effect.void });
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
  let ids = 0;
  const service = await database.run(
    Scope.provide(
      Effect.provide(
        LiveSessionService.make({
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
      const adopted = await database.run(
        service.adoptSession({
          sessionId: live.liveSessionId,
          attach: () =>
            Effect.succeed(
              observedSideband(sidebandOverSocket(socket), (event) => {
                observed.push(database.run(record.observe(event)));
              }),
            ),
          started: false,
        }),
      );
      assert.ok(adopted);
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

it.live(
  "a spoken ask is the developer's row attached to the delegation, its words including a delta that arrived after the delegation, and the reply is spoken under the delegation once that row is on record",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* Effect.promise(() => stand(live));
      yield* Effect.promise(() => f.open());

      f.socket.receive(said("Hi there.", 0, 900));
      f.socket.receive(heard("What needs me", 1000, 1800));
      f.socket.receive(delegated("dl_1", 2500));
      // Spoken before the delegation, delivered after it: still the ask's.
      f.socket.receive(heard(" right now?", 1800, 2400));
      yield* settled(() => f.brain.asks.length === 1, "the ask to reach the brain");
      // The ask on record is what says the service has the exchange the run's
      // events belong to: it composes the ask, hears the run's id, and attaches
      // the row to the delegation, in that order.
      yield* settled(
        async () => (await askRow(live.conversation)) !== undefined,
        "the ask on record",
      );
      f.brain.reply("run-1", "Nothing yet.");
      yield* settled(() => f.commentary().length === 1, "the reply to be spoken");

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
    }),
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
it.live(
  "the 2026-09-14 shape: every developer word is on a row attached to the delegation, in the order said, Luke's rows unattached, nothing dropped",
  () =>
    Effect.gen(function* () {
      const live = yield* Effect.promise(() => target());
      const f = yield* Effect.promise(() => stand(live));
      yield* Effect.promise(() => f.open());

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
      yield* elapse(ROW_WRITE_DEBOUNCE_MS);
      f.socket.receive(delegated("dl_shape", 237_600));
      yield* settled(() => f.brain.asks.length === 1, "the ask to reach the brain");
      yield* settled(
        async () => (await askRow(live.conversation, "dl_shape")) !== undefined,
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
    }),
);
