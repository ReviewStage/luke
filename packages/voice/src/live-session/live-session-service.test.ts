import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_TRANSPORT_STATE } from "@sidecar/gateway";
import type { CodeRef } from "@sidecar/hosted/plan-wire";
import { VOICE_PHASE } from "@sidecar/hosted/planning-view";
import {
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_IDLE_WINDOW_MS,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEventType,
  parseLiveServerEvent,
  TRANSCRIPT_SPEAKER,
  UTTERANCE_GAP_MS,
} from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { Deferred, Duration, Effect, Fiber, Layer, type Scope, type Stream } from "effect";
import { TestClock } from "effect/testing";
import { liveBrainLayer } from "../effect/live-brain.js";
import { liveRecordLayer } from "../effect/live-record.js";
import { holdSocket, type SocketHold } from "../held-socket.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainCancel,
  type LiveBrainRecoveredRun,
  type LiveBrainRecovery,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "./live-brain.js";
import type { LiveRecord, SpokenAskAttach, SpokenRowUpsert } from "./live-record.js";
import {
  LiveSessionService,
  type LiveSessionStatus,
  PROGRESS_NOTE_BOUNDS,
  ROW_WRITE_DEBOUNCE_MS,
  RUN_END_NOTE,
  STOP_SPEAKING_INSTRUCTION,
  STOPPED_RUN_NOTE,
} from "./live-session-service.js";

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
    ping: () => undefined,
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

/** A recovery as the fake answers it: the session's newest revision, the runs taken up, and what their follow tells at once. */
interface ScriptedRecovery {
  readonly revision: number;
  readonly runs: readonly LiveBrainRecoveredRun[];
  readonly told: readonly LiveBrainRunEvent[];
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  refuse: string | undefined;
  /** While set, each ask is taken at once and answered only when this settles, as a brain across the network answers. */
  answerWhen: Deferred.Deferred<void> | undefined;
  /** Every run the service asked to cancel, in order. */
  readonly cancels: string[] = [];
  /** What the backend says of a cancel, answered only once `cancelWhen` settles where it is set. */
  cancel: LiveBrainCancel = LIVE_BRAIN_CANCEL.CANCELLED;
  cancelWhen: Deferred.Deferred<void> | undefined;
  /** What a re-attached session takes up, and the events its follow tells the moment it runs; none by default. */
  recovery: ScriptedRecovery = {
    revision: 0,
    runs: [],
    told: [],
  };
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

  cancelRun(runId: string): Effect.Effect<LiveBrainCancel> {
    return Effect.gen({ self: this }, function* () {
      this.cancels.push(runId);
      if (this.cancelWhen !== undefined) yield* Deferred.await(this.cancelWhen);
      return this.cancel;
    });
  }

  recoverRuns(): Effect.Effect<LiveBrainRecovery> {
    return Effect.sync(() => {
      const { revision, runs, told } = this.recovery;
      return {
        revision,
        runs,
        follow: Effect.sync(() => {
          for (const event of told) this.fire(event);
        }),
      };
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
  brain: FakeBrain;
  record: FakeRecord;
  /** Every sideband adopted so far, in order; the session adopted over the nth is `sess-n`. */
  sidebands: FakeSideband[];
  /** Every line the service reported, in order. */
  reports: string[];
  /** Every status `onStatus` was told, in order. */
  statuses: LiveSessionStatus[];
  /** Every place `onCode` put on screen, in order. */
  codes: CodeRef[];
  service: LiveSessionService;
  /** Adopts a fresh session over a new sideband, as the route hands one in, and starts it. */
  open: () => Effect.Effect<FakeSideband>;
}

function fixture(brain: FakeBrain = new FakeBrain()): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const record = new FakeRecord();
    const sidebands: FakeSideband[] = [];
    const reports: string[] = [];
    const statuses: LiveSessionStatus[] = [];
    const codes: CodeRef[] = [];
    let ids = 0;
    const service = yield* Effect.provide(
      LiveSessionService.make({
        createId: () => `id-${++ids}`,
        report: (message) => reports.push(message),
        onStatus: (status) => statuses.push(status),
        onCode: (ref) => codes.push(ref),
      }),
      Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
    );
    return {
      brain,
      record,
      sidebands,
      reports,
      statuses,
      codes,
      service,
      open: () =>
        Effect.gen(function* () {
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const sessionId = `sess-${sidebands.length}`;
          const adopted = yield* service.adoptSession({
            sessionId,
            attach: () => Effect.succeed(sideband),
            started: false,
          });
          assert.ok(adopted);
          sideband.started(sessionId);
          return sideband;
        }),
    };
  });
}

function appends(sideband: FakeSideband, type: string) {
  return sideband.sent.filter((event) => event.type === type);
}

it.effect(
  "an adopted session is stood without a seed: nothing is sent before the session speaks, and a delegation reaches the brain",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = new FakeSideband();
      const adopted = yield* f.service.adoptSession({
        sessionId: "sess-adopted",
        attach: () => Effect.succeed(sideband),
        started: false,
      });
      assert.equal(adopted, true);
      assert.deepEqual(sideband.sent, []);
      sideband.started("sess-adopted");
      yield* settle();
      assert.deepEqual(sideband.sent, []);
      sideband.input("What needs me", 1000, 1800);
      sideband.delegation("item_1", 2500);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
    }),
);

it.effect(
  "a session adopted as already started is speakable at once: it hears no session.started again, so the stop key reaches it without waiting, where one adopted as not yet started waits for the start",
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
      assert.equal(running.service.stopSpeaking(), true);
      yield* settle();
      assert.equal(appends(runningSideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);

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
      assert.equal(fresh.service.stopSpeaking(), false);
      yield* settle();
      assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
      freshSideband.started("sess-fresh");
      yield* settle();
      assert.equal(fresh.service.stopSpeaking(), true);
      yield* settle();
      assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
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

it.effect("a repository read's thinking append says the repository is being read", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("How do invites work today?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "repository_read" });
    yield* settle();
    const thinking = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
    assert.deepEqual(
      thinking.map((event) => ("content" in event ? event.content : undefined)),
      ["Luke is reading the repository; this takes a moment."],
    );
  }),
);

it.effect(
  "every question the planning model queued is handed to the voice as its own commentary under the delegation, in order, without waiting on the settle",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Invites should expire.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      for (const { question, recommendation } of [
        { question: "After how long?", recommendation: "Seven days." },
        { question: "Can an admin re-send one?", recommendation: "Yes." },
      ]) {
        f.brain.fire({
          kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
          runId: "run-1",
          question,
          recommendation,
        });
      }
      yield* settle();
      // Each commentary append waits on the last one's acknowledgment, as every append does.
      sideband.acknowledge(
        sideband.sent.findIndex((event) => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND),
        1000,
        1100,
      );
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
        ["item_1", "item_1"],
      );
      const contents = commentary.map((event) => ("content" in event ? event.content : ""));
      assert.ok(contents[0]?.includes("After how long?") && contents[0].includes("Seven days."));
      assert.ok(contents[1]?.includes("Can an admin re-send one?"));
    }),
);

it.effect(
  "code the planning model shows waits for Luke's next words, then goes on screen with a note the voice keeps",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Where does the invite get checked?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      const ref = { path: "src/invite.ts", startLine: 3, endLine: 5 };

      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.CODE_SHOWN, runId: "run-1", ref });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
        runId: "run-1",
        question: "Should the expiry check move here?",
        recommendation: "Yes.",
      });
      yield* settle();
      assert.deepEqual(f.codes, [], "nothing is on screen before Luke speaks");
      // Each append waits on the last one's acknowledgment, as every append does.
      sideband.acknowledge(
        sideband.sent.findIndex((event) => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND),
        1000,
        1100,
      );

      sideband.output("Look at", 1000, 1100);
      yield* settle();

      assert.deepEqual(f.codes, [ref]);
      const notes = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).map((event) =>
        "content" in event ? event.content : "",
      );
      assert.ok(notes.some((note) => note.includes("src/invite.ts, lines 3 to 5")));
      sideband.output(" lines three to five.", 1100, 1300);
      yield* settle();
      assert.deepEqual(f.codes, [ref], "the code goes on screen once");
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
  "a delegation while a run is in flight supersedes it: the older reply and its notes are never spoken, its queued questions still are, and the newest reply is said under its own id",
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
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-1",
        step: "provider_write",
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Two tests in the web repo.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
        runId: "run-1",
        question: "Fix both?",
        recommendation: "Yes.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      sideband.acknowledge(0, 2500, 2600);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-2" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "One test in the API repo.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-2",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 2);
      const [question, reply] = commentary;
      assert.ok(question && "content" in question && question.content.includes("Fix both?"));
      assert.equal(question.delegation_id, "item_1");
      assert.ok(reply && "content" in reply);
      assert.equal(reply.content, "One test in the API repo.");
      assert.equal(reply.delegation_id, "item_2");
      // Superseding discards the older reply and leaves its run to finish: nothing is cancelled.
      assert.deepEqual(f.brain.cancels, []);
    }),
);

it.effect(
  "a run the brain opened of its own waits for the asked run under way: its reply is said session-wide once that run's reply has been, and the asked reply is not cut off",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Which queue should we use?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.WOKEN, runId: "woken-1" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "woken-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "woken-1",
        sentence: "The research is back: three sources agree.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "woken-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);

      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Use the existing job queue.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      // Each commentary waits for the one ahead of it to be taken.
      sideband.acknowledge(
        sideband.sent.findIndex((sent) => sent.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND),
        2000,
        2600,
      );
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((append) =>
          "content" in append ? [append.content, append.delegation_id] : [],
        ),
        [
          ["Use the existing job queue.", "item_1"],
          ["The research is back: three sources agree.", null],
        ],
      );
    }),
);

it.effect(
  "a run the brain opened of its own is silenced by the developer's next ask, as any older run is, and a woken run that fails says nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Which queue should we use?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.WOKEN, runId: "woken-1" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "woken-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "woken-1",
        sentence: "The research is back.",
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.WOKEN, runId: "woken-2" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "woken-2",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      sideband.input("Actually, skip the queue.", 1500, 2300);
      sideband.delegation("item_2", 2400);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-2" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "Then we call it inline.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-2",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((append) => ("content" in append ? append.content : undefined)),
        ["Then we call it inline."],
      );
    }),
);

it.effect(
  "an exchange superseded after a sentence it released while its run went on says no later sentence and no note when that run then fails",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is failing?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Two." });
      yield* settle();
      sideband.acknowledge(0, 1000, 1100);
      yield* settle();
      sideband.input("No, the API repo.", 1500, 2300);
      sideband.delegation("item_2", 2400);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Both in the web repo.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(1000);
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).map((event) =>
          "content" in event ? event.content : undefined,
        ),
        ["Two."],
      );
    }),
);

it.effect(
  "an older reply already queued behind an unacknowledged append is dropped when a newer delegation is accepted before it leaves",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What is failing?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Two." });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Both in the web repo.",
      });
      yield* settle();
      // The first sentence is out and awaits its ack; the second waits behind it.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.input("No, the API repo.", 1500, 2300);
      sideband.delegation("item_2", 2400);
      yield* settle();
      sideband.acknowledge(0, 2500, 2600);
      yield* settle();
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).map((event) =>
          "content" in event ? event.content : undefined,
        ),
        ["Two."],
      );
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

/** Nothing doing: the voice in no wait, and no exchange open. */
const IDLE_STATUS = { voice: undefined, planner: undefined } as const;

it.effect(
  "an ask is told as handing off, then the planner and its pending command, then Luke about to answer, and nothing once he begins",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Where are invites sent?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIVITY, runId: "run-1", action: "ls src" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIVITY, runId: "run-1", action: undefined });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "In src.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      sideband.output("In src.", 2000, 2400);
      yield* settle();
      assert.deepEqual(f.statuses, [
        { voice: VOICE_PHASE.HANDING_OFF, planner: undefined },
        { voice: undefined, planner: { action: undefined } },
        { voice: undefined, planner: { action: "ls src" } },
        { voice: undefined, planner: { action: undefined } },
        { voice: VOICE_PHASE.ABOUT_TO_ANSWER, planner: { action: undefined } },
        { voice: VOICE_PHASE.ABOUT_TO_ANSWER, planner: undefined },
        IDLE_STATUS,
      ]);
    }),
);

it.effect("a refused submission goes from handing off to about to answer its refusal", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.brain.refuse = "No brain stands.";
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("Hello?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    assert.deepEqual(f.statuses, [
      { voice: VOICE_PHASE.HANDING_OFF, planner: undefined },
      { voice: VOICE_PHASE.ABOUT_TO_ANSWER, planner: undefined },
    ]);
  }),
);

it.effect("a run that completes with nothing said ends with nothing doing", () =>
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
      end: LIVE_BRAIN_RUN_END.COMPLETED,
    });
    yield* advanceClock(1000);
    assert.deepEqual(f.statuses.at(-1), IDLE_STATUS);
  }),
);

it.effect(
  "a session that closes mid-run is told as nothing doing, and the run ending after it tells nothing more",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Read the repository.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 12);
      yield* settle();
      assert.deepEqual(f.statuses.at(-1), IDLE_STATUS);
      const told = f.statuses.length;
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      assert.equal(f.statuses.length, told);
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
  "an error naming an append refuses that append and never counts as success: each sentence is sent once more and then given up, and a run whose every sentence was refused is spoken as its failure note",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "One." });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Two." });
      yield* settle();
      const refuse = (index: number) => {
        const event = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND)[index];
        assert.ok(event);
        sideband.receive({
          type: LIVE_SERVER_EVENT.ERROR,
          event_id: `err-${index}`,
          error: { code: null, client_event_id: event.event_id },
        });
      };
      for (let index = 0; index < 4; index += 1) {
        assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, index + 1);
        refuse(index);
        yield* settle();
      }
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(1000);
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND), [
        "One.",
        "One.",
        "Two.",
        "Two.",
        RUN_END_NOTE[LIVE_BRAIN_RUN_END.FAILED],
      ]);
    }),
);

it.effect(
  "an error naming no command, or naming one with no code, is reported by its type and code alone",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      replyWith(f, "One.");
      yield* settle();
      const first = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND)[0];
      assert.ok(first);
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err-1",
        error: { type: "server_error", code: "internal", message: "the words" },
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err-2",
        error: { code: null, client_event_id: first.event_id, message: "the words" },
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err-3",
        error: { type: "invalid_request_error", code: "invalid_value", event_id: "other-1" },
      });
      yield* settle();
      assert.deepEqual(
        f.reports.filter((report) => report.startsWith("A live error")),
        [
          "A live error reached the general handler, type=server_error code=internal",
          "A live error reached the general handler, type=none code=none",
        ],
      );
    }),
);

it.effect(
  "idle reported by the peer closes the session only once the host too has appended nothing in the window, and records the usage",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.refuse = "No brain stands.";
      const sideband = yield* f.open();
      yield* settle();
      // The refusal is spoken, which is the host appending into the session.
      sideband.input("Hello?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(0, 1000, 1200);
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
      assert.equal(f.service.sessionStands(), true);
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
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
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
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
    }),
);

it.effect(
  "a lost connection drops the delivery aimed at the dead session, which the session adopted after never hears",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.refuse = "No brain stands.";
      const sideband = yield* f.open();
      yield* settle();
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u1",
        usage: { seconds: 20 },
      });
      sideband.input("Hello?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.dropConnection();
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
      const second = yield* f.open();
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
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

/** The contents of the appends of one type, in the order sent. */
function contents(sideband: FakeSideband, type: string) {
  return appends(sideband, type).map((event) => ("content" in event ? event.content : undefined));
}

it.effect(
  "the stop key blocks the running exchange: its late reply and end note are never spoken, its run is cancelled, and the voice is told silently once the cancel is confirmed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.brain.cancelWhen = yield* Deferred.make<void>();
      sideband.input("Explore the repository.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      sideband.output("Looking now", 1000, 1400);
      assert.equal(f.service.stopSpeaking(), true);
      yield* settle();
      assert.deepEqual(f.brain.cancels, ["run-1"]);
      sideband.acknowledge(0, 1500, 1500);
      yield* settle();
      // Nothing is told of the cancel before the brain confirms it.
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), []);
      yield* Deferred.succeed(f.brain.cancelWhen, undefined);
      yield* settle();
      const thinking = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), [STOPPED_RUN_NOTE]);
      assert.equal(
        thinking[0] && "delegation_id" in thinking[0] && thinking[0].delegation_id,
        "item_1",
      );
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-1",
        step: "provider_write",
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "The repository has two apps.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
        runId: "run-1",
        question: "Which app is this for?",
        recommendation: "The web app.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.CANCELLED,
      });
      yield* advanceClock(1000);
      // The queued question is the plan's, so it is still handed on; the reply and the note are not.
      const commentary = contents(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.ok(commentary[0]?.includes("Which app is this for?"));
      assert.equal(contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
    }),
);

it.effect("a cancel the backend did not take tells the voice nothing of a cancel", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.brain.cancel = LIVE_BRAIN_CANCEL.FAILED;
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("Explore the repository.", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    assert.equal(f.service.stopSpeaking(), true);
    yield* settle();
    sideband.acknowledge(0, 1500, 1500);
    yield* settle();
    assert.deepEqual(f.brain.cancels, ["run-1"]);
    assert.deepEqual(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), []);
  }),
);

it.effect(
  "an ask delegated before the stop key and accepted after it is blocked and cancelled too, and one delegated after the press is spoken",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.brain.answerWhen = yield* Deferred.make<void>();
      sideband.input("Explore the repository.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      assert.equal(f.service.stopSpeaking(), true);
      yield* Deferred.succeed(f.brain.answerWhen, undefined);
      f.brain.answerWhen = undefined;
      yield* settle();
      assert.deepEqual(f.brain.cancels, ["run-1"]);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Two apps.",
      });
      sideband.acknowledge(0, 1500, 1500);
      yield* settle();
      sideband.input("Just the web app.", 2000, 2800);
      sideband.delegation("item_2", 2900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-2" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "Noted.",
      });
      yield* settle();
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND), ["Noted."]);
      assert.deepEqual(f.brain.cancels, ["run-1"]);
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

it.effect("adopting a session while one stands closes the standing one first", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    yield* settle();
    const second = new FakeSideband();
    const adopting = yield* Effect.forkChild(
      f.service.adoptSession({
        sessionId: "sess-2",
        attach: () => Effect.succeed(second),
        started: true,
      }),
    );
    yield* settle();
    assert.equal(appends(first, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    assert.equal(adopting.pollUnsafe(), undefined);
    first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
    assert.equal(yield* Fiber.join(adopting), true);
    assert.equal(first.closed, true);
    assert.equal(f.service.sessionStands(), true);
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
  "release lets the session go with nothing sent up, the words said so far on record, and a stop after it closes nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Ship it.", 0, 800);
      yield* settle();
      yield* f.service.release();
      yield* f.service.stop();
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
      assert.equal(f.service.sessionStands(), false);
      assert.equal(sideband.closed, true);
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.USER, 0, 800]]);
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
      const f = yield* fixture();
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
  "an append pending when the session dies is dropped with it and never re-sent into the session opened after",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Summarize.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      // The first sentence waits on its acknowledgment, and the second is pending behind it.
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Done.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Also this.",
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.dropConnection();
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      const second = yield* f.open();
      yield* settle();
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
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
  "a run that fails after a sentence it released while it ran keeps that sentence said and is still spoken as the standing note",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What does the repository hold?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Looked.",
      });
      yield* settle();
      sideband.acknowledge(0, 1000, 1100);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => ("content" in event ? event.content : undefined)),
        ["Looked.", RUN_END_NOTE[LIVE_BRAIN_RUN_END.FAILED]],
      );
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
  "a follow-up delegated seconds after an ask, its words on the first ask's row, attaches nothing of its own, and its reply waits on the first ask's attach and is said once under its own id",
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
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-2" });
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
    }),
);

/** A session an earlier connection held, adopted again as the device's re-attach hands it in: already started. */
function reattach(f: Fixture, sessionId: string) {
  return Effect.gen(function* () {
    const sideband = new FakeSideband();
    const adopted = yield* f.service.adoptSession({
      sessionId,
      attach: () => Effect.succeed(sideband),
      started: true,
    });
    assert.ok(adopted);
    return sideband;
  });
}

/** A run a re-attach takes up, neither stopped nor stale unless the test says so. */
function recoveredRun(
  runId: string,
  delegationId: string,
  revision: number,
  held: { stopped?: boolean; stale?: boolean } = {},
): LiveBrainRecoveredRun {
  return {
    runId,
    delegationId,
    revision,
    stopped: held.stopped ?? false,
    stale: held.stale ?? false,
  };
}

/** A run's whole reply as its follow tells it: the settle, one sentence, and a completed end. */
function wholeReply(runId: string, sentence: string): LiveBrainRunEvent[] {
  return [
    { kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId },
    { kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId, end: LIVE_BRAIN_RUN_END.COMPLETED },
  ];
}

it.effect(
  "a re-attached session takes up the runs the lost connection accepted: the newest one's reply, finished in the gap, is spoken once under its own delegation, and an older one stays superseded",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.recovery = {
        revision: 2,
        runs: [recoveredRun("run-a", "item_a", 1), recoveredRun("run-b", "item_b", 2)],
        // The follow tells what it finds the moment it runs, so an exchange not yet standing would miss it.
        told: [
          ...wholeReply("run-a", "The outdated answer."),
          ...wholeReply("run-b", "The answer that stands."),
        ],
      };
      const sideband = yield* reattach(f, "sess-live");
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      const [reply] = commentary;
      assert.ok(reply && "content" in reply);
      assert.equal(reply.content, "The answer that stands.");
      assert.equal(reply.delegation_id, "item_b");
    }),
);

it.effect(
  "the newest run taken up, ended too long ago to be news, is silenced: nothing of its reply is said",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.recovery = {
        revision: 1,
        runs: [recoveredRun("run-a", "item_a", 1, { stale: true })],
        told: wholeReply("run-a", "An answer from long ago."),
      };
      const sideband = yield* reattach(f, "sess-live");
      yield* advanceClock(1000);
      assert.deepEqual(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND), []);
    }),
);

it.effect(
  "the newest run taken up, stopped by the developer on the lost connection, is silenced, and the stop key does not cancel it again",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.recovery = {
        revision: 1,
        runs: [recoveredRun("run-a", "item_a", 1, { stopped: true })],
        told: [],
      };
      const sideband = yield* reattach(f, "sess-live");
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-a",
        step: "repository_read",
      });
      yield* settle();
      assert.deepEqual(sideband.sent, []);
      // The connection that heard the stop key asked the cancel, so a press now tells of no second one.
      assert.equal(f.service.stopSpeaking(), true);
      yield* settle();
      sideband.acknowledge(0, 1500, 1500);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-a",
        end: LIVE_BRAIN_RUN_END.CANCELLED,
      });
      yield* advanceClock(1000);
      assert.deepEqual(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND), []);
      assert.deepEqual(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), []);
    }),
);

it.effect(
  "a delegation heard after a re-attach goes on from the newest revision recorded, under the session's id, and supersedes a run taken up that is still under way",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.brain.recovery = { revision: 3, runs: [recoveredRun("run-c", "item_c", 3)], told: [] };
      const sideband = yield* reattach(f, "sess-live");
      yield* settle();
      sideband.input("Actually, plan it for the API.", 0, 800);
      sideband.delegation("item_d", 900);
      yield* settle();
      assert.deepEqual(
        f.brain.asks.map((ask) => [ask.submissionId, ask.sessionId, ask.revision]),
        [["item_d", "sess-live", 4]],
      );
      for (const event of wholeReply("run-c", "The plan for the web app.")) f.brain.fire(event);
      for (const event of wholeReply("run-1", "The plan for the API.")) f.brain.fire(event);
      yield* advanceClock(1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(
        commentary.map((event) => [
          "content" in event && event.content,
          "delegation_id" in event && event.delegation_id,
        ]),
        [["The plan for the API.", "item_d"]],
      );
    }),
);

/** Fires that `settled` of run-1's steps have settled, the latest a repository read. */
function stepSettled(f: Fixture, settled: number) {
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.STEP_SETTLED,
    runId: "run-1",
    step: "repository_read",
    settled,
  });
}

it.effect(
  "a running ask's settled steps reach the voice as quiet progress under its delegation, no sooner than the gap apart and no more than the bound, and none once the run has ended",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("How do invites work today?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      stepSettled(f, 1);
      // A step settled inside the gap is not told on its own, but counted in the next note.
      stepSettled(f, 2);
      yield* settle();
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), [
        "Luke finished a read of the repository; 1 step of this ask done so far.",
      ]);
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).map((event) =>
          "delegation_id" in event ? event.delegation_id : undefined,
        ),
        ["item_1"],
      );
      yield* advanceClock(PROGRESS_NOTE_BOUNDS.GAP_MS);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.STEP_SETTLED,
        runId: "run-1",
        step: undefined,
        settled: 3,
      });
      yield* settle();
      assert.equal(
        contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).at(-1),
        "Luke finished a step; 3 steps of this ask done so far.",
      );
      for (let settled = 4; settled < 20; settled += 1) {
        yield* advanceClock(PROGRESS_NOTE_BOUNDS.GAP_MS);
        stepSettled(f, settled);
      }
      yield* settle();
      assert.equal(
        appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length,
        PROGRESS_NOTE_BOUNDS.PER_EXCHANGE,
      );
      // Nothing the voice is to say came of any of it.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
    }),
);

it.effect("a settled step tells nothing once its run has ended or a newer ask silenced it", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("How do invites work today?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    f.brain.fire({
      kind: LIVE_BRAIN_RUN_EVENT.ENDED,
      runId: "run-1",
      end: LIVE_BRAIN_RUN_END.FAILED,
    });
    stepSettled(f, 1);
    sideband.input("And who can send them?", 1000, 1800);
    sideband.delegation("item_2", 1900);
    yield* settle();
    yield* advanceClock(PROGRESS_NOTE_BOUNDS.GAP_MS);
    f.brain.fire({
      kind: LIVE_BRAIN_RUN_EVENT.STEP_SETTLED,
      runId: "run-1",
      step: "repository_read",
      settled: 2,
    });
    yield* settle();
    assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND), []);
  }),
);

/** Answers run-1's reply with one sentence, its actions settled. */
function replyWith(f: Fixture, sentence: string) {
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence });
}

/** Refuses the append sent at the given index with an error naming it. */
function refuseAt(sideband: FakeSideband, index: number) {
  const sent = sideband.sent[index];
  assert.ok(sent, `append ${index} was sent`);
  sideband.receive({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: `err-${index}`,
    error: { code: null, client_event_id: sent.event_id },
  });
}

it.effect(
  "a reply chunk the session refused is sent once more under a fresh id, and the reply is said rather than lost",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Is the fix in?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      replyWith(f, "It landed.");
      yield* settle();
      refuseAt(sideband, sideband.sent.length - 1);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.deepEqual(contents(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND), [
        "It landed.",
        "It landed.",
      ]);
      assert.notEqual(commentary[0]?.event_id, commentary[1]?.event_id);
      assert.deepEqual(
        commentary.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
        ["item_1", "item_1"],
      );
      sideband.acknowledge(sideband.sent.length - 1, 1000, 1100);
      yield* settle();
      assert.deepEqual(
        f.reports.filter((report) => report.includes("commentary")),
        [],
      );
    }),
);

it.effect("a reply chunk refused on its retry too is reported and not sent a third time", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("Is the fix in?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    replyWith(f, "It landed.");
    yield* settle();
    refuseAt(sideband, sideband.sent.length - 1);
    yield* settle();
    refuseAt(sideband, sideband.sent.length - 1);
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
    assert.deepEqual(
      f.reports.filter((report) => report.includes("commentary")),
      ["A reply's commentary was refused twice and is not said"],
    );
  }),
);

it.effect(
  "a reply chunk left unanswered is reported and never sent again, since it may still reach the timeline",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Is the fix in?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      replyWith(f, "It landed.");
      yield* advanceClock(60_000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      assert.ok(f.reports.includes("A reply's commentary went unanswered and is not sent again"));
    }),
);
