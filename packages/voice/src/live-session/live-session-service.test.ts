import assert from "node:assert/strict";
import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import {
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
import { test } from "vitest";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import type { LiveSideband, SocketClose } from "../live-socket.js";
import { drainMicrotasks, FakeClock } from "../testing.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "./live-brain.js";
import type { DeveloperUtteranceRecord, LiveRecord, LukeUtteranceRecord } from "./live-record.js";
import {
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

interface Fixture {
  clock: FakeClock;
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

function fixture(): Fixture {
  const clock = new FakeClock();
  const brain = new FakeBrain();
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
      await drainMicrotasks();
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

test("a created session is seeded from the record alone, attached before the answer, and its phases are announced", async () => {
  const f = fixture();
  f.entries.push(
    { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
  );
  const created = await f.service.createSession("offer");
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
});

test("an adopted session is stood without asking the source and without a seed: nothing is created, nothing is sent before the session speaks, and a delegation reaches the brain as on a created session", async () => {
  const f = fixture();
  f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
  const sideband = new FakeSideband();
  const adopted = await f.service.adoptSession({
    sessionId: "sess-adopted",
    attach: async () => sideband,
    started: false,
  });
  assert.equal(adopted, true);
  assert.deepEqual(f.creates, []);
  assert.deepEqual(f.seeds, []);
  assert.deepEqual(sideband.sent, []);
  sideband.started("sess-adopted");
  await drainMicrotasks();
  assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
  assert.deepEqual(sideband.sent, []);
  sideband.input("What needs me", 1000, 1800);
  sideband.delegation("item_1", 2500);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 1);
});

test("a session adopted as already started is speakable at once: it hears no session.started again, so a briefing delivered to it is appended without waiting, where one adopted as not yet started waits for the start", async () => {
  const running = fixture();
  const runningSideband = new FakeSideband();
  assert.equal(
    await running.service.adoptSession({
      sessionId: "sess-running",
      attach: async () => runningSideband,
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
  await drainMicrotasks();
  assert.equal(appends(runningSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);

  const fresh = fixture();
  const freshSideband = new FakeSideband();
  assert.equal(
    await fresh.service.adoptSession({
      sessionId: "sess-fresh",
      attach: async () => freshSideband,
      started: false,
    }),
    true,
  );
  fresh.service.deliverBriefing({ briefing: "Nukualofa finished.", decidedAt: fresh.clock.now });
  await drainMicrotasks();
  assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  freshSideband.started("sess-fresh");
  await drainMicrotasks();
  assert.equal(appends(freshSideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
});

test("an adopted session whose sideband cannot attach is not stood: the adopt answers false and the session is announced closed as sideband-failed", async () => {
  const f = fixture();
  const adopted = await f.service.adoptSession({
    sessionId: "sess-unreachable",
    attach: async () => {
      throw new Error("the sideband never opened");
    },
    started: false,
  });
  assert.equal(adopted, false);
  assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.CLOSED]);
  assert.equal(f.changes.at(-1)?.reason, "sideband-failed");
});

test("no source means no session and nothing announced", async () => {
  const f = fixture();
  f.sourceAvailable = false;
  assert.equal(await f.service.createSession("offer"), undefined);
  assert.deepEqual(f.changes, []);
});

test("a delegation is claimed once, composed from the transcript since the previous one, and written as the developer's line", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.output("Hi there.", 0, 900);
  sideband.input("What needs me", 1000, 1800);
  sideband.input(" right now?", 1800, 2400);
  sideband.delegation("item_1", 2500);
  sideband.delegation("item_1", 2500);
  await drainMicrotasks();
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
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal(f.record.developer.length, 1);
  assert.deepEqual(
    f.record.luke.map((line) => [line.role, line.text, line.startMs, line.endMs]),
    [[CONVERSATION_ENTRY_KIND.REPLY, "Hi there.", 0, 900]],
  );
});

test("a delegation before any developer utterance is retained and composed on the next fragment, once", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.delegation("item_early", 400);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 0);
  assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.RETAINED).length, 1);
  sideband.input("Open the failing one.", 500, 1400);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 1);
  assert.equal(f.record.developer[0]?.delegationId, "item_early");
  sideband.input(" Please.", 1400, 1700);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 1);
});

test("a retained delegation dies with its session", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.delegation("item_orphan", 400);
  sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 12);
  await drainMicrotasks();
  const second = await f.open();
  second.input("Anything?", 100, 600);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 0);
});

test("a slow step earns the exchange's one thinking append, and the reply streams only after the actions settled, each chunk awaiting its ack", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.acknowledgeThinkingAtOnce = false;
  sideband.input("Send the fix.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  // The accepted ask itself is told nothing of; only a slow step actually begun writes a note.
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "provider_write" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "provider_write" });
  await drainMicrotasks();
  const thinking = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(thinking.length, 1);
  assert.deepEqual(
    thinking.map((event) => ("delegation_id" in event ? event.delegation_id : undefined)),
    ["item_1"],
  );
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Sent." });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
    runId: "run-1",
    sentence: "It passed.",
  });
  await drainMicrotasks();
  // The slow step's thinking append is still awaiting its ack, so nothing else has left.
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  sideband.acknowledge(0, 930, 950);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  sideband.acknowledge(1, 1000, 1100);
  await drainMicrotasks();
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
});

test("an accepted ask is told nothing of its own acceptance: the reply's commentary is the first thing on the channel, and a refused ask is answered with its refusal", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("How is it going?", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  assert.equal(sideband.sent.length, 0);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Fine." });
  await drainMicrotasks();
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
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
});

test("a delegation while the run is in flight steers it: one exchange, both runs, the reply under the newest id", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("What is failing?", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  sideband.input("In the API repo, I mean.", 1500, 2300);
  sideband.delegation("item_2", 2400);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 2);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
    runId: "run-1",
    sentence: "Two tests.",
  });
  await drainMicrotasks();
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
  await f.clock.advance(f.clock.now + 1000);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
});

test("a run that ends without a reply is spoken as the standing note for how it ended, and a completed one says nothing more", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("Stop that.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    end: LIVE_BRAIN_RUN_END.CANCELLED,
  });
  await f.clock.advance(f.clock.now + 1000);
  const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(commentary.length, 1);
  assert.equal(
    commentary[0] && "content" in commentary[0] && commentary[0].content,
    RUN_END_NOTE[LIVE_BRAIN_RUN_END.CANCELLED],
  );
  sideband.acknowledge(0, 1000, 1100);
  sideband.input("Again.", 2000, 2500);
  sideband.delegation("item_2", 2600);
  await drainMicrotasks();
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.ENDED,
    runId: "run-2",
    end: LIVE_BRAIN_RUN_END.COMPLETED,
  });
  await f.clock.advance(f.clock.now + 1000);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
});

test("a refused submission is spoken as its refusal under the delegation", async () => {
  const f = fixture();
  f.brain.refuse = "No brain stands.";
  const sideband = await f.open();
  sideband.input("Hello?", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(commentary.length, 1);
  assert.equal(
    commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
    "item_1",
  );
  assert.equal(f.record.developer[0]?.runId, undefined);
});

test("a briefing is spoken into the standing session with no delegation, settled spoken by the first output past its end, and un-settled by a moderation cut", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.deliverBriefing({ briefing: "Nukualofa finished.", decidedAt: f.clock.now });
  await drainMicrotasks();
  const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(commentary.length, 1);
  assert.equal(
    commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
    null,
  );
  sideband.acknowledge(0, 5000, 5200);
  await drainMicrotasks();
  sideband.output("Nuku", 5100, 5150);
  assert.deepEqual(f.spoken, []);
  sideband.output("alofa is done.", 5150, 5400);
  assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.BRIEFING]);
  sideband.receive({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: "err",
    error: { code: "moderation" },
  });
  assert.deepEqual(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.UNSETTLED).length, 1);
});

test("an error naming an append refuses that append and never counts as success", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.deliverBriefing({ briefing: "One.", decidedAt: f.clock.now });
  f.service.deliverBriefing({ briefing: "Two.", decidedAt: f.clock.now });
  await drainMicrotasks();
  const first = sideband.sent[0];
  assert.ok(first);
  sideband.receive({
    type: LIVE_SERVER_EVENT.ERROR,
    event_id: "err",
    error: { code: null, client_event_id: first.event_id },
  });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
  assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length, 1);
  sideband.output("One", 100, 200);
  assert.deepEqual(f.spoken, []);
});

test("a proactive turn with no session asks for one, muted, and speaks once it starts; a stale one is dropped instead", async () => {
  const f = fixture();
  f.service.deliverBriefing({ briefing: "News.", decidedAt: f.clock.now });
  assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: f.clock.now });
  const sideband = await f.open();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  sideband.acknowledge(0, 100, 200);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
  f.clock.now += 3 * 60_000;
  f.service.deliverBriefing({ briefing: "Old news.", decidedAt: f.clock.now - 3 * 60_000 });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
  assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.DROPPED).length, 1);
});

test("quiet holds briefings and beats; its end hands briefings back for re-decision and speaks the beats afresh", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.quiet = true;
  await f.service.reconcile();
  const delivery = { briefing: "Held news.", decidedAt: f.clock.now };
  f.service.deliverBriefing(delivery);
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: f.clock.now });
  await drainMicrotasks();
  assert.equal(sideband.sent.length, 0);
  f.clock.now += 60_000;
  f.quiet = false;
  await f.service.reconcile();
  await drainMicrotasks();
  assert.deepEqual(f.released, [[delivery]]);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
});

test("a beat is spoken at most once to the end per run, and dropping briefings leaves beats standing", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.deliverBriefing({ briefing: "Drop me.", decidedAt: f.clock.now });
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: f.clock.now });
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: f.clock.now });
  f.quiet = true;
  await f.service.reconcile();
  f.service.deliverBriefing({ briefing: "Drop me too.", decidedAt: f.clock.now });
  f.service.dropBriefings();
  f.quiet = false;
  await f.service.reconcile();
  await drainMicrotasks();
  assert.deepEqual(f.released, []);
  // The first briefing had already left before the hold; only the beat follows it.
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  sideband.acknowledge(0, 100, 200);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
  sideband.acknowledge(1, 300, 400);
  sideband.output("Connect your calendar.", 500, 900);
  assert.deepEqual(f.spoken, [
    PROACTIVE_SPEECH_KIND.BRIEFING,
    PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
  ]);
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: f.clock.now });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
});

test("idle reported by the peer closes the session only once the host too has appended nothing in the window, and records the usage", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.deliverBriefing({ briefing: "Fresh.", decidedAt: f.clock.now });
  await drainMicrotasks();
  sideband.acknowledge(0, 100, 200);
  f.clock.now += 60_000;
  f.service.reportActivity(true);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
  f.service.reportActivity(false);
  await f.clock.advance(f.clock.now + LIVE_IDLE_WINDOW_MS);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
  f.service.reportActivity(true);
  await drainMicrotasks();
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
  await drainMicrotasks();
  assert.deepEqual(f.service.status(), {
    phase: LIVE_SESSION_PHASE.CLOSED,
    usageConfirmed: true,
    lastSessionSeconds: 310,
  });
  assert.equal(sideband.closed, true);
  assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CLOSE_REQUESTED);
});

test("an idle report while an exchange is in flight does not close the session", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("Read the transcript.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.clock.now += LIVE_IDLE_WINDOW_MS;
  f.service.reportActivity(true);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
});

test("a graceful close that hears nothing gives up at the timeout with the usage unconfirmed", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.receive({
    type: LIVE_SERVER_EVENT.USAGE_UPDATED,
    event_id: "u1",
    usage: { seconds: 40 },
  });
  const ending = f.service.endSession();
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
  assert.deepEqual(f.clock.delays.at(-1), SIDEBAND_CLOSE_TIMEOUT_MS);
  await f.clock.advance(f.clock.now + SIDEBAND_CLOSE_TIMEOUT_MS);
  await ending;
  assert.deepEqual(f.service.status(), { phase: LIVE_SESSION_PHASE.CLOSED, usageConfirmed: false });
  assert.equal(sideband.closed, true);
});

test("an expired session reopens at once", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.closedBy(LIVE_CLOSE_REASON.EXPIRED, 3600);
  await drainMicrotasks();
  assert.deepEqual(phases(f.changes).slice(-2), [
    LIVE_SESSION_PHASE.CLOSED,
    LIVE_SESSION_PHASE.WANTED,
  ]);
  assert.equal(f.service.status().usageConfirmed, true);
});

test("a lost connection leaves the usage unconfirmed, drops the delivery aimed at the dead session, and reopens only if the microphone was live", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.receive({
    type: LIVE_SERVER_EVENT.USAGE_UPDATED,
    event_id: "u1",
    usage: { seconds: 20 },
  });
  f.service.deliverBriefing({ briefing: "Pending.", decidedAt: f.clock.now });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  sideband.dropConnection();
  await drainMicrotasks();
  assert.equal(f.service.status().usageConfirmed, false);
  assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
  assert.equal(f.changes.at(-1)?.reason, LIVE_CLOSE_REASON.CONNECTION_LOST);
  assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length, 1);
  const second = await f.open();
  assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  second.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "um" });
  second.dropConnection();
  await drainMicrotasks();
  assert.deepEqual(phases(f.changes).slice(-2), [
    LIVE_SESSION_PHASE.CLOSED,
    LIVE_SESSION_PHASE.WANTED,
  ]);
});

test("a failed peer transport is a lost connection; a peer closed without a hang-up asked here closes gracefully", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.reportTransport(LIVE_TRANSPORT_STATE.FAILED);
  await drainMicrotasks();
  assert.equal(f.service.sessionStands(), false);
  assert.equal(f.service.status().usageConfirmed, false);
  const second = await f.open();
  f.service.reportTransport(LIVE_TRANSPORT_STATE.CLOSED);
  await drainMicrotasks();
  assert.equal(appends(second, LIVE_CLIENT_EVENT.CLOSE).length, 1);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 0);
});

test("a reply that finishes after its session closed opens a new one and is spoken there with no delegation", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("Summarize the day.", 0, 900);
  sideband.delegation("item_1", 1000);
  await drainMicrotasks();
  sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 30);
  await drainMicrotasks();
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
    runId: "run-1",
    sentence: "Two sessions finished.",
  });
  await drainMicrotasks();
  assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.WANTED);
  const second = await f.open();
  const commentary = appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(commentary.length, 1);
  assert.equal(
    commentary[0] && "delegation_id" in commentary[0] && commentary[0].delegation_id,
    null,
  );
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
});

test("a line is recorded at the instant its utterance began, so a Clear's cutoff refuses what was begun before it", async () => {
  const f = fixture();
  const sideband = await f.open();
  const began = f.clock.now;
  sideband.output("Two ", 0, 400);
  await f.clock.advance(f.clock.now + 500);
  sideband.output("sessions.", 400, 900);
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal(f.record.luke.length, 1);
  assert.equal(f.record.luke[0]?.recordedAt, began);
});

test("a muted microphone never carries the stop instruction, whether Luke is silent or mid-sentence", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-0" });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
  // The developer's turn ends with Luke silent.
  sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "unmuted-1" });
  sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-1" });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
  // The talk key released while Luke is still answering: the release is a mute and nothing more.
  sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_UNMUTED, event_id: "unmuted-2" });
  sideband.output("Two sessions", 0, 800);
  sideband.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_MUTED, event_id: "muted-2" });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 0);
  assert.equal(sideband.sent.length, 0);
});

test("the stop key sends exactly one instruction with no delegation into the standing session, and nothing when none stands", async () => {
  const f = fixture();
  assert.equal(f.service.stopSpeaking(), false);
  const sideband = await f.open();
  sideband.output("Two sessions", 0, 800);
  assert.equal(f.service.stopSpeaking(), true);
  await drainMicrotasks();
  const instructions = appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND);
  assert.equal(instructions.length, 1);
  const [instruction] = instructions;
  assert.ok(instruction && "delegation_id" in instruction && "content" in instruction);
  assert.equal(instruction.delegation_id, null);
  assert.equal(instruction.content, STOP_SPEAKING_INSTRUCTION);
  const ending = f.service.endSession();
  await drainMicrotasks();
  sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
  await ending;
  assert.equal(f.service.stopSpeaking(), false);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).length, 1);
});

test("both speakers' utterances reach the record after the gap and the settle margin, grouped, once", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("Hello", 0, 400);
  sideband.output("Hi.", 500, 900);
  sideband.input(" there", 400, 800);
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS);
  assert.deepEqual([f.record.developer.length, f.record.luke.length], [0, 0]);
  await f.clock.advance(f.clock.now + UTTERANCE_SETTLE_MARGIN_MS);
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
  await drainMicrotasks();
  assert.deepEqual(
    f.record.developer.map((line) => line.text),
    ["Hello there", "Bye"],
  );
});

test("an utterance that settled before its delegation is written again under the delegation, with its run, and the record decides what the second write means", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("Open the failing one.", 1000, 2200);
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.deepEqual(
    f.record.developer.map((line) => [line.rowId, line.delegationId, line.runId]),
    [[1, null, undefined]],
  );
  f.record.hold();
  sideband.delegation("item_late", 5000);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 1);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
    runId: "run-1",
    sentence: "Opening it.",
  });
  await drainMicrotasks();
  // Nothing is spoken while the delegated write is out: the ask is on record under its delegation first.
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  f.record.release(true);
  await drainMicrotasks();
  assert.deepEqual(
    f.record.developer.map((line) => [line.rowId, line.delegationId, line.runId]),
    [
      [1, null, undefined],
      [1, "item_late", "run-1"],
    ],
  );
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  // The settle timer has nothing more to write for the row.
  await f.clock.advance(f.clock.now + UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS);
  assert.equal(f.record.developer.length, 2);
});

test("a briefing's last append is told to the record before it is sent, once, under the event id the append carries; a beat tells nothing", async () => {
  const f = fixture();
  const told: { briefing: string; eventId: string }[] = [];
  f.onBriefingAppend = (delivery, eventId) => told.push({ briefing: delivery.briefing, eventId });
  const sideband = await f.open();
  const long = Array.from({ length: 40 }, (_, index) => `Sentence ${index} is long enough.`).join(
    " ",
  );
  f.service.deliverBriefing({ briefing: long, decidedAt: f.clock.now });
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING, decidedAt: f.clock.now });
  await drainMicrotasks();
  const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.ok(commentary.length >= 1);
  assert.equal(told.length, 1);
  assert.equal(told[0]?.briefing, long);
  // The id told is the one on the last chunk of the briefing, which is the append whose speech settles it.
  const briefingAppends = commentary.slice(0, commentary.length);
  const lastBriefingChunk = briefingAppends.find((event) => event.event_id === told[0]?.eventId);
  assert.ok(lastBriefingChunk);
});

test("creating a session while one stands closes the standing one first", async () => {
  const f = fixture();
  const first = await f.open();
  const creating = f.service.createSession("offer-2");
  await drainMicrotasks();
  assert.equal(appends(first, LIVE_CLIENT_EVENT.CLOSE).length, 1);
  first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 9);
  const created = await creating;
  assert.equal(created?.sessionId, "sess-2");
  assert.equal(f.creates.length, 2);
});

test("stop closes the session gracefully and takes nothing else with it", async () => {
  const f = fixture();
  const sideband = await f.open();
  const stopping = f.service.stop();
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
  sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 2);
  await stopping;
  assert.equal(f.service.sessionStands(), false);
});

test("a run's reply is appended once per sentence, in order, and nothing of the run is appended after its end", async () => {
  const f = fixture();
  const sideband = await f.open();
  sideband.input("What changed?", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  const sentences = ["One.", "Two.", "Three."];
  for (const sentence of sentences) {
    f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence });
  }
  for (let index = 0; index < sentences.length; index += 1) {
    await drainMicrotasks();
    sideband.acknowledge(index, 1000 + index * 100, 1050 + index * 100);
  }
  await drainMicrotasks();
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
  await f.clock.advance(f.clock.now + 1000);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Late." });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, sentences.length);
});

test("a briefing taken from the queue is appended once: a hold beginning and ending around it re-sends nothing, and a held one is handed back once and appended never", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.deliverBriefing({ briefing: "Already said.", decidedAt: f.clock.now });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  f.quiet = true;
  await f.service.reconcile();
  f.quiet = false;
  await f.service.reconcile();
  await drainMicrotasks();
  assert.deepEqual(f.released, []);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  f.quiet = true;
  await f.service.reconcile();
  const held = { briefing: "Held.", decidedAt: f.clock.now };
  f.service.deliverBriefing(held);
  f.quiet = false;
  await f.service.reconcile();
  await f.service.reconcile();
  await drainMicrotasks();
  assert.deepEqual(f.released, [[held]]);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
});

test("an append pending when the session dies is dropped with it and never re-sent into the session opened after", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.speakBeat({ kind: PROACTIVE_SPEECH_KIND.ARRIVAL, decidedAt: f.clock.now });
  sideband.input("Summarize.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Done." });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  sideband.dropConnection();
  await drainMicrotasks();
  assert.equal(f.traces.filter((t) => t.decision === LIVE_TRACE_DECISION.APPEND_REFUSED).length, 1);
  assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSED);
  const second = await f.open();
  await drainMicrotasks();
  assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  assert.deepEqual(f.spoken, []);
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    end: LIVE_BRAIN_RUN_END.COMPLETED,
  });
  await f.clock.advance(f.clock.now + 1000);
  assert.equal(appends(second, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
});

test("run events landing while the ask's record write is out are deferred, then spoken in order once the record holds the ask", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.record.hold();
  sideband.input("Ship it.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 1);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Shipped." });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Green." });
  await drainMicrotasks();
  assert.equal(f.record.developer.length, 0);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  f.record.release(true);
  await drainMicrotasks();
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
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 2);
});

test("a run that ends during the ask's record write is finalized once the write lands, its end spoken as the standing note", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.record.hold();
  sideband.input("Do the thing.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    end: LIVE_BRAIN_RUN_END.FAILED,
  });
  await f.clock.advance(f.clock.now + 1000);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  f.record.release(true);
  await drainMicrotasks();
  await f.clock.advance(f.clock.now + 1000);
  const commentary = appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
  assert.equal(commentary.length, 1);
  assert.equal(
    commentary[0] && "content" in commentary[0] && commentary[0].content,
    RUN_END_NOTE[LIVE_BRAIN_RUN_END.FAILED],
  );
});

test("an ask whose record write fails is answered with the unrecorded note once, and its run's later events reach nothing", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.record.hold();
  sideband.input("Send it.", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Sent." });
  f.record.release(false);
  await drainMicrotasks();
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
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Late." });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    end: LIVE_BRAIN_RUN_END.FAILED,
  });
  await f.clock.advance(f.clock.now + 1000);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  assert.equal(f.record.developer.length, 0);
});

test("a steered ask whose sibling's record write fails is settled once every write is in: one unrecorded note, nothing spoken", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.record.hold();
  sideband.input("What failed?", 0, 800);
  sideband.delegation("item_1", 900);
  await drainMicrotasks();
  sideband.input("In the API repo.", 5000, 5800);
  sideband.delegation("item_2", 5900);
  await drainMicrotasks();
  assert.equal(f.brain.asks.length, 2);
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  f.brain.fire({
    kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
    runId: "run-2",
    sentence: "Two tests.",
  });
  f.record.release(false);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 0);
  f.record.release(true);
  await drainMicrotasks();
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
  f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-2", sentence: "Late." });
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, 1);
  assert.equal(f.record.developer.length, 1);
});

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

test("a created session opens knowing the desk: the roster leads the input as one developer message, ahead of the conversation", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  f.entries.push(
    { kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" },
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet." },
  );
  await f.service.createSession("offer");
  assert.deepEqual(
    f.seeds[0]?.map((item) => item.role),
    [SEED_ROLE.DEVELOPER, SEED_ROLE.USER, SEED_ROLE.ASSISTANT],
  );
  assert.equal(f.seeds[0]?.[0]?.content[0]?.text, rosterSeed(f.roster, f.clock.now)?.text);
});

test("an empty desk puts no roster message into the input at all", async () => {
  const f = fixture();
  f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "what needs me?" });
  await f.service.createSession("offer");
  assert.deepEqual(
    f.seeds[0]?.map((item) => item.role),
    [SEED_ROLE.USER],
  );
});

test("the roster message is counted against the input's own bounds, and the conversation is what fills what is left", async () => {
  const f = fixture();
  for (let index = 0; index < 10; index += 1) {
    f.roster.push(rosterSession(`s${index}`, { title: "x".repeat(500) }));
  }
  for (let index = 0; index < 200; index += 1) {
    f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "y".repeat(400) });
  }
  await f.service.createSession("offer");
  const seed = f.seeds[0];
  assert.ok(seed);
  assert.equal(seed[0]?.role, SEED_ROLE.DEVELOPER);
  assert.equal(seed[0]?.content[0]?.text, rosterSeed(f.roster, f.clock.now)?.text);
  assert.ok(seed.length <= LIVE_INPUT_BOUNDS.MESSAGES);
  assert.ok(seedItemTokens(seed) <= LIVE_INPUT_BOUNDS.TOKENS);
});

test("a moved desk reaches the standing session as one thinking append with no delegation, once the change has settled", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.service.updateRoster([rosterSession("a")]);
  f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(sent.length, 1);
  const only = sent[0];
  assert.ok(only && "delegation_id" in only);
  assert.equal(only.delegation_id, null);
});

test("a roster that comes back reading the same appends nothing", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  const sideband = await f.open();
  f.service.updateRoster([rosterSession("a")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
});

test("a desk that moves between a session's creation and its start is told at the start, not dropped", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  const created = await f.service.createSession("offer");
  assert.ok(created);
  const sideband = f.sidebands[0];
  assert.ok(sideband);
  f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
  sideband.started(created.sessionId);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
});

test("a change the seed's own read has already superseded is discarded, never told back as news", async () => {
  const f = fixture();
  f.service.updateRoster([rosterSession("a")]);
  f.roster.push(rosterSession("a"), rosterSession("b"));
  const sideband = await f.open();
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 0);
});

test("a desk that empties withdraws what the session was told rather than leaving it standing", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  const sideband = await f.open();
  f.service.updateRoster([]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(sent.length, 1);
  const only = sent[0];
  assert.ok(only && "content" in only);
  assert.equal(
    only.content,
    rosterUpdate(rosterSeed(f.roster, f.clock.now)?.told, [], f.clock.now)?.text,
  );
});

test("a refresh the session refused is not recorded as told, so the withdrawal it carried is sent again", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  const sideband = await f.open();
  sideband.acknowledgeThinkingAtOnce = false;
  f.service.updateRoster([]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  const refused = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(refused.length, 1);
  // The append is never acknowledged, so the channel counts it as not taken.
  await f.clock.advance(f.clock.now + 10_000);
  await drainMicrotasks();
  sideband.acknowledgeThinkingAtOnce = true;
  f.service.updateRoster([]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  const sent = appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND);
  assert.equal(sent.length, 2);
  const first = sent[0];
  const second = sent[1];
  assert.ok(first && "content" in first && second && "content" in second);
  assert.equal(second.content, first.content);
});

test("a change that lands while a refresh is still in flight is decided against what the session will know by then", async () => {
  const f = fixture();
  f.roster.push(rosterSession("a"));
  const sideband = await f.open();
  sideband.acknowledgeThinkingAtOnce = false;
  // The first refresh puts b on the desk and is left unacknowledged, so it is
  // still in flight when the second takes b away again.
  f.service.updateRoster([rosterSession("a"), rosterSession("b")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
  f.service.updateRoster([rosterSession("a")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  sideband.acknowledge(0, 0, 0);
  await drainMicrotasks();
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
});

test("a desk that moves while no session stands opens none and sends nothing", async () => {
  const f = fixture();
  f.service.updateRoster([rosterSession("a")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.deepEqual(f.creates, []);
  assert.equal(f.service.sessionStands(), false);
});

test("a roster append does not keep a quiet session open: the idle clock reads the appends the session is worth staying open for", async () => {
  const f = fixture();
  const sideband = await f.open();
  f.clock.now += LIVE_IDLE_WINDOW_MS;
  f.service.updateRoster([rosterSession("a")]);
  await f.clock.advance(f.clock.now + ROSTER_DEBOUNCE_MS);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).length, 1);
  f.service.reportActivity(true);
  await drainMicrotasks();
  assert.equal(appends(sideband, LIVE_CLIENT_EVENT.CLOSE).length, 1);
});
