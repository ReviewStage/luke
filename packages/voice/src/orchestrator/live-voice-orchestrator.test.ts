import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@sidecar/gateway";
import { LIVE_CLOSE_REASON, LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntryKind } from "@sidecar/session";
import { Context, Deferred, Effect, Fiber } from "effect";
import type {
  LiveCaptionRow,
  LiveVoiceCall,
  LiveVoiceCallEvents,
  LiveVoiceCallOpening,
  LiveVoiceSpeakers,
} from "./live-voice-call.js";
import {
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
  type LiveVoiceView,
} from "./live-voice-orchestrator.js";

const INVITES_PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING_PLAN = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** The id a call carries once it has started; naming one is saying it started. */
function sessionIdOf(call: FakeCall): string {
  assert.ok(call.sessionId);
  return call.sessionId;
}

/** A call that records the verbs it was asked and answers for its status. */
let sessions = 0;

class FakeCall implements LiveVoiceCall {
  status: LiveStatus = LIVE_STATUS.IDLE;
  sessionId: string | undefined;
  opens = 0;
  /** What the call was told it was opened about. */
  openings: LiveVoiceCallOpening[] = [];
  unmutes = 0;
  mutes = 0;
  /** How many times Luke's playback was silenced on this device. */
  silences = 0;
  closes = 0;
  opensSucceed = true;
  /** Where closing waits before it is done, as a real peer's close does. */
  closing: Effect.Effect<void> = Effect.void;
  #release: (() => void) | undefined;

  constructor(readonly events: LiveVoiceCallEvents) {}

  /**
   * As the real call answers it: no peer stands until the session is
   * answered, so a connecting call is not standing, and the peer stands
   * through its close until the close is done.
   */
  get standing(): boolean {
    return (
      this.status === LIVE_STATUS.MUTED ||
      this.status === LIVE_STATUS.LISTENING ||
      this.status === LIVE_STATUS.SPEAKING ||
      this.status === LIVE_STATUS.CLOSING
    );
  }

  open(opening: LiveVoiceCallOpening): Effect.Effect<boolean> {
    this.opens += 1;
    this.openings.push(opening);
    this.settle(LIVE_STATUS.CONNECTING);
    return Effect.callback<boolean>((resume) => {
      this.#release = () => {
        if (this.opensSucceed) this.settle(LIVE_STATUS.MUTED);
        else this.settle(LIVE_STATUS.FAILED);
        resume(Effect.succeed(this.opensSucceed));
      };
    });
  }

  /** The session started, or refused to; a started one is named in the order it opened. */
  started(): void {
    if (this.opensSucceed) this.sessionId = `s${++sessions}`;
    this.#release?.();
    this.#release = undefined;
  }

  /** As the real call answers it: a call closing hears nothing more. */
  unmute(): Effect.Effect<boolean> {
    if (this.status === LIVE_STATUS.CLOSING) return Effect.succeed(false);
    this.unmutes += 1;
    this.settle(LIVE_STATUS.LISTENING);
    return Effect.succeed(true);
  }

  mute(): Effect.Effect<boolean> {
    this.mutes += 1;
    this.settle(LIVE_STATUS.MUTED);
    return Effect.succeed(true);
  }

  silenceOutput(): void {
    this.silences += 1;
  }

  /** Closing until `closing` is done, as a real peer's close is, then idle. */
  close(): Effect.Effect<void> {
    this.closes += 1;
    this.settle(LIVE_STATUS.CLOSING);
    return Effect.andThen(
      this.closing,
      Effect.sync(() => this.settle(LIVE_STATUS.IDLE)),
    );
  }

  /** A status and the speakers it implies, which is every edge but a full-duplex one. */
  settle(status: LiveStatus): void {
    this.report(status, {
      listening: status === LIVE_STATUS.LISTENING,
      lukeSpeaking: status === LIVE_STATUS.SPEAKING,
    });
  }

  /** Both speakers at once, which no status can carry: the microphone is open under Luke's own answer. */
  report(status: LiveStatus, speakers: LiveVoiceSpeakers): void {
    this.status = status;
    this.events.onStatus(status, speakers);
  }
}

const SURROUNDINGS: LiveVoiceSurroundings = {
  voiceAvailable: true,
  captionsEnabled: true,
  outputSilent: false,
  microphoneGranted: true,
};

function fixture(surroundings: Partial<LiveVoiceSurroundings> = {}) {
  const calls: FakeCall[] = [];
  const views: LiveVoiceView[] = [];
  /** Whether each report was the one an exchange opened on. */
  const openings: boolean[] = [];
  let microphoneGranted = true;
  let microphoneAsks = 0;
  let microphoneAsk: (() => Effect.Effect<boolean>) | undefined;
  const stops: number[] = [];
  const silencedAtStops: number[] = [];
  const orchestrator = new LiveVoiceOrchestrator({
    services: Context.empty(),
    bridge: {
      reportView: (view, exchange) => {
        views.push(view);
        openings.push(exchange);
      },
      requestMicrophone: () =>
        Effect.suspend(() => {
          microphoneAsks += 1;
          return microphoneAsk ? microphoneAsk() : Effect.succeed(microphoneGranted);
        }),
      hostedUnavailableNote: () => Effect.succeed(undefined),
      stopSpeaking: () =>
        Effect.sync(() => {
          stops.push(calls[calls.length - 1]?.mutes ?? 0);
          silencedAtStops.push(calls[calls.length - 1]?.silences ?? 0);
          return true;
        }),
    },
    createCall: (events) => {
      const call = new FakeCall(events);
      calls.push(call);
      return call;
    },
  });
  orchestrator.surround({ ...SURROUNDINGS, ...surroundings });
  return {
    surround: (next: LiveVoiceSurroundings) => orchestrator.surround(next),
    beginTalk: (planId?: string) => orchestrator.beginTalk(planId),
    talkAboutPlan: (planId: string) => orchestrator.talkAboutPlan(planId),
    endTalk: () => orchestrator.endTalk(),
    stopSpeaking: () => orchestrator.stopSpeaking(),
    stopCall: () => orchestrator.stopCall(),
    stop: () => orchestrator.stop(),
    /** The host's word, started on its own fiber the way the window's subscription starts it. */
    obey: (change: VoiceLiveSessionChanged) =>
      Effect.forkDetach(orchestrator.obeySessionChange(change), { startImmediately: true }),
    calls,
    views,
    openings,
    setMicrophone: (granted: boolean) => {
      microphoneGranted = granted;
    },
    /** The system's dialog standing: the ask answers when the test says so. */
    setMicrophoneAsk: (ask: () => Effect.Effect<boolean>) => {
      microphoneAsk = ask;
    },
    microphoneAsks: () => microphoneAsks,
    /** The call's mute count at each moment the host was told to stop: what was sent first. */
    stops,
    /** The call's silence count at each moment the host was told to stop: whether Luke went quiet first. */
    silencedAtStops,
    latest: () => calls[calls.length - 1],
  };
}

/**
 * Lets the orchestrator's own forked fibers, under no services of their own,
 * run their queued microtasks: a spin on the microtask queue and no timer,
 * since what is waited for is a fiber of the orchestrator's and not time.
 */
function settleFibers(ticks = 30): Effect.Effect<void> {
  return Effect.promise(async () => {
    for (let turn = 0; turn < ticks; turn += 1) await Promise.resolve();
  });
}

function row(
  rowId: string,
  kind: ConversationEntryKind,
  words: string,
  settled = false,
): LiveCaptionRow {
  return { rowId, entry: { kind, words }, startMs: 0, endMs: 1_000, settled };
}

it.effect(
  "the talk key's press opens a session about the plan when none stands and unmutes it once started; its release mutes once",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      assert.equal(call.opens, 1);
      assert.deepEqual(call.openings, [{ planId: INVITES_PLAN }]);
      assert.equal(call.unmutes, 0);
      call.started();
      yield* Fiber.join(pressed);
      assert.equal(call.unmutes, 1);
      assert.equal(call.mutes, 0);
      assert.equal(call.status, LIVE_STATUS.LISTENING);
      yield* f.endTalk();
      assert.equal(call.mutes, 1);
      assert.equal(call.opens, 1);
      assert.equal(f.calls.length, 1);
      // A release with no press behind it does nothing.
      yield* f.endTalk();
      assert.equal(call.mutes, 1);
      // The next hold against the standing session, naming no plan: no second session, one more unmute, one more mute.
      yield* f.beginTalk();
      assert.equal(f.calls.length, 1);
      assert.equal(call.unmutes, 2);
      assert.equal(call.mutes, 1);
      yield* f.endTalk();
      assert.equal(call.mutes, 2);
    }),
);

it.effect("a second press while the developer is heard never mutes", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    f.latest()?.started();
    yield* Fiber.join(pressed);
    yield* f.beginTalk();
    yield* f.beginTalk();
    const call = f.latest();
    assert.ok(call);
    assert.equal(call.mutes, 0);
    assert.equal(call.status, LIVE_STATUS.LISTENING);
  }),
);

it.effect("a release while the press's session is still opening leaves it to open muted", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    assert.equal(call.standing, false);
    yield* f.endTalk();
    call.started();
    yield* Fiber.join(pressed);
    // The release's mute still goes once the session stands: the press's device rode the offer.
    assert.equal(call.unmutes, 0);
    assert.equal(call.mutes, 1);
    assert.equal(call.status, LIVE_STATUS.MUTED);
  }),
);

it.effect(
  "the stop key mutes a standing session once, does nothing against none, and ends the hold so the release mutes nothing more",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      assert.equal(yield* f.stopSpeaking(), false);
      assert.deepEqual(f.stops, []);
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      f.latest()?.started();
      yield* Fiber.join(pressed);
      assert.equal(yield* f.stopSpeaking(), true);
      assert.equal(f.latest()?.mutes, 1);
      yield* f.endTalk();
      assert.equal(f.latest()?.mutes, 1);
    }),
);

it.effect(
  "the stop key tells the host to stop only while Luke is speaking, and before it mutes",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      assert.equal(call.status, LIVE_STATUS.LISTENING);
      assert.equal(yield* f.stopSpeaking(), true);
      assert.deepEqual(f.stops, []);
      assert.equal(call.mutes, 1);
      assert.equal(call.silences, 0);
      call.settle(LIVE_STATUS.SPEAKING);
      assert.equal(yield* f.stopSpeaking(), true);
      assert.deepEqual(f.stops, [1]);
      assert.equal(call.mutes, 2);
      // Luke is silenced on the Mac before the model is even told.
      assert.deepEqual(f.silencedAtStops, [1]);
    }),
);

it.effect("the talk key's release mutes and never tells the host to stop", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    f.latest()?.started();
    yield* Fiber.join(pressed);
    yield* f.endTalk();
    assert.equal(f.latest()?.mutes, 1);
    assert.deepEqual(f.stops, []);
  }),
);

it.effect("the talk key's release while Luke answers leaves his voice playing", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    call.started();
    yield* Fiber.join(pressed);
    call.report(LIVE_STATUS.SPEAKING, { listening: true, lukeSpeaking: true });
    yield* f.endTalk();
    assert.equal(call.mutes, 1);
    assert.equal(call.silences, 0);
  }),
);

it.effect("a press without the microphone asks for it, and a refusal opens nothing", () =>
  Effect.gen(function* () {
    const f = fixture({ microphoneGranted: false });
    f.setMicrophone(false);
    yield* f.beginTalk(INVITES_PLAN);
    assert.equal(f.microphoneAsks(), 1);
    assert.equal(f.calls.length, 0);
    yield* settleFibers();
    assert.notEqual(f.views.at(-1)?.voiceError, undefined);
    f.setMicrophone(true);
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    yield* settleFibers();
    assert.equal(f.calls.length, 1);
    f.latest()?.started();
    yield* Fiber.join(pressed);
    assert.equal(f.latest()?.unmutes, 1);
  }),
);

it.effect("a key let go of while the microphone dialog stands opens the session muted", () =>
  Effect.gen(function* () {
    const f = fixture({ microphoneGranted: false });
    let grant: ((granted: boolean) => void) | undefined;
    f.setMicrophoneAsk(() =>
      Effect.callback<boolean>((resume) => {
        grant = (granted) => resume(Effect.succeed(granted));
      }),
    );
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    yield* settleFibers();
    yield* f.endTalk();
    grant?.(true);
    yield* Fiber.join(pressed);
    assert.equal(f.calls.length, 0);
  }),
);

it.effect("a press while voice is off opens nothing", () =>
  Effect.gen(function* () {
    const f = fixture({ voiceAvailable: false });
    yield* f.beginTalk(INVITES_PLAN);
    assert.equal(f.calls.length, 0);
  }),
);

it.effect(
  "a session that refuses to open leaves no call standing, and the next press opens another",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const first = f.latest();
      assert.ok(first);
      first.opensSucceed = false;
      first.started();
      yield* Fiber.join(pressed);
      assert.equal(first.unmutes, 0);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.FAILED);
      const again = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
      assert.equal(f.calls.length, 2);
      f.latest()?.started();
      yield* Fiber.join(again);
    }),
);

it.effect(
  "the view reports each edge once, counts the exchange on its opening edge, and carries the captions",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* settleFibers();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      yield* settleFibers();
      assert.deepEqual(
        f.views.map((view) => view.voiceStatus),
        [LIVE_STATUS.IDLE, LIVE_STATUS.CONNECTING],
      );
      assert.deepEqual(f.openings, [false, true]);
      assert.equal(f.views.at(-1)?.talkOpening, true);
      call.started();
      yield* Fiber.join(pressed);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.LISTENING);
      assert.equal(f.views.at(-1)?.talkOpening, false);
      // Both speakers' rows still being spoken are the captions; Luke's while he speaks.
      call.events.onCaptions([
        row("row-1", CONVERSATION_ENTRY_KIND.ASK, "what needs me"),
        row("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Two sessions"),
      ]);
      call.settle(LIVE_STATUS.SPEAKING);
      yield* settleFibers();
      const speaking = f.views.at(-1);
      assert.deepEqual(speaking?.lukeCaptions, ["Two sessions"]);
      assert.deepEqual(speaking?.developerCaptions, ["what needs me"]);
      // A settled row of the developer's leaves their captions.
      call.events.onCaptions([
        row("row-1", CONVERSATION_ENTRY_KIND.ASK, "what needs me", true),
        row("row-2", CONVERSATION_ENTRY_KIND.REPLY, "Two sessions finished"),
      ]);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.developerCaptions, undefined);
      // The count rose once for the whole exchange.
      assert.equal(f.openings.filter(Boolean).length, 1);
    }),
);

it.effect(
  "captions are withheld when neither the preference nor a silent output asks for them",
  () =>
    Effect.gen(function* () {
      const f = fixture({ captionsEnabled: false, outputSilent: false });
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.events.onCaptions([row("row-1", CONVERSATION_ENTRY_KIND.REPLY, "Two sessions")]);
      call.settle(LIVE_STATUS.SPEAKING);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.lukeCaptions, undefined);
      f.surround({ ...SURROUNDINGS, captionsEnabled: false, outputSilent: true });
      yield* settleFibers();
      assert.deepEqual(f.views.at(-1)?.lukeCaptions, ["Two sessions"]);
    }),
);

it.effect(
  "the developer's captions follow the captions preference alone, whatever the output",
  () =>
    Effect.gen(function* () {
      const f = fixture({ captionsEnabled: false, outputSilent: true });
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.events.onCaptions([row("row-1", CONVERSATION_ENTRY_KIND.ASK, "what needs me")]);
      yield* settleFibers();
      // A silent output is a reason to read Luke, not the developer, who said the words.
      assert.equal(f.views.at(-1)?.developerCaptions, undefined);
      f.surround({ ...SURROUNDINGS, captionsEnabled: true, outputSilent: false });
      yield* settleFibers();
      assert.deepEqual(f.views.at(-1)?.developerCaptions, ["what needs me"]);
      // The row settling is what takes the words down, not the microphone closing.
      call.events.onCaptions([row("row-1", CONVERSATION_ENTRY_KIND.ASK, "what needs me", true)]);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.developerCaptions, undefined);
    }),
);

it.effect(
  "voice turning off closes the standing session, and stop closes it and reports nothing after",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      f.surround({ ...SURROUNDINGS, voiceAvailable: false });
      yield* settleFibers();
      assert.equal(call.closes, 1);
      const g = fixture();
      const opened = yield* Effect.forkChild(g.beginTalk(INVITES_PLAN), { startImmediately: true });
      g.latest()?.started();
      yield* Fiber.join(opened);
      yield* settleFibers();
      const reports = g.views.length;
      yield* g.stop();
      yield* settleFibers();
      assert.equal(g.latest()?.closes, 1);
      assert.equal(g.views.length, reports);
    }),
);

it.effect(
  "an ended session releases once, whether it ends itself or stop interrupts it afterward",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      // The call ends itself, without the orchestrator having asked it to.
      call.settle(LIVE_STATUS.IDLE);
      yield* settleFibers();
      assert.equal(call.closes, 1);
      yield* f.stop();
      yield* settleFibers();
      assert.equal(call.closes, 1);
    }),
);

it.effect("stop interrupts a call still opening, and releases it once the open settles", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    assert.equal(call.closes, 0);
    const stopped = yield* Effect.forkChild(f.stop(), { startImmediately: true });
    call.started();
    yield* Fiber.join(pressed);
    yield* Fiber.join(stopped);
    yield* settleFibers();
    assert.equal(call.closes, 1);
  }),
);

it.effect(
  "the host closing an older session leaves a call still waiting for its own answer standing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      // The host hung up the session it still held before creating this one.
      yield* f.obey({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: "old" });
      yield* f.obey({
        phase: LIVE_SESSION_PHASE.CLOSED,
        sessionId: "old",
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      });
      yield* settleFibers();
      assert.equal(call.closes, 0);
      call.started();
      yield* Fiber.join(pressed);
      assert.equal(call.unmutes, 1);
      // Still driven: the stop key reaches it.
      assert.equal(yield* f.stopSpeaking(), true);
      assert.equal(call.mutes, 1);
    }),
);

it.effect("a stop while a press's session is still opening leaves it muted", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    assert.equal(call.standing, false);
    assert.equal(yield* f.stopSpeaking(), true);
    call.started();
    yield* Fiber.join(pressed);
    assert.equal(call.unmutes, 0);
    assert.equal(call.mutes, 1);
    assert.equal(call.status, LIVE_STATUS.MUTED);
  }),
);

it.effect("a session pausing between Luke's sentences is one exchange, counted once", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    call.started();
    yield* Fiber.join(pressed);
    call.settle(LIVE_STATUS.SPEAKING);
    yield* settleFibers();
    call.settle(LIVE_STATUS.MUTED);
    yield* settleFibers();
    call.settle(LIVE_STATUS.SPEAKING);
    yield* settleFibers();
    assert.equal(f.openings.filter(Boolean).length, 1);
  }),
);

it.effect(
  "both speakers stand together in the view, and a speaker moving under a still status is reported",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      yield* settleFibers();
      const listening = f.views.at(-1);
      assert.equal(listening?.listening, true);
      assert.equal(listening?.lukeSpeaking, false);
      // Luke answering over the open microphone: the status names him, and the
      // developer is still being heard.
      call.report(LIVE_STATUS.SPEAKING, { listening: true, lukeSpeaking: true });
      yield* settleFibers();
      const both = f.views.at(-1);
      assert.equal(both?.voiceStatus, LIVE_STATUS.SPEAKING);
      assert.equal(both?.listening, true);
      assert.equal(both?.lukeSpeaking, true);
      const reports = f.views.length;
      // The key coming up under the same answer moves no status, and is still a view.
      call.report(LIVE_STATUS.SPEAKING, { listening: false, lukeSpeaking: true });
      yield* settleFibers();
      assert.equal(f.views.length, reports + 1);
      assert.equal(f.views.at(-1)?.listening, false);
      assert.equal(f.views.at(-1)?.lukeSpeaking, true);
    }),
);

it.effect(
  "the host's closing hangs the standing call up, and a closing naming another session is not this call's",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      yield* f.obey({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: "another" });
      yield* settleFibers();
      assert.equal(call.closes, 0);
      yield* f.obey({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: sessionIdOf(call) });
      yield* settleFibers();
      assert.equal(call.closes, 1);
    }),
);

it.effect(
  "a press while the host is closing the call waits for it to go, then is heard on a new call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const closingCall = f.latest();
      assert.ok(closingCall);
      closingCall.started();
      yield* Fiber.join(pressed);
      yield* f.endTalk();
      // The host decides the end, and the peer's close is slow to finish.
      const closed = yield* Deferred.make<void>();
      closingCall.closing = Deferred.await(closed);
      yield* f.obey({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: sessionIdOf(closingCall) });
      yield* settleFibers();
      assert.equal(closingCall.status, LIVE_STATUS.CLOSING);

      const again = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      yield* settleFibers();
      // Nothing is spoken into the call going away, and nothing new opens before it has gone.
      assert.equal(f.calls.length, 1);
      assert.equal(closingCall.unmutes, 1);
      yield* Deferred.succeed(closed, undefined);
      yield* settleFibers();
      const next = f.latest();
      assert.ok(next);
      assert.notEqual(next, closingCall);
      assert.deepEqual(next.openings, [{ planId: INVITES_PLAN }]);
      next.started();
      yield* Fiber.join(again);
      assert.equal(next.unmutes, 1);
      assert.equal(next.status, LIVE_STATUS.LISTENING);
    }),
);

it.effect(
  "a call the host closed while its peer is still hanging up leaves the call opened meanwhile standing when that hang-up finally ends",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      const old = f.latest();
      assert.ok(old);
      old.started();
      yield* Fiber.join(pressed);
      yield* f.endTalk();
      const torn = yield* Deferred.make<void>();
      old.closing = Deferred.await(torn);
      const oldSession = sessionIdOf(old);
      yield* f.obey({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: oldSession });
      yield* settleFibers();
      const again = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), {
        startImmediately: true,
      });
      yield* settleFibers();
      // The host's own close lands before the peer's slow one does.
      yield* f.obey({
        phase: LIVE_SESSION_PHASE.CLOSED,
        sessionId: oldSession,
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      });
      yield* settleFibers();
      const next = f.latest();
      assert.ok(next);
      assert.notEqual(next, old);
      next.started();
      yield* Fiber.join(again);
      assert.equal(next.status, LIVE_STATUS.LISTENING);

      // The old peer's teardown, long after, is no word about the call standing now.
      yield* Deferred.succeed(torn, undefined);
      yield* settleFibers();
      assert.equal(old.status, LIVE_STATUS.IDLE);
      assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.LISTENING);
      assert.equal(f.views.at(-1)?.callPlanId, INVITES_PLAN);
      yield* f.endTalk();
      assert.equal(next.mutes, 1);
      assert.equal(next.closes, 0);
    }),
);

it.effect("a session lost while both speakers stood leaves nobody heard and opens nothing", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
    const first = f.latest();
    assert.ok(first);
    first.started();
    yield* Fiber.join(pressed);
    first.report(LIVE_STATUS.SPEAKING, { listening: true, lukeSpeaking: true });
    const lost = sessionIdOf(first);
    first.settle(LIVE_STATUS.IDLE);
    yield* f.obey({
      phase: LIVE_SESSION_PHASE.CLOSED,
      sessionId: lost,
      reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
    });
    yield* settleFibers();
    assert.equal(f.calls.length, 1);
    // Nobody is heard on a call that is gone, whatever it was carrying when it went.
    assert.equal(f.views.at(-1)?.lukeSpeaking, false);
    assert.equal(f.views.at(-1)?.listening, false);
  }),
);

it.effect(
  "the planning button opens a call about its plan and hears it; the next press mutes it and the one after hears it again, on the same call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      assert.deepEqual(call.openings, [{ planId: INVITES_PLAN }]);
      call.started();
      yield* Fiber.join(pressed);
      assert.equal(call.status, LIVE_STATUS.LISTENING);

      yield* f.talkAboutPlan(INVITES_PLAN);
      assert.equal(call.status, LIVE_STATUS.MUTED);
      yield* f.talkAboutPlan(INVITES_PLAN);
      assert.equal(call.status, LIVE_STATUS.LISTENING);
      assert.equal(f.calls.length, 1);
    }),
);

it.effect(
  "the stop ends a planning call at once, telling the host to stop Luke before it mutes, and the next press opens a new call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.stopCall();
      assert.deepEqual(f.stops, []);
      const pressed = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.settle(LIVE_STATUS.SPEAKING);

      yield* f.stopCall();
      assert.deepEqual(f.stops, [0]);
      assert.deepEqual(f.silencedAtStops, [1]);
      assert.equal(call.mutes, 1);
      assert.equal(call.status, LIVE_STATUS.IDLE);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.IDLE);
      assert.equal(f.views.at(-1)?.callPlanId, undefined);

      const again = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
        startImmediately: true,
      });
      const next = f.latest();
      assert.ok(next && next !== call);
      next.started();
      yield* Fiber.join(again);
      assert.equal(next.status, LIVE_STATUS.LISTENING);
    }),
);

it.effect(
  "a planning press over another plan's call hangs that call up before opening one about its plan, and the talk key naming no plan speaks into the plan's call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const invites = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
        startImmediately: true,
      });
      const invitesCall = f.latest();
      assert.ok(invitesCall);
      assert.deepEqual(invitesCall.openings, [{ planId: INVITES_PLAN }]);
      invitesCall.started();
      yield* Fiber.join(invites);
      assert.equal(invitesCall.status, LIVE_STATUS.LISTENING);

      // The talk key's hold is heard on the plan's call rather than opening another.
      yield* f.talkAboutPlan(INVITES_PLAN);
      yield* f.beginTalk();
      assert.equal(f.latest(), invitesCall);
      assert.equal(invitesCall.status, LIVE_STATUS.LISTENING);
      yield* f.endTalk();

      const billing = yield* Effect.forkChild(f.talkAboutPlan(BILLING_PLAN), {
        startImmediately: true,
      });
      yield* settleFibers();
      assert.equal(invitesCall.status, LIVE_STATUS.IDLE);
      const billingCall = f.latest();
      assert.ok(billingCall && billingCall !== invitesCall);
      assert.deepEqual(billingCall.openings, [{ planId: BILLING_PLAN }]);
      billingCall.started();
      yield* Fiber.join(billing);
      assert.equal(billingCall.status, LIVE_STATUS.LISTENING);
      yield* settleFibers();
      assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.LISTENING);
    }),
);

it.effect(
  "a talk key press naming the open plan opens a call about it, and over another plan's call hangs that call up first",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const billing = yield* Effect.forkChild(f.beginTalk(BILLING_PLAN), {
        startImmediately: true,
      });
      const billingCall = f.latest();
      assert.ok(billingCall);
      billingCall.started();
      yield* Fiber.join(billing);
      yield* f.endTalk();

      const held = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
      yield* settleFibers();
      assert.equal(billingCall.status, LIVE_STATUS.IDLE);
      const planCall = f.latest();
      assert.ok(planCall && planCall !== billingCall);
      assert.deepEqual(planCall.openings, [{ planId: INVITES_PLAN }]);
      planCall.started();
      yield* Fiber.join(held);
      assert.equal(planCall.status, LIVE_STATUS.LISTENING);
      // Still held to talk: the release mutes the plan's call and leaves it standing.
      yield* f.endTalk();
      assert.equal(planCall.status, LIVE_STATUS.MUTED);
      yield* f.beginTalk(INVITES_PLAN);
      assert.equal(f.latest(), planCall);
      assert.equal(planCall.status, LIVE_STATUS.LISTENING);
    }),
);

it.effect(
  "a talk key let go of while another plan's call is still hanging up opens no plan call",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const billing = yield* Effect.forkChild(f.beginTalk(BILLING_PLAN), {
        startImmediately: true,
      });
      const billingCall = f.latest();
      assert.ok(billingCall);
      billingCall.started();
      yield* Fiber.join(billing);
      yield* f.endTalk();

      const closed = yield* Deferred.make<void>();
      billingCall.closing = Deferred.await(closed);
      const held = yield* Effect.forkChild(f.beginTalk(INVITES_PLAN), { startImmediately: true });
      yield* settleFibers();
      yield* f.endTalk();
      yield* Deferred.succeed(closed, undefined);
      yield* settleFibers();
      assert.equal(billingCall.status, LIVE_STATUS.IDLE);
      assert.equal(f.latest(), billingCall);
      yield* Fiber.join(held);
    }),
);

it.effect("a planning call lost while heard leaves the view naming no plan once it is gone", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
      startImmediately: true,
    });
    const planCall = f.latest();
    assert.ok(planCall);
    planCall.started();
    yield* Fiber.join(pressed);
    yield* settleFibers();
    assert.equal(f.views.at(-1)?.callPlanId, INVITES_PLAN);

    const lost = yield* f.obey({
      phase: LIVE_SESSION_PHASE.CLOSED,
      sessionId: sessionIdOf(planCall),
      reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
    });
    yield* Fiber.join(lost);
    yield* settleFibers();
    assert.equal(f.views.at(-1)?.callPlanId, undefined);
  }),
);

it.effect(
  "the talk key naming no plan opens nothing while no call stands, and speaks into a plan's call that does",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      yield* f.beginTalk();
      assert.equal(f.calls.length, 0);
      assert.equal(f.microphoneAsks(), 0);
      yield* f.endTalk();

      const opened = yield* Effect.forkChild(f.talkAboutPlan(INVITES_PLAN), {
        startImmediately: true,
      });
      const planCall = f.latest();
      assert.ok(planCall);
      planCall.started();
      yield* Fiber.join(opened);
      yield* f.talkAboutPlan(INVITES_PLAN);
      assert.equal(planCall.status, LIVE_STATUS.MUTED);

      yield* f.beginTalk();
      assert.equal(f.calls.length, 1);
      assert.equal(planCall.status, LIVE_STATUS.LISTENING);
    }),
);
