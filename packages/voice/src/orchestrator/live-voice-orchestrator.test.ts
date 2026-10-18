import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { VoiceLiveSessionChanged } from "@luke/gateway";
import { LIVE_STATUS, type LiveStatus } from "@luke/live";
import { Context, Effect, Fiber } from "effect";
import type {
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

const INVITES_TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

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
    beginTalk: (taskId?: string) => orchestrator.beginTalk(taskId),
    talkAboutTask: (taskId: string) => orchestrator.talkAboutTask(taskId),
    toggleMicrophone: () => orchestrator.toggleMicrophone(),
    endTalk: () => orchestrator.endTalk(),
    stopSpeaking: () => orchestrator.stopSpeaking(),
    stopCall: () => orchestrator.stopCall(),
    muteSpeaker: (muted: boolean) => orchestrator.muteSpeaker(muted),
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

it.effect(
  "the talk key's press opens a session about the plan when none stands and unmutes it once started; its release mutes once",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.beginTalk(INVITES_TASK), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      assert.equal(call.opens, 1);
      assert.deepEqual(call.openings, [{ taskId: INVITES_TASK }]);
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
      // The next hold against the standing session, naming no task: no second session, one more unmute, one more mute.
      yield* f.beginTalk();
      assert.equal(f.calls.length, 1);
      assert.equal(call.unmutes, 2);
      assert.equal(call.mutes, 1);
      yield* f.endTalk();
      assert.equal(call.mutes, 2);
    }),
);

it.effect(
  "hanging up while Luke speaks silences him on this device and closes the call without telling the host to stop his work",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkAboutTask(INVITES_TASK), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.settle(LIVE_STATUS.SPEAKING);
      yield* f.stopCall();
      assert.equal(call.silences, 1);
      assert.equal(call.closes, 1);
      assert.equal(call.status, LIVE_STATUS.IDLE);
      // The host's stop cancels every run of the call, so a hang-up never sends it.
      assert.deepEqual(f.stops, []);
    }),
);

it.effect(
  "hanging up while Luke is thinking quietly closes the call and tells the host nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkAboutTask(INVITES_TASK), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      yield* f.endTalk();
      yield* f.stopCall();
      assert.equal(call.silences, 0);
      assert.equal(call.closes, 1);
      assert.deepEqual(f.stops, []);
    }),
);

it.effect(
  "the stop key while Luke speaks still silences him first and then tells the host to stop, leaving the call up",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkAboutTask(INVITES_TASK), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.settle(LIVE_STATUS.SPEAKING);
      assert.equal(yield* f.stopSpeaking(), true);
      assert.deepEqual(f.silencedAtStops, [1]);
      assert.equal(f.stops.length, 1);
      assert.equal(call.closes, 0);
    }),
);
