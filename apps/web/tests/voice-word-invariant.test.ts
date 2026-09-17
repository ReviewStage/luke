import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { liveBrainLayer, liveRecordLayer } from "@sidecar/voice/effect";
import {
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainSubmission,
  LiveSessionService,
  type LiveSessionSource,
  ROW_WRITE_DEBOUNCE_MS,
  sidebandOverSocket,
} from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { type ToolSet, tool } from "ai";
import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
import { afterAll } from "vitest";
import { z } from "zod";
import {
  ASK_ORIGIN,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  MAIN_SESSION_KEY,
  UI_PART_TYPE,
} from "../server/core";
import { VOICE_SEGMENT_ROLE, type VoiceSegmentRole } from "../server/db/voice-vocabulary";
import {
  type ConversationTarget,
  storeWriter,
  type VoiceTarget,
  voiceWriter,
} from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEvent,
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
  UTTERANCE_GAP_MS,
} from "../server/live";
import { hostedLiveRecord } from "../server/voice/live-record";
import { observedSideband } from "../server/voice/live-sideband";
import { voiceSessionRecord } from "../server/voice/session-record";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { delegated, heard, said, sessionStarted, thinkingAppended } from "./support/live-events";
import {
  insertConversation,
  type MessageRowFull,
  readMessagesByConversationTyped,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
} from "./support/store-rows";

/**
 * The segments-to-rows word invariant, which is the property that failed on
 * 2026-09-14: for each speaker, the segments a session left on record, read
 * in the order they arrived, spell exactly what that speaker's rows spell
 * when the rows are read in the order they are placed, byte for byte, with
 * nothing trimmed, nothing inserted, nothing said twice, and nothing lost.
 * Beside it: the record holds one row per group the ledger formed; every
 * developer row from the previous ask's end to a delegation's offset carries
 * that delegation and its turn, and no other row does; and no row changes
 * its client id at any point of the run.
 *
 * Each fixture is a synthetic stream — invented words, never anyone's
 * transcript — driven through the live session service as the voice
 * service composes it: the service's own ledger groups the fragments and
 * decides the attach, the hosted record is the seam, the voice writer reads
 * the words back from the segments on record, and the brain stands up the
 * ask's turn in the store as the hosted brain does, all on the real
 * migrations in PGlite. The service keeps time on the ambient `TestClock`,
 * so the debounce is advanced rather than waited out, and every write takes
 * the one `SqlClient` the suite's runtime holds.
 *
 * Every fixture is held at two gaps, the tuned constant and one well short of
 * it, because the invariant is a property of the writes and not of the
 * threshold: the shorter gap cuts more rows, and the words must still read
 * the same. Production keeps its one constant. The ledger groups by how a
 * pause compares with the gap, so a stream heard at a 1.2 s gap is the same
 * stream with every instant stretched by 4.0 / 1.2 and heard at the constant;
 * the shadow ledger the row count is checked against hears the stretched
 * stream too, so the count it states is the count a 1.2 s gap states.
 */

const NOW = Date.parse("2026-09-14T12:00:00.000Z");

/** The tuned gap and a threshold well short of it, so the same words are cut into different rows. */
const GAP_VALUES_MS = [1_200, UTTERANCE_GAP_MS] as const;

/** An instant on the session's clock as it must stand for the tuned constant to group it as `gapMs` would. */
function stretched(ms: number, gapMs: number): number {
  return Math.round((ms * UTTERANCE_GAP_MS) / gapMs);
}

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
const asks = askRecord();
const sessionRecord = voiceSessionRecord(() => NOW);
const writer = voiceWriter({ store });
/** The one client the suite's runtime holds, provided to the service's fibers so every statement takes the same permit. */
const sqlClient = await database.run(Effect.service(SqlClient.SqlClient));

/** A user with a main conversation and the live session's row, all the fixture's own. */
async function target(): Promise<VoiceTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  const liveSessionId = `sess_${randomUUID()}`;
  await database.run(sessionRecord.register({ userId, sessionId: liveSessionId }));
  return { userId, liveSessionId, conversation: { userId, conversationId } };
}

/**
 * A brain that takes every ask and answers none, but leaves the ask's turn
 * on record as the hosted brain does before the service attaches: the ask
 * row under the delegation's id, the turn's own row started, and the ask
 * bound to it, so the attach that follows finds the turn and takes the rows
 * into it.
 */
class TurnOpeningBrain implements LiveBrain {
  /** The turn each delegation's ask was bound to, by the delegation's id. */
  readonly turns = new Map<string, string>();
  readonly #conversation: ConversationTarget;

  constructor(conversation: ConversationTarget) {
    this.#conversation = conversation;
  }

  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen({ self: this }, function* () {
      const turnId = randomUUID();
      const recorded = yield* asks.record({
        userId: this.#conversation.userId,
        conversationId: this.#conversation.conversationId,
        clientId: ask.submissionId,
        origin: ASK_ORIGIN.SPOKEN,
        createdAt: new Date(NOW),
      });
      yield* store.consume(this.#conversation, {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        origin: BRAIN_TURN_ORIGIN.SPOKEN,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
        conversationId: MAIN_SESSION_KEY,
        turnId,
        sequence: 1,
      });
      yield* asks.dispatchOnce(this.#conversation, recorded.id, () =>
        Effect.succeed({
          sessionId: `wrun_${turnId}`,
          turnId,
        }),
      );
      this.turns.set(ask.submissionId, turnId);
      return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: recorded.id };
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient), Effect.orDie);
  }

  onRunEvent(): () => void {
    return () => undefined;
  }
}

const FIXTURE_STEP = {
  /** One server event of the stream, delivered in this order. */
  EVENT: "event",
  /** The debounce passes: every row with a write put off is written. */
  DEBOUNCE: "debounce",
  /** The socket closes from the far side with no `session.closed`: the release writes what was put off. */
  CLOSE: "close",
} as const;

type FixtureStep =
  | { readonly kind: typeof FIXTURE_STEP.EVENT; readonly event: LiveServerEvent }
  | { readonly kind: typeof FIXTURE_STEP.DEBOUNCE }
  | { readonly kind: typeof FIXTURE_STEP.CLOSE };

const event = (served: LiveServerEvent): FixtureStep => ({
  kind: FIXTURE_STEP.EVENT,
  event: served,
});
const DEBOUNCE: FixtureStep = { kind: FIXTURE_STEP.DEBOUNCE };
const CLOSE: FixtureStep = { kind: FIXTURE_STEP.CLOSE };

interface Fixture {
  readonly name: string;
  readonly steps: readonly FixtureStep[];
}

/**
 * The shapes the invariant is held over. Every timing is an instant on the
 * session's clock at which a synthetic word is spoken; none is a threshold.
 */
const FIXTURES: readonly Fixture[] = [
  {
    // The 14th's shape, the real timings under invented words: bursts with a
    // 2.0 s and a 1.4 s pause between, Luke's acknowledgments between them
    // 4.0 s apart exactly, a long tail, the rows on record before the
    // delegation names the last word as its offset, and the row still
    // growing after the handover.
    name: "the 2026-09-14 shape: pause, backchannel, pause, long tail, and a delegation before the row stops growing",
    steps: [
      event(heard("alpha bravo charlie", 215_200, 217_200)),
      event(heard(" delta echo", 219_200, 220_800)),
      event(said("Mm-hmm.", 220_600, 221_000)),
      event(heard(" foxtrot golf hotel", 222_200, 224_600)),
      event(said("'Kay.", 225_000, 225_400)),
      event(heard(" india  juliet kilo lima mike november oscar papa", 225_400, 237_600)),
      event(said("Okay. On it.", 237_000, 238_200)),
      DEBOUNCE,
      event(delegated("dl_shape", 237_600)),
      event(heard(" quebec", 237_600, 238_400)),
      DEBOUNCE,
    ],
  },
  {
    name: "a delegation arriving before any developer fragment, then a second exchange",
    steps: [
      event(delegated("dl_early", 2_500)),
      DEBOUNCE,
      event(heard("What needs me?", 1_000, 2_400)),
      event(said("Nothing yet.", 3_000, 4_000)),
      event(heard("Then open", 9_000, 9_800)),
      event(heard(" the failing one.", 9_800, 10_500)),
      event(delegated("dl_second", 10_600)),
      DEBOUNCE,
    ],
  },
  {
    // Luke's reply pauses 2.0 s and then 5.2 s: one row at the tuned gap and
    // two at the short one for the first pause, a new row at either for the
    // second.
    name: "a Luke reply split by a long pause",
    steps: [
      event(heard("Summarize the desk.", 1_000, 2_200)),
      event(delegated("dl_desk", 2_300)),
      event(said("Three agents are running.", 3_000, 4_500)),
      event(said(" One is waiting on you.", 6_500, 7_800)),
      event(said(" Nothing has failed.", 13_000, 14_000)),
      DEBOUNCE,
    ],
  },
  {
    name: "a socket closing mid-sentence, the debounce never having fired",
    steps: [
      event(heard("Open the", 1_000, 1_400)),
      event(said("Sure.", 1_500, 1_900)),
      event(heard(" failing one", 1_900, 2_600)),
      CLOSE,
    ],
  },
  {
    // The developer's second fragment was spoken before Luke's word and the
    // delegation, and is delivered after both, once its row is on record and
    // attached: its timing places it on that row, which grows under the
    // delegation. The same again on the next ask, with the late fragment
    // trailing the delegation alone.
    name: "a fragment arriving out of order that belongs to an earlier row",
    steps: [
      event(heard("Where did the", 1_000, 1_800)),
      DEBOUNCE,
      event(said("Mm.", 2_000, 2_300)),
      event(delegated("dl_late", 2_600)),
      DEBOUNCE,
      event(heard(" build stop?", 1_800, 2_500)),
      DEBOUNCE,
      event(heard("And why?", 8_000, 8_900)),
      event(delegated("dl_why", 9_000)),
      event(heard(" Quickly.", 8_900, 9_400)),
      DEBOUNCE,
    ],
  },
];

/** The same step with every instant on the session's clock stretched, so the constant groups it as `gapMs` would. */
function stretchedStep(step: FixtureStep, gapMs: number): FixtureStep {
  if (step.kind !== FIXTURE_STEP.EVENT) return step;
  const served = step.event;
  switch (served.type) {
    case LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA:
    case LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA:
      return event({
        ...served,
        start_ms: stretched(served.start_ms, gapMs),
        end_ms: stretched(served.end_ms, gapMs),
      });
    case LIVE_SERVER_EVENT.DELEGATION_CREATED:
      return event({ ...served, offset_ms: stretched(served.offset_ms, gapMs) });
    default:
      return step;
  }
}

const SEGMENT_ROLE_OF_SPEAKER = {
  [TRANSCRIPT_SPEAKER.USER]: VOICE_SEGMENT_ROLE.USER,
  [TRANSCRIPT_SPEAKER.ASSISTANT]: VOICE_SEGMENT_ROLE.ASSISTANT,
} as const satisfies Record<TranscriptSpeaker, VoiceSegmentRole>;

const SPEAKER_OF_DELTA = {
  [LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA]: TRANSCRIPT_SPEAKER.USER,
  [LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA]: TRANSCRIPT_SPEAKER.ASSISTANT,
} as const;

const SegmentRowSchema = Schema.Struct({
  seq: Schema.Number,
  role: Schema.String,
  text: Schema.String,
});

const decodeSegmentRow = Schema.decodeUnknownSync(SegmentRowSchema);

const VoiceSessionIdRowSchema = Schema.Struct({ id: Schema.String });

const TextPartsSchema = Schema.Array(
  Schema.Struct({ type: Schema.Literal(UI_PART_TYPE.TEXT), text: Schema.String }),
);

/** A voice row's span on the session's clock and the delegation it carries, as the writer left them. */
const SpokenRowMetadataSchema = Schema.Struct({
  from_ms: Schema.Number,
  to_ms: Schema.Number,
  delegation_id: Schema.optional(Schema.String),
});

const decodeSpokenRowMetadata = Schema.decodeUnknownSync(SpokenRowMetadataSchema);

/** A row's words: its text parts joined as written, untrimmed. */
function rowWords(row: MessageRowFull): string {
  return Schema.decodeUnknownSync(TextPartsSchema)(row.parts)
    .map((part) => part.text)
    .join("");
}

/** The rows in the one order the Conversation reads them: where they are placed, then their sequence. */
function inPlacedOrder(rows: readonly MessageRowFull[]): MessageRowFull[] {
  return [...rows].sort(
    (left, right) => left.placedAt.getTime() - right.placedAt.getTime() || left.seq - right.seq,
  );
}

/** Whether a message row is one speaker's: the developer's rows are user rows, Luke's are assistant rows. */
function spokenBy(row: MessageRowFull, speaker: TranscriptSpeaker): boolean {
  return row.role === SEGMENT_ROLE_OF_SPEAKER[speaker];
}

/** The delegations a stream carried, in order, each with the offset it named. */
function delegationsOf(steps: readonly FixtureStep[]): { id: string; offsetMs: number }[] {
  return steps.flatMap((step) =>
    step.kind === FIXTURE_STEP.EVENT && step.event.type === LIVE_SERVER_EVENT.DELEGATION_CREATED
      ? [{ id: step.event.delegation.id, offsetMs: step.event.offset_ms }]
      : [],
  );
}

/** Lets the fibers a socket arrival or a clock tick started run their course. */
function turns() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface RunningFixture {
  readonly live: VoiceTarget;
  readonly voiceSessionId: string;
  readonly socket: FakeLiveSocket;
  readonly service: LiveSessionService;
  readonly brain: TurnOpeningBrain;
  /** The session's stream as the record observes it, so a failed write fails the test rather than vanishing. */
  readonly observed: Promise<unknown>[];
  /** Waits out every write the record has been handed so far. */
  settle(): Effect.Effect<void>;
  rows(): Effect.Effect<readonly MessageRowFull[]>;
  segments(): Effect.Effect<readonly { seq: number; role: string; text: string }[]>;
}

/**
 * The service over the hosted record, composed as the voice service composes
 * it: the record observes the sideband ahead of the service, the writer
 * reads the ambient client, and the brain leaves each ask's turn on record.
 */
function stand() {
  return Effect.gen(function* () {
    const live = yield* Effect.promise(target);
    const [sessionRow] = yield* Effect.promise(() =>
      readVoiceSessionByLiveSessionId(database.run, live.liveSessionId),
    );
    const voiceSessionId = Schema.decodeUnknownSync(VoiceSessionIdRowSchema)(sessionRow).id;
    const record = yield* hostedLiveRecord({ writer, target: live });
    const brain = new TurnOpeningBrain(live.conversation);
    const socket = new FakeLiveSocket();
    // The session acknowledges every thinking append at once, as the real one
    // does for an append that speaks nothing; the record observes and ignores it.
    socket.onSent((data) => {
      const sent: LiveClientEvent = JSON.parse(data);
      if (sent.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
        socket.receive(thinkingAppended(sent.event_id));
      }
    });
    const observed: Promise<unknown>[] = [];
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.succeed({
          sessionId: live.liveSessionId,
          sdpAnswer: `answer-for-${input.sdpOffer}`,
          attach: () =>
            Effect.succeed(
              observedSideband(sidebandOverSocket(socket), (served) => {
                observed.push(database.run(record.observe(served)));
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
    const running: RunningFixture = {
      live,
      voiceSessionId,
      socket,
      service,
      brain,
      observed,
      settle: () =>
        Effect.gen(function* () {
          // A delegation's compose enqueues its attach a few fiber steps after
          // the flush it began with, so the drain is taken twice with turns
          // between, and every observed write is awaited for its failure.
          for (let round = 0; round < 2; round += 1) {
            yield* turns();
            yield* record.drained();
          }
          yield* Effect.promise(() => Promise.all(observed));
        }),
      rows: () =>
        Effect.promise(() =>
          readMessagesByConversationTyped(database.run, live.conversation.conversationId),
        ),
      segments: () =>
        Effect.map(
          Effect.promise(() => readVoiceTranscriptSegmentsBySession(database.run, voiceSessionId)),
          (rows) => rows.map((row) => decodeSegmentRow(row)),
        ),
    };
    return running;
  });
}

/**
 * One step of a fixture, run and settled: an event is delivered to the socket
 * and fed to the shadow ledger; the debounce is advanced on the clock; a
 * close is the far side's, waited out through the service's own release.
 */
function perform(fixture: RunningFixture, shadow: TranscriptLedger, step: FixtureStep) {
  return Effect.gen(function* () {
    switch (step.kind) {
      case FIXTURE_STEP.EVENT: {
        const served = step.event;
        if (
          served.type === LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA ||
          served.type === LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA
        ) {
          shadow.append({
            speaker: SPEAKER_OF_DELTA[served.type],
            text: served.delta,
            startMs: served.start_ms,
            endMs: served.end_ms,
          });
        }
        fixture.socket.receive(served);
        break;
      }
      case FIXTURE_STEP.DEBOUNCE:
        // The turns before the move let a delay the service armed reach its sleep.
        yield* turns();
        yield* TestClock.adjust(Duration.millis(ROW_WRITE_DEBOUNCE_MS));
        break;
      case FIXTURE_STEP.CLOSE:
        fixture.socket.closeFromServer();
        yield* turns();
        yield* fixture.service.endSession();
        break;
    }
    yield* fixture.settle();
  });
}

/**
 * Every row seen so far keeps its id: a row is the same message under the
 * same client id in every later reading, and none disappears.
 */
function assertIdsStable(
  seen: Map<string, string>,
  rows: readonly MessageRowFull[],
  at: string,
): void {
  const now = new Map(rows.map((row) => [row.id, row.clientId]));
  for (const [id, clientId] of seen) {
    assert.equal(now.get(id), clientId, `row ${id} kept its client id ${at}`);
  }
  for (const [id, clientId] of now) seen.set(id, clientId);
}

for (const gapMs of GAP_VALUES_MS) {
  for (const fixture of FIXTURES) {
    it.effect(`${fixture.name} (gap ${gapMs} ms)`, () =>
      Effect.gen(function* () {
        const steps = fixture.steps.map((step) => stretchedStep(step, gapMs));
        const running = yield* stand();
        // The shadow ledger hears the same fragments in the same order, so its groups are what the
        // service's own ledger formed, ids aside.
        let shadowIds = 0;
        const shadow = new TranscriptLedger({ mintRowId: () => `shadow-${++shadowIds}` });
        const seenIds = new Map<string, string>();

        for (const [index, step] of steps.entries()) {
          yield* perform(running, shadow, step);
          assertIdsStable(seenIds, yield* running.rows(), `after step ${index + 1}`);
        }

        const rows = yield* running.rows();
        const segments = yield* running.segments();
        assert.ok(segments.length > 0);
        assert.equal(rows.length, shadow.captionLines().length, "one row per ledger group");

        for (const speaker of Object.values(TRANSCRIPT_SPEAKER)) {
          const spoken = segments
            .filter((segment) => segment.role === SEGMENT_ROLE_OF_SPEAKER[speaker])
            .map((segment) => segment.text)
            .join("");
          const written = inPlacedOrder(rows.filter((row) => spokenBy(row, speaker)))
            .map(rowWords)
            .join("");
          // The invariant: the segments in arrival order and the rows in placed order spell the same
          // bytes, so nothing was trimmed, padded, said twice, or lost, and no row is out of place.
          assert.equal(written, spoken, `${speaker}'s rows spell ${speaker}'s segments`);
          assert.equal(
            rows.filter((row) => spokenBy(row, speaker)).length,
            shadow.utterances(speaker).length,
            `${speaker}'s rows are ${speaker}'s ledger groups`,
          );
        }

        // Each delegation owns every developer row that begins after the previous ask's end and at
        // or before its offset, the row containing the offset among them, and no other: those rows
        // name the delegation and stand in its turn, and no other developer row stands in that turn.
        // The ask's end is the later of its offset and the rows it took.
        const developer = rows.filter((row) => spokenBy(row, TRANSCRIPT_SPEAKER.USER));
        let previousEndMs = 0;
        for (const delegation of delegationsOf(steps)) {
          const turnId = running.brain.turns.get(delegation.id);
          assert.ok(turnId, `${delegation.id} was asked of the brain`);
          const expected = developer.filter((row) => {
            const span = decodeSpokenRowMetadata(row.metadata);
            return span.from_ms > previousEndMs && span.from_ms <= delegation.offsetMs;
          });
          const expectedIds = expected.map((row) => row.clientId).sort();
          assert.ok(expected.length > 0, `${delegation.id} has a row of its own`);
          assert.deepEqual(
            developer
              .filter(
                (row) => decodeSpokenRowMetadata(row.metadata).delegation_id === delegation.id,
              )
              .map((row) => row.clientId)
              .sort(),
            expectedIds,
            `${delegation.id} owns the developer rows in its span`,
          );
          assert.deepEqual(
            developer
              .filter((row) => row.turnId === turnId)
              .map((row) => row.clientId)
              .sort(),
            expectedIds,
            `${delegation.id}'s turn holds the developer rows in its span`,
          );
          previousEndMs = Math.max(
            delegation.offsetMs,
            ...expected.map((row) => decodeSpokenRowMetadata(row.metadata).to_ms),
          );
        }
      }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
    );
  }
}
