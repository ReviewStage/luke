import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { VOICE_FAILURE, type VoiceFailure } from "@luke/features/words";
import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@luke/gateway";
import { LIVE_CLOSE_REASON, LIVE_STATUS, type LiveStatus } from "@luke/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntryKind } from "@luke/wire/conversation";
import { Context, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { VoiceCallAbout, VoiceCallTranscriptChange } from "../voice-view.js";
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

const INVITES_TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** Two agents of the invites task, either of which a call may speak into. */
const INVITES_AGENT: VoiceCallAbout = {
  taskId: INVITES_TASK,
  agentId: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
};
const REVIEW_AGENT: VoiceCallAbout = {
  taskId: INVITES_TASK,
  agentId: "6e2a9d4b-1c7f-4a8e-b3d5-2f9c8e1a7b60",
};

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
  /** What a refused open reports as it fails, as the real call reports a peer the browser refused. */
  openFailure: VoiceFailure | undefined;
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
    else if (this.openFailure !== undefined) this.events.onError(this.openFailure);
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
  microphoneGranted: true,
};

function fixture(
  surroundings: Partial<LiveVoiceSurroundings> = {},
  services: Context.Context<never> = Context.empty(),
) {
  const calls: FakeCall[] = [];
  const views: LiveVoiceView[] = [];
  /** What moved in the transcript with each report, none where nothing did. */
  const transcripts: (VoiceCallTranscriptChange | undefined)[] = [];
  /** Whether each report was the one an exchange opened on. */
  const openings: boolean[] = [];
  let microphoneGranted = true;
  let microphoneAsks = 0;
  let microphoneAsk: (() => Effect.Effect<boolean>) | undefined;
  let hostedFailure: VoiceFailure | undefined;
  const stops: number[] = [];
  const silencedAtStops: number[] = [];
  const orchestrator = new LiveVoiceOrchestrator({
    services,
    bridge: {
      reportView: (view, exchange, transcript) => {
        views.push(view);
        openings.push(exchange);
        transcripts.push(transcript);
      },
      requestMicrophone: () =>
        Effect.suspend(() => {
          microphoneAsks += 1;
          return microphoneAsk ? microphoneAsk() : Effect.succeed(microphoneGranted);
        }),
      hostedFailure: () => Effect.sync(() => hostedFailure),
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
    talkTo: (about: VoiceCallAbout) => orchestrator.talkTo(about),
    toggleMicrophone: () => orchestrator.toggleMicrophone(),
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
    transcripts,
    setMicrophone: (granted: boolean) => {
      microphoneGranted = granted;
    },
    /** Why the service refused the last session, as its diagnostics answer. */
    setHostedFailure: (failure: VoiceFailure | undefined) => {
      hostedFailure = failure;
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
  "calling a second agent while the first one's call stands hangs that call up and opens one into the second, which the view names",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const first = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), { startImmediately: true });
      const invites = f.latest();
      assert.ok(invites);
      invites.started();
      yield* Fiber.join(first);
      yield* Effect.yieldNow;
      assert.deepEqual(f.views.at(-1)?.call, INVITES_AGENT);
      const second = yield* Effect.forkChild(f.talkTo(REVIEW_AGENT), { startImmediately: true });
      const review = f.latest();
      assert.ok(review);
      assert.notEqual(review, invites);
      // The first call was closed before the second was offered.
      assert.equal(invites.closes, 1);
      assert.deepEqual(review.openings, [REVIEW_AGENT]);
      review.started();
      yield* Fiber.join(second);
      yield* Effect.yieldNow;
      assert.equal(f.calls.length, 2);
      assert.equal(review.status, LIVE_STATUS.LISTENING);
      assert.deepEqual(f.views.at(-1)?.call, REVIEW_AGENT);
      // The same agent's button again mutes its call rather than opening another.
      yield* f.talkTo(REVIEW_AGENT);
      assert.equal(f.calls.length, 2);
      assert.equal(review.status, LIVE_STATUS.MUTED);
    }),
);

it.effect(
  "hanging up while Luke speaks silences him on this device and closes the call without telling the host to stop his work",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), {
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
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      // The agent's own button again mutes it before the hang-up.
      yield* f.talkTo(INVITES_AGENT);
      yield* f.stopCall();
      assert.equal(call.silences, 0);
      assert.equal(call.closes, 1);
      assert.deepEqual(f.stops, []);
    }),
);

it.effect(
  "Escape while Luke speaks still silences him first and then tells the host to stop, leaving the call up",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), {
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

/** One caption row as the call's ledger hands it over: unsettled, so it is still being said. */
function captionRow(rowId: string, kind: ConversationEntryKind, words: string): LiveCaptionRow {
  return {
    rowId,
    entry: { kind, words },
    startMs: 0,
    endMs: words.length * 10,
    voiceSessionId: "voice-session-1",
    settled: false,
  };
}

it.effect(
  "heard rows landing within 100 ms are one report with the latest words, and a line said is carried once rather than with every later row",
  () =>
    Effect.gen(function* () {
      const f = fixture({}, yield* Effect.context<never>());
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), {
        startImmediately: true,
      });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      call.settle(LIVE_STATUS.SPEAKING);
      yield* Effect.yieldNow;
      const before = f.views.length;
      assert.equal(f.views[before - 1]?.voiceStatus, LIVE_STATUS.SPEAKING);

      // Ten transcription deltas growing Luke's first line, 9 ms apart.
      const words = [
        "Seven",
        "days",
        "then",
        "and",
        "the",
        "link",
        "dies",
        "with",
        "the",
        "invite.",
      ];
      const first = (count: number) =>
        captionRow("row-1", CONVERSATION_ENTRY_KIND.REPLY, words.slice(0, count).join(" "));
      for (let count = 1; count <= words.length; count += 1) {
        call.events.onCaptions([first(count)]);
        yield* TestClock.adjust(Duration.millis(9));
        yield* Effect.yieldNow;
      }
      assert.equal(f.views.length, before);
      yield* TestClock.adjust(Duration.millis(10));
      yield* Effect.yieldNow;
      assert.equal(f.views.length, before + 1);
      assert.deepEqual(f.transcripts[before], {
        voiceSessionId: "voice-session-1",
        from: 0,
        lines: [
          {
            rowId: "row-1",
            speaker: "assistant",
            words: words.join(" "),
            startMs: 0,
            endMs: words.join(" ").length * 10,
          },
        ],
      });

      // A second line growing over the next stretch carries only itself.
      const second = (text: string) => captionRow("row-2", CONVERSATION_ENTRY_KIND.REPLY, text);
      for (const text of ["Anything", "Anything else", "Anything else on invites?"]) {
        call.events.onCaptions([first(words.length), second(text)]);
        yield* TestClock.adjust(Duration.millis(100));
        yield* Effect.yieldNow;
      }
      assert.equal(f.views.length, before + 4);
      const later = f.transcripts.slice(before + 1);
      assert.deepEqual(
        later.map((change) => [change?.from, change?.lines.map((line) => line.words)]),
        [
          [1, ["Anything"]],
          [1, ["Anything else"]],
          [1, ["Anything else on invites?"]],
        ],
      );

      // Rows that moved nothing are not reported at all.
      call.events.onCaptions([first(words.length), second("Anything else on invites?")]);
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
      assert.equal(f.views.length, before + 4);

      // The call gone takes its transcript with it, from the first line.
      yield* f.stopCall();
      yield* Effect.yieldNow;
      assert.deepEqual(f.transcripts.at(-1), {
        voiceSessionId: undefined,
        from: 0,
        lines: [],
      });
    }),
);

it.effect(
  "a call refused for want of an OpenAI key says so at once in place of the generic failure, which is never reported",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      f.setHostedFailure(VOICE_FAILURE.OPENAI_KEY_MISSING);
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), { startImmediately: true });
      const call = f.latest();
      assert.ok(call);
      call.opensSucceed = false;
      call.openFailure = VOICE_FAILURE.CALL_NOT_STARTED;
      call.started();
      yield* Fiber.join(pressed);
      yield* Effect.yieldNow;
      assert.equal(f.views.at(-1)?.voiceError, VOICE_FAILURE.OPENAI_KEY_MISSING);
      assert.equal(
        f.views.some((view) => view.voiceError === VOICE_FAILURE.CALL_NOT_STARTED),
        false,
      );
      assert.equal(f.views.at(-1)?.voiceNotice, undefined);
    }),
);

it.effect("a call that fails to open with no reason from the service says it did not start", () =>
  Effect.gen(function* () {
    const f = fixture();
    const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), { startImmediately: true });
    const call = f.latest();
    assert.ok(call);
    call.opensSucceed = false;
    call.openFailure = VOICE_FAILURE.CALL_NOT_STARTED;
    call.started();
    yield* Fiber.join(pressed);
    yield* Effect.yieldNow;
    assert.equal(f.views.at(-1)?.voiceError, VOICE_FAILURE.CALL_NOT_STARTED);
  }),
);

it.effect(
  "a failure's clock stands still while speech hides it, and runs on from where it stopped once the line shows again",
  () =>
    Effect.gen(function* () {
      const f = fixture({}, yield* Effect.context<never>());
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), { startImmediately: true });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      // Muted, then the microphone taken away: the next press is refused while the call stands.
      yield* f.talkTo(INVITES_AGENT);
      f.setMicrophone(false);
      f.surround({ ...SURROUNDINGS, microphoneGranted: false });
      yield* f.talkTo(INVITES_AGENT);
      yield* Effect.yieldNow;
      const error = () => f.views.at(-1)?.voiceError;
      assert.equal(error(), VOICE_FAILURE.MICROPHONE_REFUSED);

      yield* TestClock.adjust(Duration.seconds(4));
      call.report(LIVE_STATUS.SPEAKING, { listening: false, lukeSpeaking: true });
      yield* Effect.yieldNow;
      // Hidden behind Luke's voice for far longer than the line's whole hold.
      yield* TestClock.adjust(Duration.seconds(60));
      yield* Effect.yieldNow;
      assert.equal(error(), VOICE_FAILURE.MICROPHONE_REFUSED);

      call.report(LIVE_STATUS.MUTED, { listening: false, lukeSpeaking: false });
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(7_900));
      yield* Effect.yieldNow;
      assert.equal(error(), VOICE_FAILURE.MICROPHONE_REFUSED, "8 of its 12 seconds were left");
      yield* TestClock.adjust(Duration.millis(200));
      yield* Effect.yieldNow;
      assert.equal(error(), undefined);
    }),
);

it.effect(
  "a call whose connection the host lost, its reconnects run out, says it dropped by its key, and a close the host asked for says nothing",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      const pressed = yield* Effect.forkChild(f.talkTo(INVITES_AGENT), { startImmediately: true });
      const call = f.latest();
      assert.ok(call);
      call.started();
      yield* Fiber.join(pressed);
      assert.ok(call.sessionId);
      yield* f.obey({
        sessionId: call.sessionId,
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
      });
      yield* Effect.yieldNow;
      assert.equal(f.views.at(-1)?.voiceError, VOICE_FAILURE.CALL_DROPPED);
      assert.equal(f.views.at(-1)?.call, undefined);

      const g = fixture();
      const again = yield* Effect.forkChild(g.talkTo(INVITES_AGENT), { startImmediately: true });
      const asked = g.latest();
      assert.ok(asked);
      asked.started();
      yield* Fiber.join(again);
      assert.ok(asked.sessionId);
      yield* g.obey({
        sessionId: asked.sessionId,
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      });
      yield* Effect.yieldNow;
      assert.equal(g.views.at(-1)?.call, undefined);
      assert.equal(g.views.at(-1)?.voiceError, undefined);

      // A close the host began, as a deleted task's, whose connection is lost
      // while the call is still closing, was asked for too.
      const h = fixture();
      const third = yield* Effect.forkChild(h.talkTo(INVITES_AGENT), { startImmediately: true });
      const closing = h.latest();
      assert.ok(closing);
      closing.started();
      yield* Fiber.join(third);
      assert.ok(closing.sessionId);
      closing.closing = Effect.never;
      yield* h.obey({ sessionId: closing.sessionId, phase: LIVE_SESSION_PHASE.CLOSING });
      yield* Effect.yieldNow;
      yield* h.obey({
        sessionId: closing.sessionId,
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
      });
      yield* Effect.yieldNow;
      assert.equal(h.views.at(-1)?.call, undefined);
      assert.equal(h.views.at(-1)?.voiceError, undefined);
    }),
);
