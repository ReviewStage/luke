import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import {
  chunkForAppend,
  type InitialItem,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_IDLE_WINDOW_MS,
  LIVE_INPUT_BOUNDS,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEventType,
  PREFETCH_DEBOUNCE_MS,
  PROACTIVE_SPEECH_KIND,
  parseLiveServerEvent,
  type RosterSeedSession,
  rosterSeed,
  rosterUpdate,
  SEED_ROLE,
  seedItemTokens,
  TRANSCRIPT_SPEAKER,
  UTTERANCE_GAP_MS,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry, SESSION_STATUS } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Clock, Deferred, Duration, Effect, Fiber, Layer, type Scope, type Stream } from "effect";
import { TestClock } from "effect/testing";
import { liveBrainLayer } from "../effect/live-brain.js";
import { liveRecordLayer } from "../effect/live-record.js";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAnticipation,
  type LiveBrainAnticipationFacts,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "./live-brain.js";
import type { LiveRecord, SpokenAskAttach, SpokenRowUpsert } from "./live-record.js";
import {
  ANTICIPATION_FACTS_PREFIX,
  LiveSessionService,
  ROW_WRITE_DEBOUNCE_MS,
  RUN_END_NOTE,
  STOP_SPEAKING_INSTRUCTION,
} from "./live-session-service.js";
import { LIVE_TRACE_DECISION, type LiveTraceRecord } from "./live-trace.js";

/** The acknowledgment each append type earns, as the API names them. */
const ACKNOWLEDGMENT_OF: ReadonlyMap<LiveClientEvent["type"], LiveServerEventType> = new Map([
  [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED],
  [LIVE_CLIENT_EVENT.THINKING_APPEND, LIVE_SERVER_EVENT.THINKING_APPENDED],
  [LIVE_CLIENT_EVENT.COMMENTARY_APPEND, LIVE_SERVER_EVENT.COMMENTARY_APPENDED],
]);

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  closed = false;
  /** Whether a thinking append is acknowledged the instant it is sent, as the session does for an append that speaks nothing; a test that watches one wait turns this off. */
  acknowledgeThinkingAtOnce = true;
  /** The hold a real socket has beneath its sideband, so what a test says before the session reads is held exactly as it would be. */
  readonly #hold: SocketHold = holdSocket({
    send: () => undefined,
    close: () => {
      this.closed = true;
    },
  });
  readonly #sideband: LiveSideband = sidebandOverSocket(this.#hold.socket);

  get arrivals(): Stream.Stream<SidebandArrival> {
    return this.#sideband.arrivals;
  }

  send(event: LiveClientEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sent.push(event);
      if (this.acknowledgeThinkingAtOnce && event.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
        this.acknowledge(this.sent.length - 1, 0, 0);
      }
    });
  }

  get close(): Effect.Effect<void> {
    return this.#sideband.close;
  }

  /** Delivers one server event as the socket would, through the same parser the real sideband uses. */
  receive(payload: WireRecord): void {
    const frame = JSON.stringify(payload);
    assert.ok(parseLiveServerEvent(frame), `a test event must parse: ${frame}`);
    this.#hold.hear({ frame });
  }

  dropConnection(): void {
    this.#hold.hear({ close: { code: 1006 } });
  }

  /** Acknowledges the append sent at the given index, on the session timeline given. */
  acknowledge(index: number, startMs: number, endMs: number): void {
    const sent = this.sent[index];
    assert.ok(sent, `append ${index} was sent`);
    const acknowledgedType = ACKNOWLEDGMENT_OF.get(sent.type);
    assert.ok(acknowledgedType, `append ${index} is an append`);
    this.receive({
      type: acknowledgedType,
      event_id: `ack-${index}`,
      client_event_id: sent.event_id,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  started(sessionId: string): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: sessionId },
    });
  }

  delegation(id: string, offsetMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
      event_id: `delegation-${id}`,
      offset_ms: offsetMs,
      delegation: { id, target: LIVE_DELEGATION_TARGET.CLIENT },
    });
  }

  input(delta: string, startMs: number, endMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
      event_id: `in-${startMs}`,
      delta,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  output(delta: string, startMs: number, endMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
      event_id: `out-${startMs}`,
      delta,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  closedBy(reason: string, seconds: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason,
      usage: { seconds },
    });
  }
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  refuse: string | undefined;
  /** While set, each ask is taken at once and answered only when this settles, as a brain across the network answers. */
  answerWhen: Deferred.Deferred<void> | undefined;
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  #runs = 0;

  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen({ self: this }, function* () {
      this.asks.push(ask);
      if (this.answerWhen !== undefined) yield* Deferred.await(this.answerWhen);
      if (this.refuse !== undefined) {
        return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: this.refuse };
      }
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

  fire(event: LiveBrainRunEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}

/** A brain that reads ahead: it records each anticipation, each drop, and hands facts back by hand. */
class AnticipatingBrain extends FakeBrain {
  readonly anticipations: LiveBrainAnticipation[] = [];
  drops = 0;
  readonly #factsListeners = new Set<(facts: LiveBrainAnticipationFacts) => void>();

  anticipate(anticipation: LiveBrainAnticipation): Effect.Effect<void> {
    return Effect.sync(() => {
      this.anticipations.push(anticipation);
    });
  }

  dropAnticipation(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.drops += 1;
    });
  }

  onAnticipationFacts(listener: (facts: LiveBrainAnticipationFacts) => void): () => void {
    this.#factsListeners.add(listener);
    return () => {
      this.#factsListeners.delete(listener);
    };
  }

  facts(facts: LiveBrainAnticipationFacts): void {
    for (const listener of [...this.#factsListeners]) listener(facts);
  }
}

class FakeRecord implements LiveRecord {
  /** Every row write in the order the record was handed them: a row grows as repeats of its id, each over the span it then had. */
  readonly rows: SpokenRowUpsert[] = [];
  /** Every attach in the order the record was handed them: the rows a delegation is about, by the delegation. */
  readonly attached: SpokenAskAttach[] = [];
  /** While set, the writes of the kinds named wait here for the test to answer them, oldest first. */
  #held: { rows: boolean; answers: ((written: boolean) => void)[] } | undefined;

  /** The next delegated writes, and the row writes too where asked, are held until `release` answers them. */
  hold(kinds: { rows?: boolean } = {}): void {
    this.#held = { rows: kinds.rows ?? false, answers: [] };
  }

  /** Answers the oldest held write; a write answered true is on the record. */
  release(written: boolean): void {
    const held = this.#held?.answers.shift();
    assert.ok(held, "a write is held");
    held(written);
  }

  upsertSpokenRow(row: SpokenRowUpsert): Effect.Effect<boolean> {
    return this.#write(this.#held?.rows === true, () => this.rows.push(row));
  }

  /** The hosted record writes each row handed over before it attaches; the fake keeps the same account of the rows. */
  attachSpokenAsk(attach: SpokenAskAttach): Effect.Effect<boolean> {
    return this.#write(this.#held !== undefined, () => {
      this.rows.push(...attach.rows);
      this.attached.push(attach);
    });
  }

  #write(held: boolean, land: () => void): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      if (!held) {
        land();
        return Effect.succeed(true);
      }
      return Effect.map(
        Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              this.#held?.answers.push(resolve);
            }),
        ),
        (written) => {
          if (written) land();
          return written;
        },
      );
    });
  }
}

/** The rows as the tests read them: whose, and over what span; the words are the record's to cut. */
function spans(rows: readonly SpokenRowUpsert[]) {
  return rows.map((row) => [row.speaker, row.startMs, row.endMs]);
}

/** Each attach as a delegation and the ids of the rows it named, oldest first. */
function attaches(record: FakeRecord) {
  return record.attached.map((attach) => ({
    delegationId: attach.delegationId,
    voiceSessionId: attach.voiceSessionId,
    rowIds: attach.rows.map((row) => row.rowId),
  }));
}

/** The row the brain was handed to read ahead of, which is what its facts are matched against. */
function anticipatedRow(brain: AnticipatingBrain): string {
  const rowId = brain.anticipations[0]?.rowId;
  assert.ok(rowId, "an anticipation was handed over");
  return rowId;
}

/**
 * The instant the service reads, as the test reads it: the ambient
 * `TestClock`'s own, which the service keeps time on too, so a value a test
 * builds and one the service records are built from the same number.
 */
interface TestNow {
  readonly now: number;
}

function testNow(clock: Clock.Clock): TestNow {
  return {
    get now() {
      return clock.currentTimeMillisUnsafe();
    },
  };
}

/**
 * Moves the ambient `TestClock` forward by `deltaMs`, firing whatever it finds
 * due, and settles what that firing started. The turns before the move are
 * what let a delay the service armed on its own fiber reach its sleep, since
 * a sleep begun after the move would not be due yet.
 */
function advanceClock(deltaMs: number) {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.millis(deltaMs));
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

/** Lets queued microtasks and forked fibers run their course. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface Fixture {
  clock: TestNow;
  brain: FakeBrain;
  record: FakeRecord;
  sidebands: FakeSideband[];
  creates: LiveSessionOpened[];
  seeds: readonly (readonly InitialItem[])[];
  changes: VoiceLiveSessionChanged[];
  traces: LiveTraceRecord[];
  released: { briefing: string; decidedAt: number }[][];
  spoken: string[];
  service: LiveSessionService;
  entries: ConversationEntry[];
  roster: RosterSeedSession[];
  quiet: boolean;
  sourceAvailable: boolean;
  open: () => Effect.Effect<FakeSideband>;
  /** What the test wants told of a briefing's last append; nothing by default. */
  onBriefingAppend?: (delivery: { briefing: string; decidedAt: number }, eventId: string) => void;
}

function fixture(brain: FakeBrain = new FakeBrain()): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const clock = testNow(yield* Clock.Clock);
    const record = new FakeRecord();
    const sidebands: FakeSideband[] = [];
    const creates: LiveSessionOpened[] = [];
    const seeds: (readonly InitialItem[])[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const traces: LiveTraceRecord[] = [];
    const released: { briefing: string; decidedAt: number }[][] = [];
    const spoken: string[] = [];
    let ids = 0;
    const state = { quiet: false, sourceAvailable: true };
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.sync(() => {
          seeds.push([...input.input]);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () => Effect.succeed(sideband),
          };
          creates.push(opened);
          return opened;
        }),
      setVoice: () => undefined,
      diagnostics: () => {
        throw new Error("not read here");
      },
    };
    const entries: ConversationEntry[] = [];
    const roster: RosterSeedSession[] = [];
    const service = yield* Effect.provide(
      LiveSessionService.make({
        source: () => (state.sourceAvailable ? source : undefined),
        conversationEntries: () => entries,
        roster: () => roster,
        quietNow: () => Effect.sync(() => state.quiet),
        releaseHeldBriefings: (held) =>
          Effect.sync(() => {
            released.push([...held]);
          }),
        emit: (change) => changes.push(change),
        createId: () => `id-${++ids}`,
        report: () => undefined,
        trace: (trace) => traces.push(trace),
        onProactiveSpoken: (kind) => spoken.push(kind),
        onBriefingAppend: (delivery, eventId) => fixtureState.onBriefingAppend?.(delivery, eventId),
      }),
      Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
    );
    const fixtureState: Fixture = {
      clock,
      brain,
      record,
      sidebands,
      creates,
      seeds,
      changes,
      traces,
      released,
      spoken,
      service,
      entries,
      roster,
      get quiet() {
        return state.quiet;
      },
      set quiet(value: boolean) {
        state.quiet = value;
      },
      get sourceAvailable() {
        return state.sourceAvailable;
      },
      set sourceAvailable(value: boolean) {
        state.sourceAvailable = value;
      },
      open: () =>
        Effect.gen(function* () {
          const created = yield* service.createSession("offer");
          assert.ok(created);
          const sideband = sidebands[sidebands.length - 1];
          assert.ok(sideband);
          sideband.started(created.sessionId);
          return sideband;
        }),
    };
    return fixtureState;
  });
}

function appends(sideband: FakeSideband, type: string) {
  return sideband.sent.filter((event) => event.type === type);
}

function phases(changes: readonly VoiceLiveSessionChanged[]) {
  return changes.map((change) => change.phase);
}

it.effect(
  "a created session is seeded from the record alone, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.entries.push(
        { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
      );
      const created = yield* f.service.createSession("offer");
      assert.deepEqual(created, { sessionId: "sess-1", sdpAnswer: "answer-for-offer" });
      assert.deepEqual(
        f.seeds[0]?.map((item) => item.role),
        [SEED_ROLE.USER, SEED_ROLE.ASSISTANT],
      );
      assert.equal(f.service.sessionStands(), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED]);
      f.sidebands[0]?.started("sess-1");
      yield* settle();
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
      assert.deepEqual(
        f.traces.map((trace) => trace.decision),
        [LIVE_TRACE_DECISION.CREATED, LIVE_TRACE_DECISION.STARTED],
      );
    }),
);

it.effect(
  "an adopted session is stood without asking the source and without a seed: nothing is created, nothing is sent before the session speaks, and a delegation reaches the brain as on a created session",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
      const sideband = new FakeSideband();
      const adopted = yield* f.service.adoptSession({
        sessionId: "sess-adopted",
        attach: () => Effect.succeed(sideband),
        started: false,
      });
      assert.equal(adopted, true);
      assert.deepEqual(f.creates, []);
      assert.deepEqual(f.seeds, []);
      assert.deepEqual(sideband.sent, []);
      sideband.started("sess-adopted");
      yield* settle();
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
      assert.deepEqual(sideband.sent, []);
      sideband.input("What needs me", 1000, 1800);
      sideband.delegation("item_1", 2500);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
    }),
);

it.effect(
  "a session adopted as already started is speakable at once: it hears no session.started again, so a briefing delivered to it is appended without waiting, where one adopted as not yet started waits for the start",
  () =>
    Effect.gen(function* () {
      const running = yield* fixture();
      const runningSideband = new FakeSideband();
      assert.equal(
        yield* running.service.adoptSession({
          sessionId: "sess-running",
          attach: () => Effect.succeed(runningSideband),
          started: true,
        }),
        true,
      );
      assert.deepEqual(phases(running.changes), [
        LIVE_SESSION_PHASE.CREATED,
        LIVE_SESSION_PHASE.STARTED,
      ]);
      running.service.deliverBriefing({
        briefing: "Nukualofa finished.",
        decidedAt: running.clock.now,
      });
      yield* settle();
      assert.equal(appends(runningSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);

      const fresh = yield* fixture();
      const freshSideband = new FakeSideband();
      assert.equal(
        yield* fresh.service.adoptSession({
          sessionId: "sess-fresh",
          attach: () => Effect.succeed(freshSideband),
          started: false,
        }),
        true,
      );
      fresh.service.deliverBriefing({
        briefing: "Nukualofa finished.",
        decidedAt: fresh.clock.now,
      });
      yield* settle();
      assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      freshSideband.started("sess-fresh");
      yield* settle();
      assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect("no source means no session and nothing announced", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.sourceAvailable = false;
    assert.equal(yield* f.service.createSession("offer"), undefined);
    assert.deepEqual(f.changes, []);
  }),
);

it.effect(
  "a delegation is claimed once, composed from the transcript since the previous one, and attaches the developer's row, written as it stands",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Hi there.", 0, 900);
      sideband.input("What needs me", 1000, 1800);
      sideband.input(" right now?", 1800, 2400);
      sideband.delegation("item_1", 2500);
      sideband.delegation("item_1", 2500);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.deepEqual(f.brain.asks[0]?.submissionId, "item_1");
      // The delegation flushed both rows as they stood before the ask was composed on them, and the
      // ask's row was written once more as it stood at the attach, ahead of the attach itself.
      assert.deepEqual(spans(f.record.rows), [
        [TRANSCRIPT_SPEAKER.ASSISTANT, 0, 900],
        [TRANSCRIPT_SPEAKER.USER, 1000, 2400],
        [TRANSCRIPT_SPEAKER.USER, 1000, 2400],
      ]);
      assert.equal(f.record.rows[1]?.rowId, f.record.rows[2]?.rowId);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds: [f.record.rows[1]?.rowId] },
      ]);
      // Nothing was put off: the debounce after it writes nothing more.
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.attached.length, 1);
      assert.equal(f.record.rows.length, 3);
    }),
);

it.effect(
  "a fragment that lands on the ask's row while the brain is being asked is on the row the delegation attaches, and the row keeps growing under its own id after the handover",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.brain.answerWhen = yield* Deferred.make<void>();
      sideband.input("Open the failing", 1000, 2200);
      // The API delivers the delegation ahead of the utterance's last fragment, its offset inside the utterance.
      sideband.delegation("item_1", 2300);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.equal(f.record.attached.length, 0);
      sideband.input(" one.", 2400, 2600);
      yield* settle();
      yield* Deferred.succeed(f.brain.answerWhen, undefined);
      yield* settle();
      // The row's own write went out at the delegation, as the row then stood; the attach wrote it
      // again as the ledger held it, the late word on it, and then named it to the delegation.
      const [line] = f.record.rows;
      assert.ok(line);
      assert.deepEqual(spans(f.record.rows), [
        [TRANSCRIPT_SPEAKER.USER, 1000, 2200],
        [TRANSCRIPT_SPEAKER.USER, 1000, 2600],
      ]);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds: [line.rowId] },
      ]);
      // The late fragment's own debounce grows the row too, and a word said after the handover
      // grows it again, under the same id, with no second attach: the row is the ask's for life.
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.deepEqual(spans(f.record.rows).at(-1), [TRANSCRIPT_SPEAKER.USER, 1000, 2600]);
      sideband.input(" Please.", 2700, 3000);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.deepEqual(spans(f.record.rows).at(-1), [TRANSCRIPT_SPEAKER.USER, 1000, 3000]);
      assert.ok(f.record.rows.every((row) => row.rowId === line.rowId));
      assert.equal(f.record.attached.length, 1);
      assert.equal(f.brain.asks.length, 1);
    }),
);

it.effect(
  "a delegation attaches every developer row since the previous ask that starts by its offset, oldest first, Luke's row between them left alone, and a row begun after the offset left for the next delegation and kept out of this one's question",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      // Three developer rows, each opened past the gap from the last, with Luke's word between the first two.
      const second = 800 + UTTERANCE_GAP_MS + 200;
      const third = second + 700 + UTTERANCE_GAP_MS + 200;
      sideband.input("First thing.", 0, 800);
      sideband.output("Mm-hmm.", 900, 1300);
      sideband.input("Second thing.", second, second + 700);
      sideband.input("Third thing.", third, third + 600);
      // The offset falls after the second row and before the third.
      sideband.delegation("item_1", second + 900);
      yield* settle();
      const developerRows = [
        ...new Map(
          f.record.rows
            .filter((row) => row.speaker === TRANSCRIPT_SPEAKER.USER)
            .map((row) => [row.rowId, row.startMs] as const),
        ),
      ].sort((left, right) => left[1] - right[1]);
      assert.deepEqual(
        developerRows.map(([, startMs]) => startMs),
        [0, second, third],
      );
      const [first, next, last] = developerRows.map(([rowId]) => rowId);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds: [first, next] },
      ]);
      // The latest attached row is the ask the brain is told of, over the whole context since the previous one.
      assert.equal(f.brain.asks.length, 1);
      assert.ok(f.brain.asks[0]?.question.endsWith("Second thing."));
      assert.ok(f.brain.asks[0]?.question.includes("Assistant: Mm-hmm."));
      assert.equal(f.brain.asks[0]?.question.includes("Third thing."), false);
      // The next delegation is about the third row alone.
      sideband.delegation("item_2", third + 700);
      yield* settle();
      assert.deepEqual(attaches(f.record)[1], {
        delegationId: "item_2",
        voiceSessionId: "sess-1",
        rowIds: [last],
      });
      assert.ok(f.brain.asks[1]?.question.endsWith("Third thing."));
    }),
);

it.effect(
  "a row the delegation is about that opens while the brain is being asked, from a delta the API delivered late, is attached with the rows claimed at the delegation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.brain.answerWhen = yield* Deferred.make<void>();
      const offset = 800 + 2 * UTTERANCE_GAP_MS;
      sideband.input("First thing.", 0, 800);
      sideband.delegation("item_1", offset);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      // Spoken before the offset, past the gap from the first row, delivered while the brain is asked.
      const late = 800 + UTTERANCE_GAP_MS + 200;
      sideband.input("Second thing.", late, late + 600);
      yield* settle();
      yield* Deferred.succeed(f.brain.answerWhen, undefined);
      yield* settle();
      const rowIds = [...new Set(f.record.rows.map((row) => row.rowId))];
      assert.equal(rowIds.length, 2);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds },
      ]);
      // The next delegation finds nothing of this one's left over.
      sideband.input("Third thing.", offset + 1000, offset + 1500);
      sideband.delegation("item_2", offset + 1600);
      yield* settle();
      assert.equal(attaches(f.record)[1]?.rowIds.length, 1);
      assert.equal(attaches(f.record)[1]?.rowIds.includes(rowIds[0] ?? ""), false);
    }),
);

it.effect(
  "a row opened by a late delta that contains the first delegation's offset is the first delegation's, though a second delegation arrives while the first is still with the brain",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.brain.answerWhen = yield* Deferred.make<void>();
      const offset = 800 + 2 * UTTERANCE_GAP_MS;
      sideband.input("First thing.", 0, 800);
      sideband.delegation("item_1", offset);
      yield* settle();
      // Delivered late, past the gap from the first row, and running across the first offset.
      sideband.input("Second thing.", offset - 500, offset + 500);
      sideband.delegation("item_2", offset + 2000);
      yield* settle();
      // The second delegation found the row the first's claim had just taken and nothing else said
      // since: it is retained for the next fragment rather than composed on nothing.
      assert.equal(f.brain.asks.length, 1);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.RETAINED).length, 1);
      yield* Deferred.succeed(f.brain.answerWhen, undefined);
      yield* settle();
      const rowIds = [...new Set(f.record.rows.map((row) => row.rowId))];
      assert.equal(rowIds.length, 2);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds },
      ]);
      // The next words compose the retained delegation; begun after its offset, their row is not
      // its to attach, and is the next delegation's.
      sideband.input("Third thing.", offset + 3000, offset + 3500);
      yield* settle();
      assert.equal(f.brain.asks.length, 2);
      assert.ok(f.brain.asks[1]?.question.endsWith("Third thing."));
      assert.equal(attaches(f.record).length, 1);
    }),
);

it.effect(
  "a delegation before any developer utterance is retained and composed on the next fragment, once; a row begun after its offset is the next delegation's",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.delegation("item_early", 400);
      yield* settle();
      assert.equal(f.brain.asks.length, 0);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.RETAINED).length, 1);
      sideband.input("Open the failing one.", 500, 1400);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      // The row reached the record under the ledger's id, as it does when the delegation follows
      // the words. It began after the delegation's offset, so it is not this delegation's: the
      // brain is asked about it all the same, since the model waits on the delegation, and nothing
      // is attached; the row is the next delegation's.
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.USER, 500, 1400]]);
      assert.ok(f.brain.asks[0]?.question.endsWith("Open the failing one."));
      assert.deepEqual(attaches(f.record), []);
      sideband.input(" Please.", 1400, 1700);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.deepEqual(spans(f.record.rows).at(-1), [TRANSCRIPT_SPEAKER.USER, 500, 1700]);
      assert.equal(f.record.rows.at(-1)?.rowId, f.record.rows[0]?.rowId);
      sideband.delegation("item_next", 1800);
      yield* settle();
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_next", voiceSessionId: "sess-1", rowIds: [f.record.rows[0]?.rowId] },
      ]);
    }),
);

it.effect("a retained delegation dies with its session", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.delegation("item_orphan", 400);
    sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 12);
    yield* settle();
    const second = yield* f.open();
    yield* settle();
    second.input("Anything?", 100, 600);
    yield* settle();
    assert.equal(f.brain.asks.length, 0);
  }),
);

it.effect(
  "a slow step earns the exchange's one thinking append, and the reply streams only after the actions settled, each chunk awaiting its ack",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = false;
      sideband.input("Send the fix.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      // The accepted ask itself is told nothing of; only a slow step actually begun writes a note.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-1",
        step: "provider_write",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-1",
        step: "provider_write",
      });
      yield* settle();
      const thinking = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(thinking.length, 1);
      assert.deepEqual(
        thinking.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
        ["item_1"],
      );
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Sent.",
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "It passed.",
      });
      yield* settle();
      // The slow step's thinking append is still awaiting its ack, so nothing else has left.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      sideband.acknowledge(0, 930, 950);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(1, 1000, 1100);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 2);
      assert.deepEqual(
        commentary.map((event) => ("content" in event ? event.content : undefined)),
        ["Sent.", "It passed."],
      );
      assert.deepEqual(
        commentary.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
        ["item_1", "item_1"],
      );
    }),
);

it.effect(
  "an accepted ask is told nothing of its own acceptance: the reply's commentary is the first thing on the channel, and a refused ask is answered with its refusal",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("How is it going?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      assert.equal(sideband.sent.length, 0);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Fine.",
      });
      yield* settle();
      assert.deepEqual(
        sideband.sent.map((event) => event.type),
        [LIVE_CLIENT_EVENT.COMMENTARY_APPEND],
      );
      assert.deepEqual(
        sideband.sent.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
        ["item_1"],
      );
      sideband.acknowledge(0, 1000, 1100);
      f.brain.refuse = "not now";
      sideband.input("And now?", 2000, 2500);
      sideband.delegation("item_2", 2600);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
    }),
);

it.effect(
  "a delegation while the run is in flight steers it: one exchange, both runs, the reply under the newest id",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is failing?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      sideband.input("In the API repo, I mean.", 1500, 2300);
      sideband.delegation("item_2", 2400);
      yield* settle();
      assert.equal(f.brain.asks.length, 2);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Two tests.",
      });
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_2",
      );
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-2",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      sideband.acknowledge(0, 2500, 2600);
      yield* advanceClock(1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "a run that ends without a reply is spoken as the standing note for how it ended, and a completed one says nothing more",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Stop that.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.CANCELLED,
      });
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "content" in commentary[0] && commentary[0].content,
        RUN_END_NOTE[LIVE_BRAIN_RUN_END.CANCELLED],
      );
      sideband.acknowledge(0, 1000, 1100);
      sideband.input("Again.", 2000, 2500);
      sideband.delegation("item_2", 2600);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-2",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect("a refused submission is spoken as its refusal under the delegation", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.brain.refuse = "No brain stands.";
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("Hello?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
    assert.equal(commentary.length, 1);
    assert.equal(
      commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
      "item_1",
    );
    assert.deepEqual(
      f.record.attached.map((attach) => attach.delegationId),
      ["item_1"],
    );
  }),
);

it.effect(
  "a briefing is spoken into the standing session with no delegation, settled spoken by the first output past its end, and un-settled by a moderation cut",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.deliverBriefing({ briefing: "Nukualofa finished.", decidedAt: f.clock.now });
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        null,
      );
      sideband.acknowledge(0, 5000, 5200);
      yield* settle();
      sideband.output("Nuku", 5100, 5150);
      yield* settle();
      assert.deepEqual(f.spoken, []);
      sideband.output("alofa is done.", 5150, 5400);
      yield* settle();
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.BRIEFING]);
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err",
        error: { code: "moderation" },
      });
      yield* settle();
      assert.deepEqual(
        f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.UNSETTLED).length,
        1,
      );
    }),
);

it.effect("an error naming an append refuses that append and never counts as success", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    f.service.deliverBriefing({ briefing: "One.", decidedAt: f.clock.now });
    f.service.deliverBriefing({ briefing: "Two.", decidedAt: f.clock.now });
    yield* settle();
    const first = sideband.sent[0];
    assert.ok(first);
    sideband.receive({
      type: LIVE_SERVER_EVENT.ERROR,
      event_id: "err",
      error: { code: null, client_event_id: first.event_id },
    });
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
    assert.equal(
      f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length,
      1,
    );
    sideband.output("One", 100, 200);
    assert.deepEqual(f.spoken, []);
  }),
);

it.effect(
  "the launch greeting is an instructions append acknowledged before the one commentary cue, settled spoken by output past the cue",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.LAUNCH,
        firstName: "Ada",
        decidedAt: f.clock.now,
      });
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      const sideband = yield* f.open();
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      const instruction = sideband.sent[0];
      assert.equal(
        instruction && "delegation_id" in instruction && instruction.delegation_id,
        null,
      );
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      const cues = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(cues.length, 1);
      assert.equal(cues[0] && "delegation_id" in cues[0] && cues[0].delegation_id, null);
      sideband.acknowledge(1, 300, 400);
      yield* settle();
      sideband.output("Hey Ada", 350, 380);
      yield* settle();
      assert.deepEqual(f.spoken, []);
      sideband.output(", I'm here.", 380, 900);
      yield* settle();
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.LAUNCH]);
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
    }),
);

it.effect(
  "a launch greeting whose instruction is refused sends no cue and stands released for another ask",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      const instruction = sideband.sent[0];
      assert.ok(instruction);
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err",
        error: { code: null, client_event_id: instruction.event_id },
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      assert.deepEqual(f.spoken, []);
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 2);
    }),
);

it.effect(
  "a launch greeting waiting beside briefings is spoken ahead of them, whichever was asked for first",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.service.deliverBriefing({
        briefing: "The scroll fix is on the PR.",
        decidedAt: f.clock.now,
      });
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      const sideband = yield* f.open();
      yield* settle();
      assert.deepEqual(
        sideband.sent.map((event) => event.type),
        [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND],
      );
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      // The cue follows the instruction, and the briefing waits behind the cue.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(1, 300, 400);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 2);
      assert.equal(
        commentary[1] && "content" in commentary[1] && commentary[1].content,
        "The scroll fix is on the PR.",
      );
      sideband.acknowledge(2, 500, 600);
      sideband.output("Hey, I'm here.", 450, 900);
      yield* settle();
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.LAUNCH, PROACTIVE_SPEECH_KIND.BRIEFING]);
    }),
);

it.effect(
  "a launch greeting reaching a session already asked to speak is settled without a word, so the briefing under way is not cut off",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.deliverBriefing({
        briefing: "The scroll fix is on the PR.",
        decidedAt: f.clock.now,
      });
      yield* settle();
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.LAUNCH]);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.SUPERSEDED).length, 1);
      sideband.output("The scroll fix is on the PR.", 250, 2200);
      yield* settle();
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.LAUNCH, PROACTIVE_SPEECH_KIND.BRIEFING]);
      // Settled is spent: the run asks for no second greeting.
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
    }),
);

it.effect(
  "a launch greeting reaching a session the developer has already spoken into is settled without a word",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What needs me?", 0, 800);
      yield* settle();
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.LAUNCH, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.LAUNCH]);
    }),
);

it.effect(
  "a proactive turn with no session asks for one, muted, and speaks once it starts; a stale one is dropped instead",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.service.deliverBriefing({ briefing: "News.", decidedAt: f.clock.now });
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      const sideband = yield* f.open();
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
      yield* advanceClock(3 * 60_000);
      f.service.deliverBriefing({ briefing: "Old news.", decidedAt: f.clock.now - 3 * 60_000 });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.DROPPED).length, 1);
    }),
);

it.effect(
  "quiet holds briefings and beats; its end hands briefings back for re-decision and speaks the beats afresh",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.quiet = true;
      f.service.reconcile();
      yield* settle();
      const delivery = { briefing: "Held news.", decidedAt: f.clock.now };
      f.service.deliverBriefing(delivery);
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(sideband.sent.length, 0);
      yield* advanceClock(60_000);
      f.quiet = false;
      f.service.reconcile();
      yield* settle();
      yield* settle();
      assert.deepEqual(f.released, [[delivery]]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "a beat is spoken at most once to the end per run, and dropping briefings leaves beats standing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.deliverBriefing({ briefing: "Drop me.", decidedAt: f.clock.now });
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      f.quiet = true;
      f.service.reconcile();
      yield* settle();
      f.service.deliverBriefing({ briefing: "Drop me too.", decidedAt: f.clock.now });
      f.service.dropBriefings();
      f.quiet = false;
      f.service.reconcile();
      yield* settle();
      yield* settle();
      assert.deepEqual(f.released, []);
      // The first briefing had already left before the hold; only the beat follows it.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
      sideband.acknowledge(1, 300, 400);
      sideband.output("Connect your calendar.", 500, 900);
      yield* settle();
      assert.deepEqual(f.spoken, [
        PROACTIVE_SPEECH_KIND.BRIEFING,
        PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
      ]);
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
    }),
);

it.effect(
  "idle reported by the peer closes the session only once the host too has appended nothing in the window, and records the usage",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.deliverBriefing({ briefing: "Fresh.", decidedAt: f.clock.now });
      yield* settle();
      sideband.acknowledge(0, 100, 200);
      yield* advanceClock(60_000);
      f.service.reportActivity(true);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
      f.service.reportActivity(false);
      yield* advanceClock(LIVE_IDLE_WINDOW_MS);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
      f.service.reportActivity(true);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSING);
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u1",
        usage: { seconds: 300 },
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u2",
        usage: { seconds: 305 },
      });
      yield* settle();
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 310);
      yield* settle();
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
      assert.equal(sideband.closed, true);
      assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CLOSE_REQUESTED);
    }),
);

it.effect("an idle report while an exchange is in flight does not close the session", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("Read the transcript.", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    yield* advanceClock(LIVE_IDLE_WINDOW_MS);
    f.service.reportActivity(true);
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
  }),
);

it.effect(
  "a graceful close that hears nothing gives up at the timeout with the usage unconfirmed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u1",
        usage: { seconds: 40 },
      });
      const ending = yield* Effect.forkChild(f.service.endSession());
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
      // The close waits exactly the timeout out: a tick short of it, nothing has given up yet.
      yield* advanceClock(SIDEBAND_CLOSE_TIMEOUT_MS - 1);
      assert.equal(ending.pollUnsafe(), undefined);
      yield* advanceClock(1);
      yield* Fiber.join(ending);
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
      assert.equal(sideband.closed, true);
    }),
);

it.effect("an expired session reopens at once", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.closedBy(LIVE_CLOSE_REASON.EXPIRED, 3600);
    yield* settle();
    assert.deepEqual(phases(f.changes).slice(-2), [
      LIVE_SESSION_PHASE.CLOSED,
      LIVE_SESSION_PHASE.WANTED,
    ]);
  }),
);

it.effect(
  "a lost connection leaves the usage unconfirmed, drops the delivery aimed at the dead session, and reopens only if the microphone was live",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u1",
        usage: { seconds: 20 },
      });
      f.service.deliverBriefing({ briefing: "Pending.", decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.dropConnection();
      yield* settle();
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
      assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CONNECTION_LOST);
      assert.equal(
        f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length,
        1,
      );
      const second = yield* f.open();
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      second.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "um" });
      second.dropConnection();
      yield* settle();
      assert.deepEqual(phases(f.changes).slice(-2), [
        LIVE_SESSION_PHASE.CLOSED,
        LIVE_SESSION_PHASE.WANTED,
      ]);
    }),
);

it.effect(
  "a failed peer transport is a lost connection; a peer closed without a hang-up asked here closes gracefully",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.reportTransport(LIVE_TRANSPORT_STATE.FAILED);
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      const second = yield* f.open();
      yield* settle();
      f.service.reportTransport(LIVE_TRANSPORT_STATE.CLOSED);
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.CLOSE).length, 1);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
    }),
);

it.effect(
  "a reply that finishes after its session closed opens a new one and is spoken there with no delegation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Summarize the day.", 0, 900);
      sideband.delegation("item_1", 1000);
      yield* settle();
      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 30);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Two sessions finished.",
      });
      yield* settle();
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.WANTED);
      const second = yield* f.open();
      yield* settle();
      const commentary = appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        null,
      );
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
    }),
);

it.effect(
  "a row reaches the record within the debounce of its first fragment, grows with each later one under the same id, and is written by nothing while the speaker is silent",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Two ", 0, 400);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS - 1);
      assert.equal(f.record.rows.length, 0);
      yield* advanceClock(1);
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.ASSISTANT, 0, 400]]);
      const [first] = f.record.rows;
      assert.ok(first);
      // Two fragments inside one debounce are one write, over the span they grew the row to.
      sideband.output("sessions", 400, 900);
      sideband.output(" finished.", 900, 1400);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.deepEqual(
        f.record.rows.map((row) => [row.rowId, row.startMs, row.endMs]),
        [
          [first.rowId, 0, 400],
          [first.rowId, 0, 1400],
        ],
      );
      // Silence arms nothing: no event is read into the gap, and the row owes the record nothing.
      yield* advanceClock(10 * ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.rows.length, 2);
      // The next utterance opens under an id of its own.
      sideband.output("Anything else?", 9000, 9800);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.rows.length, 3);
      assert.notEqual(f.record.rows[2]?.rowId, first.rowId);
    }),
);

it.effect(
  "a muted microphone never carries the stop instruction, whether Luke is silent or mid-sentence",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-0" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      // The developer's turn ends with Luke silent.
      sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "unmuted-1" });
      sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-1" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      // The talk key released while Luke is still answering: the release is a mute and nothing more.
      sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "unmuted-2" });
      sideband.output("Two sessions", 0, 800);
      sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-2" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      assert.equal(sideband.sent.length, 0);
    }),
);

it.effect(
  "the stop key sends exactly one instruction with no delegation into the standing session, and nothing when none stands",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      assert.equal(f.service.stopSpeaking(), false);
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Two sessions", 0, 800);
      assert.equal(f.service.stopSpeaking(), true);
      yield* settle();
      const instructions = appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
      assert.equal(instructions.length, 1);
      const [instruction] = instructions;
      assert.ok(instruction && "delegation_id" in instruction && "content" in instruction);
      assert.equal(instruction.delegation_id, null);
      assert.equal(instruction.content, STOP_SPEAKING_INSTRUCTION);
      const ending = yield* Effect.forkChild(f.service.endSession());
      yield* settle();
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
      yield* Fiber.join(ending);
      assert.equal(f.service.stopSpeaking(), false);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
    }),
);

it.effect(
  "both speakers' rows reach the record behind the debounce, each grouped by the ledger under an id of its own, and a socket closing mid-sentence leaves the words said so far on the row",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Hello", 0, 400);
      sideband.output("Hi.", 500, 900);
      sideband.input(" there", 400, 800);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS - 1);
      assert.equal(f.record.rows.length, 0);
      yield* advanceClock(1);
      const first = [...f.record.rows].sort((left, right) => left.startMs - right.startMs);
      assert.deepEqual(spans(first), [
        [TRANSCRIPT_SPEAKER.USER, 0, 800],
        [TRANSCRIPT_SPEAKER.ASSISTANT, 500, 900],
      ]);
      assert.notEqual(first[0]?.rowId, first[1]?.rowId);
      assert.equal(f.record.attached.length, 0);
      // The close does not wait out the debounce: the write put off is made at the release.
      sideband.input("Bye", 5000, 5300);
      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 6);
      yield* settle();
      assert.deepEqual(spans(f.record.rows.slice(2)), [[TRANSCRIPT_SPEAKER.USER, 5000, 5300]]);
      // Nothing armed outlives the session.
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.rows.length, 3);
    }),
);

it.effect(
  "an utterance whose row is on record before its delegation is attached to it under its own id, and nothing is spoken while the attach is out",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Open the failing one.", 1000, 2200);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      const [line] = f.record.rows;
      assert.ok(line);
      assert.equal(f.record.attached.length, 0);
      f.record.hold();
      sideband.delegation("item_late", 5000);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Opening it.",
      });
      yield* settle();
      // Nothing is spoken while the delegated write is out: the ask is on record under its delegation first.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_late", voiceSessionId: "sess-1", rowIds: [line.rowId] },
      ]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      // The attach wrote the row once more as it stood; nothing put off remains to write.
      assert.ok(f.record.rows.every((row) => row.rowId === line.rowId));
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.attached.length, 1);
      assert.equal(f.record.rows.length, 2);
    }),
);

it.effect(
  "a briefing's last append is told to the record before it is sent, once, under the event id the append carries; a beat tells nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const told: { briefing: string; eventId: string }[] = [];
      f.onBriefingAppend = (delivery, eventId) =>
        told.push({ briefing: delivery.briefing, eventId });
      const sideband = yield* f.open();
      yield* settle();
      const long = Array.from(
        { length: 40 },
        (_, index) => `Sentence ${index} is long enough.`,
      ).join(" ");
      f.service.deliverBriefing({ briefing: long, decidedAt: f.clock.now });
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.ok(commentary.length >= 1);
      assert.equal(told.length, 1);
      assert.equal(told[0]?.briefing, long);
      // The id told is the one on the last chunk of the briefing, which is the append whose speech settles it.
      const briefingAppends = commentary.slice(0, commentary.length);
      const lastBriefingChunk = briefingAppends.find(
        (event) => event.event_id === told[0]?.eventId,
      );
      assert.ok(lastBriefingChunk);
    }),
);

it.effect("creating a session while one stands closes the standing one first", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    yield* settle();
    const creating = yield* Effect.forkChild(f.service.createSession("offer-2"));
    yield* settle();
    assert.equal(appends(first, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
    const created = yield* Fiber.join(creating);
    assert.equal(created?.sessionId, "sess-2");
    assert.equal(f.creates.length, 2);
  }),
);

it.effect("stop closes the session gracefully and takes nothing else with it", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    const stopping = yield* Effect.forkChild(f.service.stop());
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 2);
    yield* Fiber.join(stopping);
    assert.equal(f.service.sessionStands(), false);
  }),
);

it.effect(
  "a close the session's own reader reads releases the scope that session stood in, finalizing what its attach left standing there",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = new FakeSideband();
      const finalized: string[] = [];
      assert.equal(
        yield* f.service.adoptSession({
          sessionId: "sess-adopted",
          attach: () =>
            Effect.as(
              Effect.addFinalizer(() => Effect.sync(() => finalized.push("attached"))),
              sideband,
            ),
          started: true,
        }),
        true,
      );
      yield* settle();
      assert.deepEqual(finalized, []);
      assert.equal(sideband.closed, false);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 7);
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
      assert.deepEqual(finalized, ["attached"]);
    }),
);

it.effect(
  "a stop that lands between a tear-down's decision and its release waits for that release rather than answering with the session's last words still out",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Ship it.", 0, 800);
      yield* settle();
      f.record.hold({ rows: true });
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 5);
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
      const stopping = yield* Effect.forkChild(f.service.stop());
      yield* settle();
      assert.equal(stopping.pollUnsafe(), undefined);
      f.record.release(true);
      yield* Fiber.join(stopping);
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.USER, 0, 800]]);
    }),
);

it.effect(
  "an end asked for while the reader's own tear-down is still releasing waits on that one release and begins no second close",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Ship it.", 0, 800);
      yield* settle();
      f.record.hold({ rows: true });
      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 3);
      yield* settle();
      const ending = yield* Effect.forkChild(f.service.endSession());
      yield* settle();
      assert.equal(ending.pollUnsafe(), undefined);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
      f.record.release(true);
      yield* Fiber.join(ending);
      assert.equal(brain.drops, 1);
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.USER, 0, 800]]);
    }),
);

it.effect(
  "a run's reply is appended once per sentence, in order, and nothing of the run is appended after its end",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      const sentences = ["One.", "Two.", "Three."];
      for (const sentence of sentences) {
        f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence });
      }
      for (let index = 0; index < sentences.length; index += 1) {
        yield* settle();
        sideband.acknowledge(index, 1000 + index * 100, 1050 + index * 100);
      }
      yield* settle();
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).map((event) =>
          "content" in event ? event.content : undefined,
        ),
        sentences,
      );
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Late.",
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, sentences.length);
    }),
);

it.effect(
  "a briefing taken from the queue is appended once: a hold beginning and ending around it re-sends nothing, and a held one is handed back once and appended never",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.deliverBriefing({ briefing: "Already said.", decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      f.quiet = true;
      f.service.reconcile();
      yield* settle();
      f.quiet = false;
      f.service.reconcile();
      yield* settle();
      yield* settle();
      assert.deepEqual(f.released, []);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      f.quiet = true;
      f.service.reconcile();
      yield* settle();
      const held = { briefing: "Held.", decidedAt: f.clock.now };
      f.service.deliverBriefing(held);
      f.quiet = false;
      f.service.reconcile();
      yield* settle();
      f.service.reconcile();
      yield* settle();
      yield* settle();
      assert.deepEqual(f.released, [[held]]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "an append pending when the session dies is dropped with it and never re-sent into the session opened after",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: f.clock.now });
      sideband.input("Summarize.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Done.",
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.dropConnection();
      yield* settle();
      assert.equal(
        f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length,
        1,
      );
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
      const second = yield* f.open();
      yield* settle();
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      assert.deepEqual(f.spoken, []);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
    }),
);

it.effect(
  "run events landing while the ask's record write is out are deferred, then spoken in order once the record holds the ask",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.record.hold();
      sideband.input("Ship it.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Shipped.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Green.",
      });
      yield* settle();
      assert.equal(f.record.attached.length, 0);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      assert.equal(f.record.attached.length, 1);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => ("content" in event ? event.content : undefined)),
        ["Shipped."],
      );
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_1",
      );
      sideband.acknowledge(0, 1000, 1100);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
    }),
);

it.effect(
  "a run that ends during the ask's record write is finalized once the write lands, its end spoken as the standing note",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.record.hold();
      sideband.input("Do the thing.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "content" in commentary[0] && commentary[0].content,
        RUN_END_NOTE[LIVE_BRAIN_RUN_END.FAILED],
      );
    }),
);

it.effect(
  "an ask whose record write lands nothing is answered all the same: no note is spoken, and the run's deferred events are replayed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.record.hold();
      sideband.input("Send it.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Sent.",
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(false);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => ("content" in event ? event.content : undefined)),
        ["Sent."],
      );
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_1",
      );
      assert.equal(f.record.attached.length, 0);
    }),
);

it.effect(
  "a follow-up delegated seconds after an ask, its words on the first ask's row, attaches nothing of its own and is spoken to as the sibling it is: no note, the exchange's reply said once",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.record.hold();
      sideband.input("Can we add captions?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      // Within the gap of the first words: the ledger grows the first ask's row rather than opening
      // one, and the follow-up's offset falls inside the grown row.
      sideband.input(" Is that possible?", 3000, 4200);
      sideband.delegation("item_2", 3900);
      yield* settle();
      assert.equal(f.brain.asks.length, 2);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "Yes, the live route can carry captions.",
      });
      yield* settle();
      // Nothing is spoken while the first ask's attach is out; the follow-up has no row of its own.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => ("content" in event ? event.content : undefined)),
        ["Yes, the live route can carry captions."],
      );
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_2",
      );
      // One attach, the first ask's; the follow-up's words grew that row, which stays the first ask's.
      assert.deepEqual(
        f.record.attached.map((attach) => [attach.delegationId, attach.rows.length]),
        [["item_1", 1]],
      );
      assert.ok(f.record.rows.some((row) => row.startMs === 0 && row.endMs === 4200));
      assert.ok(f.record.rows.every((row) => row.rowId === f.record.attached[0]?.rows[0]?.rowId));
      // The follow-up moved the session past the row it read: a delegation with nothing said since
      // is retained rather than composed on that row a third time.
      sideband.delegation("item_3", 5000);
      yield* settle();
      assert.equal(f.brain.asks.length, 2);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.RETAINED).length, 1);
    }),
);

const ROSTER_DEBOUNCE_MS = 2_000;

function rosterSession(id: string, overrides: Partial<RosterSeedSession> = {}): RosterSeedSession {
  return {
    identity: { providerId: "conductor", providerSessionId: id },
    title: `session ${id}`,
    provider: { displayName: "Conductor" },
    status: SESSION_STATUS.WORKING,
    lastActivityAt: 0,
    ...overrides,
  };
}

it.effect(
  "a created session opens knowing the desk: the roster leads the input as one developer message, ahead of the conversation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.roster.push(rosterSession("a"));
      f.entries.push(
        { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
      );
      yield* f.service.createSession("offer");
      assert.deepEqual(
        f.seeds[0]?.map((item) => item.role),
        [SEED_ROLE.DEVELOPER, SEED_ROLE.USER, SEED_ROLE.ASSISTANT],
      );
      assert.equal(f.seeds[0]?.[0]?.content[0]?.text, rosterSeed(f.roster, f.clock.now)?.text);
    }),
);

it.effect("an empty desk puts no roster message into the input at all", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
    yield* f.service.createSession("offer");
    assert.deepEqual(
      f.seeds[0]?.map((item) => item.role),
      [SEED_ROLE.USER],
    );
  }),
);

it.effect(
  "the roster message is counted against the input's own bounds, and the conversation is what fills what is left",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      for (let index = 0; index < 10; index += 1) {
        f.roster.push(rosterSession(`s${index}`, { title: "x".repeat(500) }));
      }
      for (let index = 0; index < 200; index += 1) {
        f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "y".repeat(400) });
      }
      yield* f.service.createSession("offer");
      const seed = f.seeds[0];
      assert.ok(seed);
      assert.equal(seed[0]?.role, SEED_ROLE.DEVELOPER);
      assert.equal(seed[0]?.content[0]?.text, rosterSeed(f.roster, f.clock.now)?.text);
      assert.ok(seed.length <= LIVE_INPUT_BOUNDS.MESSAGES);
      assert.ok(seedItemTokens(seed) <= LIVE_INPUT_BOUNDS.TOKENS);
    }),
);

it.effect(
  "a moved desk reaches the standing session as one thinking append with no delegation, once the change has settled",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.service.updateRoster([rosterSession("a")]);
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(sent.length, 1);
      const only = sent[0];
      assert.ok(only && "delegation_id" in only);
      assert.equal(only.delegation_id, null);
    }),
);

it.effect("a roster that comes back reading the same appends nothing", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.roster.push(rosterSession("a"));
    const sideband = yield* f.open();
    yield* settle();
    f.service.updateRoster([rosterSession("a")]);
    yield* advanceClock(ROSTER_DEBOUNCE_MS);
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  }),
);

it.effect(
  "a desk that moves between a session's creation and its start is told at the start, not dropped",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.roster.push(rosterSession("a"));
      const created = yield* f.service.createSession("offer");
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      sideband.started(created.sessionId);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
    }),
);

it.effect(
  "a change the seed's own read has already superseded is discarded, never told back as news",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.service.updateRoster([rosterSession("a")]);
      f.roster.push(rosterSession("a"), rosterSession("b"));
      const sideband = yield* f.open();
      yield* settle();
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
    }),
);

it.effect(
  "a desk that empties withdraws what the session was told rather than leaving it standing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.roster.push(rosterSession("a"));
      const sideband = yield* f.open();
      yield* settle();
      f.service.updateRoster([]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(sent.length, 1);
      const only = sent[0];
      assert.ok(only && "content" in only);
      assert.equal(
        only.content,
        rosterUpdate(rosterSeed(f.roster, f.clock.now)?.told, [], f.clock.now)?.text,
      );
    }),
);

it.effect(
  "a refresh the session refused is not recorded as told, so the withdrawal it carried is sent again",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.roster.push(rosterSession("a"));
      const sideband = yield* f.open();
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = false;
      f.service.updateRoster([]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      const refused = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(refused.length, 1);
      // The append is never acknowledged, so the channel counts it as not taken.
      yield* advanceClock(10_000);
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = true;
      f.service.updateRoster([]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(sent.length, 2);
      const first = sent[0];
      const second = sent[1];
      assert.ok(first && "content" in first && second && "content" in second);
      assert.equal(second.content, first.content);
    }),
);

it.effect(
  "a change that lands while a refresh is still in flight is decided against what the session will know by then",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.roster.push(rosterSession("a"));
      const sideband = yield* f.open();
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = false;
      // The first refresh puts b on the desk and is left unacknowledged, so it is
      // still in flight when the second takes b away again.
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
      f.service.updateRoster([rosterSession("a")]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      sideband.acknowledge(0, 0, 0);
      yield* settle();
      const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(sent.length, 2);
      const withdrawal = sent[1];
      assert.ok(withdrawal && "content" in withdrawal);
      assert.equal(
        withdrawal.content,
        rosterUpdate(
          rosterSeed([rosterSession("a"), rosterSession("b")], f.clock.now)?.told,
          [rosterSession("a")],
          f.clock.now,
        )?.text,
      );
    }),
);

it.effect("a desk that moves while no session stands opens none and sends nothing", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.service.updateRoster([rosterSession("a")]);
    yield* advanceClock(ROSTER_DEBOUNCE_MS);
    yield* settle();
    assert.deepEqual(f.creates, []);
    assert.equal(f.service.sessionStands(), false);
  }),
);

it.effect(
  "a roster append does not keep a quiet session open: the idle clock reads the appends the session is worth staying open for",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      yield* advanceClock(LIVE_IDLE_WINDOW_MS);
      f.service.updateRoster([rosterSession("a")]);
      yield* advanceClock(ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
      f.service.reportActivity(true);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    }),
);

it.effect(
  "the developer's fragments arm one debounce; when it fires the words so far reach the brain once, and more words arm it again",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is", 1000, 1300);
      sideband.input(" abc", 1300, 1500);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS - 1);
      assert.equal(brain.anticipations.length, 0);
      yield* advanceClock(1);
      const [first] = brain.anticipations;
      assert.ok(first);
      assert.deepEqual(brain.anticipations, [
        { rowId: first.rowId, partialAsk: "What is abc", recentTurns: "Developer: What is abc" },
      ]);
      // The same words again plan nothing new; more words plan again under the same row.
      yield* advanceClock(PREFETCH_DEBOUNCE_MS * 3);
      assert.equal(brain.anticipations.length, 1);
      sideband.input(" doing", 1500, 1900);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 2);
      assert.equal(brain.anticipations[1]?.rowId, first.rowId);
      assert.equal(brain.anticipations[1]?.partialAsk, "What is abc doing");
      assert.deepEqual(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.ANTICIPATED).length,
        2,
      );
    }),
);

it.effect(
  "a delegation cancels the pending debounce, Luke's own fragments arm none, and a brain that reads nothing ahead is handed nothing",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Nukualofa finished.", 0, 900);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 0);
      sideband.input("What needs me", 1000, 1800);
      sideband.delegation("item_1", 1900);
      yield* settle();
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 0);
      assert.equal(f.brain.asks.length, 1);

      const plain = yield* fixture();
      const plainSideband = yield* plain.open();
      yield* settle();
      plainSideband.input("What needs me", 1000, 1800);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(
        plain.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.ANTICIPATED).length,
        0,
      );
    }),
);

it.effect(
  "facts read ahead are appended once, as thinking under no delegation and behind the data prefix, and leave the idle clock where it was",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      yield* advanceClock(LIVE_IDLE_WINDOW_MS);
      sideband.input("What is abc doing", 1000, 1800);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      brain.facts({ rowId: anticipatedRow(brain), text: "abc finished the tests." });
      brain.facts({ rowId: anticipatedRow(brain), text: "abc finished the tests, again." });
      yield* settle();
      const thinking = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(thinking.length, 1);
      const [append] = thinking;
      assert.ok(append && append.type === LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(append.delegation_id, null);
      // The one append is the first chunk of the prefixed facts, cut by the same rule every append is.
      assert.equal(
        append.content,
        chunkForAppend(`${ANTICIPATION_FACTS_PREFIX}abc finished the tests.`)[0],
      );
      assert.deepEqual(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_APPENDED).length,
        1,
      );
      assert.deepEqual(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_DROPPED).length,
        1,
      );
      f.service.reportActivity(true);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    }),
);

it.effect(
  "facts for words since superseded, for a row never anticipated, or with no started session are dropped, never appended",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is", 1000, 1300);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      sideband.input(" abc doing", 1300, 1800);
      yield* settle();
      brain.facts({ rowId: anticipatedRow(brain), text: "stale" });
      brain.facts({ rowId: "row-never-opened", text: "unknown row" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      assert.equal(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_DROPPED).length,
        2,
      );
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
      brain.facts({ rowId: anticipatedRow(brain), text: "too late" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
    }),
);

it.effect(
  "once a row is the spoken ask, a late fragment on it anticipates nothing more and a summary read ahead for it is dropped rather than appended into the exchange",
  () =>
    Effect.gen(function* () {
      const brain = new AnticipatingBrain();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is abc", 1000, 1500);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 1);
      sideband.delegation("item_1", 1600);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      // A fragment still inside the gap joins the same row, which is already the ask.
      sideband.input(" doing", 1500, 1900);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 1);
      brain.facts({ rowId: anticipatedRow(brain), text: "abc finished the tests." });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      assert.equal(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_DROPPED).length,
        1,
      );
      // The developer's next utterance, after a pause well past the gap, is a new row and is anticipated as usual.
      sideband.input("And def?", 7000, 7400);
      yield* advanceClock(PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 2);
      assert.notEqual(brain.anticipations[1]?.rowId, anticipatedRow(brain));
    }),
);

it.effect("a session's end and the drain each drop what the brain read ahead", () =>
  Effect.gen(function* () {
    const brain = new AnticipatingBrain();
    const f = yield* fixture(brain);
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("What is abc doing", 1000, 1800);
    sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
    yield* settle();
    assert.equal(brain.drops, 1);
    assert.equal(brain.anticipations.length, 0);
    yield* advanceClock(PREFETCH_DEBOUNCE_MS);
    assert.equal(brain.anticipations.length, 0);
    yield* f.service.stop();
    assert.equal(brain.drops, 2);
  }),
);
