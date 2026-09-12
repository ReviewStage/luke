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
  type LiveServerEvent,
  type LiveServerEventType,
  PREFETCH_DEBOUNCE_MS,
  PROACTIVE_SPEECH_KIND,
  parseLiveServerEvent,
  type RosterSeedSession,
  rosterSeed,
  rosterUpdate,
  SEED_ROLE,
  seedItemTokens,
  UTTERANCE_GAP_MS,
  UTTERANCE_SETTLE_MARGIN_MS,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry, SESSION_STATUS } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Duration, Effect, type Fiber, FiberId, Runtime, TestClock } from "effect";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import type { LiveSideband, SocketClose } from "../live-socket.js";
import type { TimerHandle } from "./append-channel.js";
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
import type { DeveloperUtteranceRecord, LiveRecord, LukeUtteranceRecord } from "./live-record.js";
import {
  ANTICIPATION_FACTS_PREFIX,
  ASK_UNRECORDED_NOTE,
  LiveSessionService,
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
  readonly #events = new Set<(event: LiveServerEvent) => void>();
  readonly #closes = new Set<(close: SocketClose) => void>();

  onEvent(listener: (event: LiveServerEvent) => void): () => void {
    this.#events.add(listener);
    return () => {
      this.#events.delete(listener);
    };
  }

  onClose(listener: (close: SocketClose) => void): () => void {
    this.#closes.add(listener);
    return () => {
      this.#closes.delete(listener);
    };
  }

  send(event: LiveClientEvent): void {
    this.sent.push(event);
    if (this.acknowledgeThinkingAtOnce && event.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
      this.acknowledge(this.sent.length - 1, 0, 0);
    }
  }

  close(): void {
    this.closed = true;
  }

  /** Delivers one server event as the socket would, through the same parser the real sideband uses. */
  receive(payload: WireRecord): void {
    const event = parseLiveServerEvent(JSON.stringify(payload));
    assert.ok(event, `a test event must parse: ${JSON.stringify(payload)}`);
    for (const listener of [...this.#events]) listener(event);
  }

  dropConnection(): void {
    for (const listener of [...this.#closes]) listener({ code: 1006 });
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
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  #runs = 0;

  async submitAsk(ask: LiveBrainAsk): Promise<LiveBrainSubmission> {
    this.asks.push(ask);
    if (this.refuse !== undefined) {
      return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: this.refuse };
    }
    this.#runs += 1;
    return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: `run-${this.#runs}` };
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

  anticipate(anticipation: LiveBrainAnticipation): void {
    this.anticipations.push(anticipation);
  }

  dropAnticipation(): void {
    this.drops += 1;
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
  readonly developer: DeveloperUtteranceRecord[] = [];
  readonly luke: LukeUtteranceRecord[] = [];
  /** While set, developer writes wait here for the test to answer them. */
  #held: ((written: boolean) => void)[] | undefined;

  /** The next developer writes are held until `release` answers them. */
  hold(): void {
    this.#held = [];
  }

  /** Answers the oldest held developer write; a write answered true is on the record. */
  release(written: boolean): void {
    const held = this.#held?.shift();
    assert.ok(held, "a developer write is held");
    held(written);
  }

  async writeDeveloperUtterance(record: DeveloperUtteranceRecord): Promise<boolean> {
    if (this.#held === undefined) {
      this.developer.push(record);
      return true;
    }
    const written = await new Promise<boolean>((resolve) => {
      this.#held?.push(resolve);
    });
    if (written) this.developer.push(record);
    return written;
  }

  async writeLukeUtterance(record: LukeUtteranceRecord): Promise<boolean> {
    this.luke.push(record);
    return true;
  }
}

/**
 * The service's `now`/`schedule`/`cancel` seam over whichever runtime a test
 * is running on, so its timers fire on the ambient `TestClock` a test
 * advances rather than a real one. `now` is a bookkeeping value the test
 * moves in lockstep with `TestClock.adjust`, independent of the ambient
 * clock's own virtual instant, so an expected value built from it stays
 * consistent with the service's own reading of `now()`.
 */
class TestSchedule {
  now = 1_800_000_000_000;
  readonly delays: number[] = [];
  readonly #fork: <A>(effect: Effect.Effect<A, never, never>) => Fiber.RuntimeFiber<A, never>;
  readonly #armed = new Map<TimerHandle, Fiber.RuntimeFiber<void>>();

  constructor(runtime: Runtime.Runtime<never>) {
    this.#fork = Runtime.runFork(runtime);
  }

  schedule = (callback: () => void, delayMs: number): TimerHandle => {
    const handle: TimerHandle = {};
    this.delays.push(delayMs);
    const fiber = this.#fork(
      Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
        Effect.ensuring(Effect.sync(() => this.#armed.delete(handle))),
      ),
    );
    this.#armed.set(handle, fiber);
    return handle;
  };

  cancel = (timer: TimerHandle): void => {
    const fiber = this.#armed.get(timer);
    if (fiber === undefined) return;
    this.#armed.delete(timer);
    fiber.unsafeInterruptAsFork(FiberId.none);
  };

  bump(deltaMs: number): void {
    this.now += deltaMs;
  }
}

/** Moves the test's own clock forward by `deltaMs`, firing whatever the ambient `TestClock` finds due, and settles what that firing started. */
function advanceClock(clock: TestSchedule, deltaMs: number) {
  return Effect.gen(function* () {
    yield* TestClock.adjust(Duration.millis(deltaMs));
    clock.bump(deltaMs);
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow();
  });
}

/** Lets queued microtasks and forked fibers run their course. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow();
  });
}

interface Fixture {
  clock: TestSchedule;
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
  open: () => Promise<FakeSideband>;
  /** What the test wants told of a briefing's last append; nothing by default. */
  onBriefingAppend?: (delivery: { briefing: string; decidedAt: number }, eventId: string) => void;
}

function fixture(runtime: Runtime.Runtime<never>, brain: FakeBrain = new FakeBrain()): Fixture {
  const clock = new TestSchedule(runtime);
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
    create: async (input) => {
      seeds.push([...input.input]);
      const sideband = new FakeSideband();
      sidebands.push(sideband);
      const opened: LiveSessionOpened = {
        sessionId: `sess-${sidebands.length}`,
        sdpAnswer: `answer-for-${input.sdpOffer}`,
        attach: async () => sideband,
      };
      creates.push(opened);
      return opened;
    },
    setVoice: () => undefined,
    diagnostics: () => {
      throw new Error("not read here");
    },
  };
  const entries: ConversationEntry[] = [];
  const roster: RosterSeedSession[] = [];
  const service = new LiveSessionService({
    source: () => (state.sourceAvailable ? source : undefined),
    brain,
    record,
    conversationEntries: () => entries,
    roster: () => roster,
    quietNow: async () => state.quiet,
    releaseHeldBriefings: (held) => released.push([...held]),
    emit: (change) => changes.push(change),
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    createId: () => `id-${++ids}`,
    report: () => undefined,
    trace: (trace) => traces.push(trace),
    onProactiveSpoken: (kind) => spoken.push(kind),
    onBriefingAppend: (delivery, eventId) => fixtureState.onBriefingAppend?.(delivery, eventId),
  });
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
    open: async () => {
      const created = await service.createSession("offer");
      assert.ok(created);
      const sideband = sidebands[sidebands.length - 1];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      return sideband;
    },
  };
  return fixtureState;
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.entries.push(
        { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
      );
      const created = yield* Effect.promise(() => f.service.createSession("offer"));
      assert.deepEqual(created, { sessionId: "sess-1", sdpAnswer: "answer-for-offer" });
      assert.deepEqual(
        f.seeds[0]?.map((item) => item.role),
        [SEED_ROLE.USER, SEED_ROLE.ASSISTANT],
      );
      assert.equal(f.service.sessionStands(), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED]);
      f.sidebands[0]?.started("sess-1");
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
      const sideband = new FakeSideband();
      const adopted = yield* Effect.promise(() =>
        f.service.adoptSession({
          sessionId: "sess-adopted",
          attach: async () => sideband,
          started: false,
        }),
      );
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
      const runtime = yield* Effect.runtime<never>();
      const running = fixture(runtime);
      const runningSideband = new FakeSideband();
      assert.equal(
        yield* Effect.promise(() =>
          running.service.adoptSession({
            sessionId: "sess-running",
            attach: async () => runningSideband,
            started: true,
          }),
        ),
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

      const fresh = fixture(runtime);
      const freshSideband = new FakeSideband();
      assert.equal(
        yield* Effect.promise(() =>
          fresh.service.adoptSession({
            sessionId: "sess-fresh",
            attach: async () => freshSideband,
            started: false,
          }),
        ),
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

it.effect(
  "an adopted session whose sideband cannot attach is not stood: the adopt answers false and the session is announced closed as sideband-failed",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const adopted = yield* Effect.promise(() =>
        f.service.adoptSession({
          sessionId: "sess-unreachable",
          attach: async () => {
            throw new Error("the sideband never opened");
          },
          started: false,
        }),
      );
      assert.equal(adopted, false);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.CLOSED]);
      assert.equal(f.changes.at(-1)?.reason, "sideband-failed");
    }),
);

it.effect("no source means no session and nothing announced", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    f.sourceAvailable = false;
    assert.equal(yield* Effect.promise(() => f.service.createSession("offer")), undefined);
    assert.deepEqual(f.changes, []);
  }),
);

it.effect(
  "a delegation is claimed once, composed from the transcript since the previous one, and written as the developer's line",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.output("Hi there.", 0, 900);
      sideband.input("What needs me", 1000, 1800);
      sideband.input(" right now?", 1800, 2400);
      sideband.delegation("item_1", 2500);
      sideband.delegation("item_1", 2500);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.deepEqual(f.brain.asks[0]?.submissionId, "item_1");
      assert.equal(f.record.developer.length, 1);
      assert.deepEqual(
        {
          text: f.record.developer[0]?.text,
          delegationId: f.record.developer[0]?.delegationId,
          askContext: f.record.developer[0]?.askContext,
          runId: f.record.developer[0]?.runId,
          voiceSessionId: f.record.developer[0]?.voiceSessionId,
        },
        {
          text: "What needs me right now?",
          delegationId: "item_1",
          askContext: { sinceMs: 0, untilMs: 2500 },
          runId: "run-1",
          voiceSessionId: "sess-1",
        },
      );
      // The settle timer finds the ask already on record and writes only Luke's line.
      yield* advanceClock(f.clock, UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
      assert.equal(f.record.developer.length, 1);
      assert.deepEqual(
        f.record.luke.map((line) => [line.role, line.text, line.startMs, line.endMs]),
        [[CONVERSATION_ENTRY_KIND.REPLY, "Hi there.", 0, 900]],
      );
    }),
);

it.effect(
  "a delegation before any developer utterance is retained and composed on the next fragment, once",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.delegation("item_early", 400);
      yield* settle();
      assert.equal(f.brain.asks.length, 0);
      assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.RETAINED).length, 1);
      sideband.input("Open the failing one.", 500, 1400);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.equal(f.record.developer[0]?.delegationId, "item_early");
      sideband.input(" Please.", 1400, 1700);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
    }),
);

it.effect("a retained delegation dies with its session", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    sideband.delegation("item_orphan", 400);
    sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 12);
    yield* settle();
    const second = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      yield* advanceClock(f.clock, 1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "a run that ends without a reply is spoken as the standing note for how it ended, and a completed one says nothing more",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("Stop that.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.CANCELLED,
      });
      yield* advanceClock(f.clock, 1000);
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
      yield* advanceClock(f.clock, 1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect("a refused submission is spoken as its refusal under the delegation", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    f.brain.refuse = "No brain stands.";
    const sideband = yield* Effect.promise(() => f.open());
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
    assert.equal(f.record.developer[0]?.runId, undefined);
  }),
);

it.effect(
  "a briefing is spoken into the standing session with no delegation, settled spoken by the first output past its end, and un-settled by a moderation cut",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      assert.deepEqual(f.spoken, []);
      sideband.output("alofa is done.", 5150, 5400);
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.BRIEFING]);
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err",
        error: { code: "moderation" },
      });
      assert.deepEqual(
        f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.UNSETTLED).length,
        1,
      );
    }),
);

it.effect("an error naming an append refuses that append and never counts as success", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const sideband = yield* Effect.promise(() => f.open());
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
  "a proactive turn with no session asks for one, muted, and speaks once it starts; a stale one is dropped instead",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.service.deliverBriefing({ briefing: "News.", decidedAt: f.clock.now });
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      f.service.speakBeat({
        kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
        decidedAt: f.clock.now,
      });
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
      yield* advanceClock(f.clock, 3 * 60_000);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.quiet = true;
      yield* Effect.promise(() => f.service.reconcile());
      const delivery = { briefing: "Held news.", decidedAt: f.clock.now };
      f.service.deliverBriefing(delivery);
      f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: f.clock.now });
      yield* settle();
      assert.equal(sideband.sent.length, 0);
      yield* advanceClock(f.clock, 60_000);
      f.quiet = false;
      yield* Effect.promise(() => f.service.reconcile());
      yield* settle();
      assert.deepEqual(f.released, [[delivery]]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "a beat is spoken at most once to the end per run, and dropping briefings leaves beats standing",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      yield* Effect.promise(() => f.service.reconcile());
      f.service.deliverBriefing({ briefing: "Drop me too.", decidedAt: f.clock.now });
      f.service.dropBriefings();
      f.quiet = false;
      yield* Effect.promise(() => f.service.reconcile());
      yield* settle();
      assert.deepEqual(f.released, []);
      // The first briefing had already left before the hold; only the beat follows it.
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      sideband.acknowledge(0, 100, 200);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
      sideband.acknowledge(1, 300, 400);
      sideband.output("Connect your calendar.", 500, 900);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.service.deliverBriefing({ briefing: "Fresh.", decidedAt: f.clock.now });
      yield* settle();
      sideband.acknowledge(0, 100, 200);
      yield* advanceClock(f.clock, 60_000);
      f.service.reportActivity(true);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
      f.service.reportActivity(false);
      yield* advanceClock(f.clock, LIVE_IDLE_WINDOW_MS);
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
      assert.equal(f.service.status().usageSeconds, 305);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 310);
      yield* settle();
      assert.deepEqual(f.service.status(), {
        phase: LIVE_SESSION_PHASE.CLOSED,
        usageConfirmed: true,
        lastSessionSeconds: 310,
      });
      assert.equal(sideband.closed, true);
      assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CLOSE_REQUESTED);
    }),
);

it.effect("an idle report while an exchange is in flight does not close the session", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    sideband.input("Read the transcript.", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    yield* advanceClock(f.clock, LIVE_IDLE_WINDOW_MS);
    f.service.reportActivity(true);
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
  }),
);

it.effect(
  "a graceful close that hears nothing gives up at the timeout with the usage unconfirmed",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.receive({
        type: LIVE_SERVER_EVENT.USAGE_UPDATED,
        event_id: "u1",
        usage: { seconds: 40 },
      });
      const ending = f.service.endSession();
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
      assert.deepEqual(f.clock.delays.at(-1), SIDEBAND_CLOSE_TIMEOUT_MS);
      yield* advanceClock(f.clock, SIDEBAND_CLOSE_TIMEOUT_MS);
      yield* Effect.promise(() => ending);
      assert.deepEqual(f.service.status(), {
        phase: LIVE_SESSION_PHASE.CLOSED,
        usageConfirmed: false,
      });
      assert.equal(sideband.closed, true);
    }),
);

it.effect("an expired session reopens at once", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    sideband.closedBy(LIVE_CLOSE_REASON.EXPIRED, 3600);
    yield* settle();
    assert.deepEqual(phases(f.changes).slice(-2), [
      LIVE_SESSION_PHASE.CLOSED,
      LIVE_SESSION_PHASE.WANTED,
    ]);
    assert.equal(f.service.status().usageConfirmed, true);
  }),
);

it.effect(
  "a lost connection leaves the usage unconfirmed, drops the delivery aimed at the dead session, and reopens only if the microphone was live",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      assert.equal(f.service.status().usageConfirmed, false);
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
      assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CONNECTION_LOST);
      assert.equal(
        f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length,
        1,
      );
      const second = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.service.reportTransport(LIVE_TRANSPORT_STATE.FAILED);
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      assert.equal(f.service.status().usageConfirmed, false);
      const second = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      const second = yield* Effect.promise(() => f.open());
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
  "a line is recorded at the instant its utterance began, so a Clear's cutoff refuses what was begun before it",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      const began = f.clock.now;
      sideband.output("Two ", 0, 400);
      yield* advanceClock(f.clock, 500);
      sideband.output("sessions.", 400, 900);
      yield* advanceClock(f.clock, UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
      assert.equal(f.record.luke.length, 1);
      assert.equal(f.record.luke[0]?.recordedAt, began);
    }),
);

it.effect(
  "a muted microphone never carries the stop instruction, whether Luke is silent or mid-sentence",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      assert.equal(f.service.stopSpeaking(), false);
      const sideband = yield* Effect.promise(() => f.open());
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
      const ending = f.service.endSession();
      yield* settle();
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
      yield* Effect.promise(() => ending);
      assert.equal(f.service.stopSpeaking(), false);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
    }),
);

it.effect(
  "both speakers' utterances reach the record after the gap and the settle margin, grouped, once",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("Hello", 0, 400);
      sideband.output("Hi.", 500, 900);
      sideband.input(" there", 400, 800);
      yield* advanceClock(f.clock, UTTERANCE_GAP_MS);
      assert.deepEqual([f.record.developer.length, f.record.luke.length], [0, 0]);
      yield* advanceClock(f.clock, UTTERANCE_SETTLE_MARGIN_MS);
      assert.deepEqual(
        f.record.developer.map((line) => [line.text, line.delegationId, line.askContext]),
        [["Hello there", null, undefined]],
      );
      assert.deepEqual(
        f.record.luke.map((line) => line.text),
        ["Hi."],
      );
      sideband.input("Bye", 5000, 5300);
      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 6);
      yield* settle();
      assert.deepEqual(
        f.record.developer.map((line) => line.text),
        ["Hello there", "Bye"],
      );
    }),
);

it.effect(
  "an utterance that settled before its delegation is written again under the delegation, with its run, and the record decides what the second write means",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("Open the failing one.", 1000, 2200);
      yield* advanceClock(f.clock, UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
      assert.deepEqual(
        f.record.developer.map((line) => [line.rowId, line.delegationId, line.runId]),
        [[1, null, undefined]],
      );
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
      assert.deepEqual(
        f.record.developer.map((line) => [line.rowId, line.delegationId, line.runId]),
        [
          [1, null, undefined],
          [1, "item_late", "run-1"],
        ],
      );
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      // The settle timer has nothing more to write for the row.
      yield* advanceClock(f.clock, UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
      assert.equal(f.record.developer.length, 2);
    }),
);

it.effect(
  "a briefing's last append is told to the record before it is sent, once, under the event id the append carries; a beat tells nothing",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const told: { briefing: string; eventId: string }[] = [];
      f.onBriefingAppend = (delivery, eventId) =>
        told.push({ briefing: delivery.briefing, eventId });
      const sideband = yield* Effect.promise(() => f.open());
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
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const first = yield* Effect.promise(() => f.open());
    yield* settle();
    const creating = f.service.createSession("offer-2");
    yield* settle();
    assert.equal(appends(first, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
    const created = yield* Effect.promise(() => creating);
    assert.equal(created?.sessionId, "sess-2");
    assert.equal(f.creates.length, 2);
  }),
);

it.effect("stop closes the session gracefully and takes nothing else with it", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    const stopping = f.service.stop();
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
    sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 2);
    yield* Effect.promise(() => stopping);
    assert.equal(f.service.sessionStands(), false);
  }),
);

it.effect(
  "a run's reply is appended once per sentence, in order, and nothing of the run is appended after its end",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      yield* advanceClock(f.clock, 1000);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.service.deliverBriefing({ briefing: "Already said.", decidedAt: f.clock.now });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      f.quiet = true;
      yield* Effect.promise(() => f.service.reconcile());
      f.quiet = false;
      yield* Effect.promise(() => f.service.reconcile());
      yield* settle();
      assert.deepEqual(f.released, []);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      f.quiet = true;
      yield* Effect.promise(() => f.service.reconcile());
      const held = { briefing: "Held.", decidedAt: f.clock.now };
      f.service.deliverBriefing(held);
      f.quiet = false;
      yield* Effect.promise(() => f.service.reconcile());
      yield* Effect.promise(() => f.service.reconcile());
      yield* settle();
      assert.deepEqual(f.released, [[held]]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
    }),
);

it.effect(
  "an append pending when the session dies is dropped with it and never re-sent into the session opened after",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      const second = yield* Effect.promise(() => f.open());
      yield* settle();
      yield* settle();
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      assert.deepEqual(f.spoken, []);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(f.clock, 1000);
      assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
    }),
);

it.effect(
  "run events landing while the ask's record write is out are deferred, then spoken in order once the record holds the ask",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      assert.equal(f.record.developer.length, 0);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      assert.equal(f.record.developer.length, 1);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      yield* advanceClock(f.clock, 1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      yield* advanceClock(f.clock, 1000);
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "content" in commentary[0] && commentary[0].content,
        RUN_END_NOTE[LIVE_BRAIN_RUN_END.FAILED],
      );
    }),
);

it.effect(
  "an ask whose record write fails is answered with the unrecorded note once, and its run's later events reach nothing",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
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
      f.record.release(false);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "content" in commentary[0] && commentary[0].content,
        ASK_UNRECORDED_NOTE,
      );
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_1",
      );
      sideband.acknowledge(0, 1000, 1100);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Late.",
      });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.FAILED,
      });
      yield* advanceClock(f.clock, 1000);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      assert.equal(f.record.developer.length, 0);
    }),
);

it.effect(
  "a steered ask whose sibling's record write fails is settled once every write is in: one unrecorded note, nothing spoken",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.record.hold();
      sideband.input("What failed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      sideband.input("In the API repo.", 5000, 5800);
      sideband.delegation("item_2", 5900);
      yield* settle();
      assert.equal(f.brain.asks.length, 2);
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "Two tests.",
      });
      f.record.release(false);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
      f.record.release(true);
      yield* settle();
      const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
      assert.equal(commentary.length, 1);
      assert.equal(
        commentary[0] && "content" in commentary[0] && commentary[0].content,
        ASK_UNRECORDED_NOTE,
      );
      assert.equal(
        commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
        "item_1",
      );
      sideband.acknowledge(0, 6000, 6100);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-2",
        sentence: "Late.",
      });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
      assert.equal(f.record.developer.length, 1);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.roster.push(rosterSession("a"));
      f.entries.push(
        { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
      );
      yield* Effect.promise(() => f.service.createSession("offer"));
      assert.deepEqual(
        f.seeds[0]?.map((item) => item.role),
        [SEED_ROLE.DEVELOPER, SEED_ROLE.USER, SEED_ROLE.ASSISTANT],
      );
      assert.equal(f.seeds[0]?.[0]?.content[0]?.text, rosterSeed(f.roster, f.clock.now)?.text);
    }),
);

it.effect("an empty desk puts no roster message into the input at all", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
    yield* Effect.promise(() => f.service.createSession("offer"));
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      for (let index = 0; index < 10; index += 1) {
        f.roster.push(rosterSession(`s${index}`, { title: "x".repeat(500) }));
      }
      for (let index = 0; index < 200; index += 1) {
        f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "y".repeat(400) });
      }
      yield* Effect.promise(() => f.service.createSession("offer"));
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.service.updateRoster([rosterSession("a")]);
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    f.roster.push(rosterSession("a"));
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    f.service.updateRoster([rosterSession("a")]);
    yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
    yield* settle();
    assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  }),
);

it.effect(
  "a desk that moves between a session's creation and its start is told at the start, not dropped",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.roster.push(rosterSession("a"));
      const created = yield* Effect.promise(() => f.service.createSession("offer"));
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.service.updateRoster([rosterSession("a")]);
      f.roster.push(rosterSession("a"), rosterSession("b"));
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
    }),
);

it.effect(
  "a desk that empties withdraws what the session was told rather than leaving it standing",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.roster.push(rosterSession("a"));
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      f.service.updateRoster([]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.roster.push(rosterSession("a"));
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = false;
      f.service.updateRoster([]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
      yield* settle();
      const refused = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
      assert.equal(refused.length, 1);
      // The append is never acknowledged, so the channel counts it as not taken.
      yield* advanceClock(f.clock, 10_000);
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = true;
      f.service.updateRoster([]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      f.roster.push(rosterSession("a"));
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.acknowledgeThinkingAtOnce = false;
      // The first refresh puts b on the desk and is left unacknowledged, so it is
      // still in flight when the second takes b away again.
      f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
      f.service.updateRoster([rosterSession("a")]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
    const runtime = yield* Effect.runtime<never>();
    const f = fixture(runtime);
    f.service.updateRoster([rosterSession("a")]);
    yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
    yield* settle();
    assert.deepEqual(f.creates, []);
    assert.equal(f.service.sessionStands(), false);
  }),
);

it.effect(
  "a roster append does not keep a quiet session open: the idle clock reads the appends the session is worth staying open for",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const f = fixture(runtime);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      yield* advanceClock(f.clock, LIVE_IDLE_WINDOW_MS);
      f.service.updateRoster([rosterSession("a")]);
      yield* advanceClock(f.clock, ROSTER_DEBOUNCE_MS);
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
      const runtime = yield* Effect.runtime<never>();
      const brain = new AnticipatingBrain();
      const f = fixture(runtime, brain);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("What is", 1000, 1300);
      sideband.input(" abc", 1300, 1500);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS - 1);
      assert.equal(brain.anticipations.length, 0);
      yield* advanceClock(f.clock, 1);
      assert.deepEqual(brain.anticipations, [
        { rowId: 1, partialAsk: "What is abc", recentTurns: "Developer: What is abc" },
      ]);
      // The same words again plan nothing new; more words plan again under the same row.
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS * 3);
      assert.equal(brain.anticipations.length, 1);
      sideband.input(" doing", 1500, 1900);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 2);
      assert.equal(brain.anticipations[1]?.rowId, 1);
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
      const runtime = yield* Effect.runtime<never>();
      const brain = new AnticipatingBrain();
      const f = fixture(runtime, brain);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.output("Nukualofa finished.", 0, 900);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 0);
      sideband.input("What needs me", 1000, 1800);
      sideband.delegation("item_1", 1900);
      yield* settle();
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 0);
      assert.equal(f.brain.asks.length, 1);

      const plain = fixture(runtime);
      const plainSideband = yield* Effect.promise(() => plain.open());
      yield* settle();
      plainSideband.input("What needs me", 1000, 1800);
      assert.equal(plain.clock.delays.filter((delay) => delay === PREFETCH_DEBOUNCE_MS).length, 0);
    }),
);

it.effect(
  "facts read ahead are appended once, as thinking under no delegation and behind the data prefix, and leave the idle clock where it was",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const brain = new AnticipatingBrain();
      const f = fixture(runtime, brain);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      yield* advanceClock(f.clock, LIVE_IDLE_WINDOW_MS);
      sideband.input("What is abc doing", 1000, 1800);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      brain.facts({ rowId: 1, text: "abc finished the tests." });
      brain.facts({ rowId: 1, text: "abc finished the tests, again." });
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
      const runtime = yield* Effect.runtime<never>();
      const brain = new AnticipatingBrain();
      const f = fixture(runtime, brain);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("What is", 1000, 1300);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      sideband.input(" abc doing", 1300, 1800);
      brain.facts({ rowId: 1, text: "stale" });
      brain.facts({ rowId: 9, text: "unknown row" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      assert.equal(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_DROPPED).length,
        2,
      );
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
      brain.facts({ rowId: 1, text: "too late" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
    }),
);

it.effect(
  "once a row is the spoken ask, a late fragment on it anticipates nothing more and a summary read ahead for it is dropped rather than appended into the exchange",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const brain = new AnticipatingBrain();
      const f = fixture(runtime, brain);
      const sideband = yield* Effect.promise(() => f.open());
      yield* settle();
      sideband.input("What is abc", 1000, 1500);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 1);
      sideband.delegation("item_1", 1600);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      // A fragment still inside the gap joins the same row, which is already the ask.
      sideband.input(" doing", 1500, 1900);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 1);
      brain.facts({ rowId: 1, text: "abc finished the tests." });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
      assert.equal(
        f.traces.filter((trace) => trace.decision === LIVE_TRACE_DECISION.FACTS_DROPPED).length,
        1,
      );
      // The developer's next utterance is a new row and is anticipated as usual.
      sideband.input("And def?", 5000, 5400);
      yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
      assert.equal(brain.anticipations.length, 2);
      assert.equal(brain.anticipations[1]?.rowId, 2);
    }),
);

it.effect("a session's end and the drain each drop what the brain read ahead", () =>
  Effect.gen(function* () {
    const runtime = yield* Effect.runtime<never>();
    const brain = new AnticipatingBrain();
    const f = fixture(runtime, brain);
    const sideband = yield* Effect.promise(() => f.open());
    yield* settle();
    sideband.input("What is abc doing", 1000, 1800);
    sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
    assert.equal(brain.drops, 1);
    assert.equal(brain.anticipations.length, 0);
    yield* advanceClock(f.clock, PREFETCH_DEBOUNCE_MS);
    assert.equal(brain.anticipations.length, 0);
    yield* Effect.promise(() => f.service.stop());
    assert.equal(brain.drops, 2);
  }),
);
