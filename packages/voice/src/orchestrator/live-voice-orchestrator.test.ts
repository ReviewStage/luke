import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_SESSION_PHASE } from "@sidecar/gateway";
import { LIVE_CLOSE_REASON, LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { CONVERSATION_ENTRY_KIND, type ConversationEntryKind } from "@sidecar/session";
import type { LiveCaptionRow, LiveVoiceCall, LiveVoiceCallEvents } from "./live-voice-call.js";
import {
  type LiveVoiceExchangeOpening,
  LiveVoiceOrchestrator,
  type LiveVoiceSurroundings,
  type LiveVoiceView,
} from "./live-voice-orchestrator.js";

/** A call that records the verbs it was asked and answers for its status. */
let sessions = 0;

class FakeCall implements LiveVoiceCall {
  status: LiveStatus = LIVE_STATUS.IDLE;
  sessionId: string | undefined;
  opens = 0;
  unmutes = 0;
  mutes = 0;
  closes = 0;
  opensSucceed = true;
  #release: (() => void) | undefined;

  constructor(readonly events: LiveVoiceCallEvents) {}

  /** As the real call answers it: no peer stands until the session is answered, so a connecting call is not standing. */
  get standing(): boolean {
    return (
      this.status === LIVE_STATUS.MUTED ||
      this.status === LIVE_STATUS.LISTENING ||
      this.status === LIVE_STATUS.SPEAKING
    );
  }

  get listening(): boolean {
    return this.status === LIVE_STATUS.LISTENING;
  }

  open(): Promise<boolean> {
    this.opens += 1;
    this.settle(LIVE_STATUS.CONNECTING);
    return new Promise<boolean>((resolve) => {
      this.#release = () => {
        if (this.opensSucceed) this.settle(LIVE_STATUS.MUTED);
        else this.settle(LIVE_STATUS.FAILED);
        resolve(this.opensSucceed);
      };
    });
  }

  /** The session started, or refused to; a started one is named in the order it opened. */
  started(): void {
    if (this.opensSucceed) this.sessionId = `s${++sessions}`;
    this.#release?.();
    this.#release = undefined;
  }

  async unmute(): Promise<boolean> {
    this.unmutes += 1;
    this.settle(LIVE_STATUS.LISTENING);
    return true;
  }

  async mute(): Promise<boolean> {
    this.mutes += 1;
    this.settle(LIVE_STATUS.MUTED);
    return true;
  }

  async close(): Promise<void> {
    this.closes += 1;
    this.settle(LIVE_STATUS.IDLE);
  }

  settle(status: LiveStatus): void {
    this.status = status;
    this.events.onStatus(status);
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
  const openings: (LiveVoiceExchangeOpening | undefined)[] = [];
  let microphoneGranted = true;
  let microphoneAsks = 0;
  const orchestrator = new LiveVoiceOrchestrator({
    bridge: {
      reportView: (view, exchange) => {
        views.push(view);
        openings.push(exchange);
      },
      requestMicrophone: async () => {
        microphoneAsks += 1;
        return microphoneGranted;
      },
      hostedUnavailableNote: async () => undefined,
    },
    createCall: (events) => {
      const call = new FakeCall(events);
      calls.push(call);
      return call;
    },
  });
  orchestrator.surround({ ...SURROUNDINGS, ...surroundings });
  return {
    orchestrator,
    calls,
    views,
    openings,
    setMicrophone: (granted: boolean) => {
      microphoneGranted = granted;
    },
    microphoneAsks: () => microphoneAsks,
    latest: () => calls[calls.length - 1],
  };
}

function row(
  rowId: number,
  kind: ConversationEntryKind,
  words: string,
  settled = false,
): LiveCaptionRow {
  return { rowId, entry: { kind, words }, settled };
}

test("the talk key opens a session when none stands and unmutes it once started; a second press mutes", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const call = f.latest();
  assert.ok(call);
  assert.equal(call.opens, 1);
  assert.equal(call.unmutes, 0);
  call.started();
  await pressed;
  assert.equal(call.unmutes, 1);
  assert.equal(call.status, LIVE_STATUS.LISTENING);
  await f.orchestrator.beginTalk();
  assert.equal(call.mutes, 1);
  assert.equal(call.opens, 1);
  assert.equal(f.calls.length, 1);
  // Pressed again against the muted session: no second session, one more unmute.
  await f.orchestrator.beginTalk();
  assert.equal(f.calls.length, 1);
  assert.equal(call.unmutes, 2);
});

test("the stop key mutes a standing session and does nothing against none", async () => {
  const f = fixture();
  assert.equal(await f.orchestrator.stopSpeaking(), false);
  const pressed = f.orchestrator.beginTalk();
  f.latest()?.started();
  await pressed;
  assert.equal(await f.orchestrator.stopSpeaking(), true);
  assert.equal(f.latest()?.mutes, 1);
});

test("a press without the microphone asks for it, and a refusal opens nothing", async () => {
  const f = fixture({ microphoneGranted: false });
  f.setMicrophone(false);
  await f.orchestrator.beginTalk();
  assert.equal(f.microphoneAsks(), 1);
  assert.equal(f.calls.length, 0);
  await drainMicrotasks();
  assert.notEqual(f.views.at(-1)?.voiceError, undefined);
  f.setMicrophone(true);
  const pressed = f.orchestrator.beginTalk();
  await drainMicrotasks();
  assert.equal(f.calls.length, 1);
  f.latest()?.started();
  await pressed;
  assert.equal(f.latest()?.unmutes, 1);
});

test("a press while voice is off opens nothing", async () => {
  const f = fixture({ voiceAvailable: false });
  await f.orchestrator.beginTalk();
  assert.equal(f.calls.length, 0);
});

test("wanted opens a session muted, closing hangs it up, and a lost session with the microphone live listens again on the next", async () => {
  const f = fixture();
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.WANTED });
  const first = f.latest();
  assert.ok(first);
  first.started();
  await drainMicrotasks();
  assert.equal(first.unmutes, 0);
  assert.equal(first.status, LIVE_STATUS.MUTED);
  // A second wanted while it stands opens nothing more.
  f.orchestrator.obeySessionChange({
    phase: LIVE_SESSION_PHASE.WANTED,
    sessionId: first.sessionId,
  });
  assert.equal(f.calls.length, 1);
  // The developer joins, then the connection is lost under them: the peer's
  // own end may land before the host's word, and the wanted right after it.
  await first.unmute();
  const lost = first.sessionId;
  first.settle(LIVE_STATUS.IDLE);
  f.orchestrator.obeySessionChange({
    phase: LIVE_SESSION_PHASE.CLOSED,
    sessionId: lost,
    reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
  });
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.WANTED });
  const second = f.latest();
  assert.ok(second);
  assert.notEqual(second, first);
  second.started();
  await drainMicrotasks();
  assert.equal(second.unmutes, 1);
  // A closing that names another session is not this call's.
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: lost });
  await drainMicrotasks();
  assert.equal(second.closes, 0);
  f.orchestrator.obeySessionChange({
    phase: LIVE_SESSION_PHASE.CLOSING,
    sessionId: second.sessionId,
  });
  await drainMicrotasks();
  assert.equal(second.closes, 1);
});

test("a session closed by the host's own decision does not listen again on the next", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const first = f.latest();
  assert.ok(first);
  first.started();
  await pressed;
  // The host's word ends the call before the peer has noticed: the call is
  // let go of and hangs up behind, and the next wanted opens a new one.
  f.orchestrator.obeySessionChange({
    phase: LIVE_SESSION_PHASE.CLOSED,
    sessionId: first.sessionId,
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
  });
  await drainMicrotasks();
  assert.equal(first.closes, 1);
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.WANTED });
  const second = f.latest();
  assert.ok(second);
  assert.notEqual(second, first);
  second.started();
  await drainMicrotasks();
  assert.equal(second.unmutes, 0);
});

test("a session that refuses to open leaves no call standing, and the next press opens another", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const first = f.latest();
  assert.ok(first);
  first.opensSucceed = false;
  first.started();
  await pressed;
  assert.equal(first.unmutes, 0);
  await drainMicrotasks();
  assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.FAILED);
  const again = f.orchestrator.beginTalk();
  assert.equal(f.calls.length, 2);
  f.latest()?.started();
  await again;
});

test("the view reports each edge once, counts the exchange on its opening edge under who opened it, and carries the captions", async () => {
  const f = fixture();
  await drainMicrotasks();
  const pressed = f.orchestrator.beginTalk();
  const call = f.latest();
  assert.ok(call);
  await drainMicrotasks();
  assert.deepEqual(
    f.views.map((view) => view.voiceStatus),
    [LIVE_STATUS.IDLE, LIVE_STATUS.CONNECTING],
  );
  assert.deepEqual(f.openings, [undefined, { microphoneCall: true }]);
  assert.equal(f.views.at(-1)?.talkOpening, true);
  call.started();
  await pressed;
  await drainMicrotasks();
  assert.equal(f.views.at(-1)?.voiceStatus, LIVE_STATUS.LISTENING);
  assert.equal(f.views.at(-1)?.talkOpening, false);
  assert.equal(f.views.at(-1)?.spokenAskPending, true);
  // Both speakers' rows still being spoken are the live lines; Luke's are the captions while he speaks.
  call.events.onCaptions([
    row(1, CONVERSATION_ENTRY_KIND.SPOKEN_ASK, "what needs me"),
    row(2, CONVERSATION_ENTRY_KIND.REPLY, "Two sessions"),
  ]);
  call.settle(LIVE_STATUS.SPEAKING);
  await drainMicrotasks();
  const speaking = f.views.at(-1);
  assert.equal(speaking?.spokenAskPending, false);
  assert.deepEqual(speaking?.lukeCaptions, ["Two sessions"]);
  assert.deepEqual(
    speaking?.liveConversationEntries.map((entry) => entry.kind),
    [CONVERSATION_ENTRY_KIND.SPOKEN_ASK, CONVERSATION_ENTRY_KIND.REPLY],
  );
  // A settled row leaves the live lines: the host has written it by then.
  call.events.onCaptions([
    row(1, CONVERSATION_ENTRY_KIND.SPOKEN_ASK, "what needs me", true),
    row(2, CONVERSATION_ENTRY_KIND.REPLY, "Two sessions finished"),
  ]);
  await drainMicrotasks();
  assert.deepEqual(
    f.views.at(-1)?.liveConversationEntries.map((entry) => entry.kind),
    [CONVERSATION_ENTRY_KIND.REPLY],
  );
  // The count rose once for the whole exchange.
  assert.equal(f.openings.filter((opening) => opening !== undefined).length, 1);
});

test("captions are withheld when neither the preference nor a silent output asks for them", async () => {
  const f = fixture({ captionsEnabled: false, outputSilent: false });
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.WANTED });
  const call = f.latest();
  assert.ok(call);
  call.started();
  call.events.onCaptions([row(1, CONVERSATION_ENTRY_KIND.REPLY, "Two sessions")]);
  call.settle(LIVE_STATUS.SPEAKING);
  await drainMicrotasks();
  assert.equal(f.views.at(-1)?.lukeCaptions, undefined);
  assert.deepEqual(f.openings.filter(Boolean), [{ microphoneCall: false }]);
  f.orchestrator.surround({ ...SURROUNDINGS, captionsEnabled: false, outputSilent: true });
  await drainMicrotasks();
  assert.deepEqual(f.views.at(-1)?.lukeCaptions, ["Two sessions"]);
});

test("voice turning off closes the standing session, and stop closes it and reports nothing after", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const call = f.latest();
  assert.ok(call);
  call.started();
  await pressed;
  f.orchestrator.surround({ ...SURROUNDINGS, voiceAvailable: false });
  await drainMicrotasks();
  assert.equal(call.closes, 1);
  const g = fixture();
  const opened = g.orchestrator.beginTalk();
  g.latest()?.started();
  await opened;
  await drainMicrotasks();
  const reports = g.views.length;
  await g.orchestrator.stop();
  await drainMicrotasks();
  assert.equal(g.latest()?.closes, 1);
  assert.equal(g.views.length, reports);
});

test("the host closing an older session leaves a call still waiting for its own answer standing", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const call = f.latest();
  assert.ok(call);
  // The host hung up the session it still held before creating this one.
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.CLOSING, sessionId: "old" });
  f.orchestrator.obeySessionChange({
    phase: LIVE_SESSION_PHASE.CLOSED,
    sessionId: "old",
    reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
  });
  await drainMicrotasks();
  assert.equal(call.closes, 0);
  call.started();
  await pressed;
  assert.equal(call.unmutes, 1);
  // Still driven: the stop key reaches it.
  assert.equal(await f.orchestrator.stopSpeaking(), true);
  assert.equal(call.mutes, 1);
});

test("a stop while a press's session is still opening leaves it muted", async () => {
  const f = fixture();
  const pressed = f.orchestrator.beginTalk();
  const call = f.latest();
  assert.ok(call);
  assert.equal(call.standing, false);
  assert.equal(await f.orchestrator.stopSpeaking(), true);
  call.started();
  await pressed;
  assert.equal(call.unmutes, 0);
  assert.equal(call.mutes, 0);
  assert.equal(call.status, LIVE_STATUS.MUTED);
});

test("a wanted the document held at adoption opens a session; any other standing phase opens none", async () => {
  const f = fixture();
  f.orchestrator.adoptStanding(LIVE_SESSION_PHASE.CLOSED);
  f.orchestrator.adoptStanding(undefined);
  assert.equal(f.calls.length, 0);
  f.orchestrator.adoptStanding(LIVE_SESSION_PHASE.WANTED);
  assert.equal(f.calls.length, 1);
});

test("a session pausing between Luke's sentences is one exchange, counted once", async () => {
  const f = fixture();
  f.orchestrator.obeySessionChange({ phase: LIVE_SESSION_PHASE.WANTED });
  const call = f.latest();
  assert.ok(call);
  call.started();
  call.settle(LIVE_STATUS.SPEAKING);
  await drainMicrotasks();
  call.settle(LIVE_STATUS.MUTED);
  await drainMicrotasks();
  call.settle(LIVE_STATUS.SPEAKING);
  await drainMicrotasks();
  assert.deepEqual(f.openings.filter(Boolean), [{ microphoneCall: false }]);
});
