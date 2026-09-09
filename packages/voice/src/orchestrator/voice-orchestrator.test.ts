import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import type { VoiceBridge } from "./voice-bridge.js";
import type { ConversationCallHooks, SpeakOnlyCallHooks } from "./voice-orchestrator.js";
import { VoiceOrchestrator } from "./voice-orchestrator.js";
import type { VoiceExchangeOpening, VoiceViewReport } from "./voice-view-reporter.js";

/** A call that does nothing but say what it was told and answer for its status. */
class FakeCall {
  status: RealtimeStatus = REALTIME_STATUS.IDLE;
  turnPending = false;
  connected = false;
  turns = 0;
  closes = 0;
  constructor(
    readonly hooks: Partial<ConversationCallHooks<string>> & SpeakOnlyCallHooks<string>,
    readonly developers: boolean,
  ) {}
  get microphoneCall() {
    return this.developers && (this.isConnected || this.isConnecting);
  }
  get isConnected() {
    return this.connected;
  }
  get isConnecting() {
    return this.status === REALTIME_STATUS.CONNECTING;
  }
  connect() {
    this.connected = true;
    // A press whose turn is already pending walks straight from the
    // handshake into listening; it never rests at ready on the way.
    this.settle(REALTIME_STATUS.CONNECTING);
    return Promise.resolve(true);
  }
  close() {
    this.closes += 1;
    this.connected = false;
    return Promise.resolve();
  }
  speak() {
    return true;
  }
  stopSpeaking() {
    return true;
  }
  applySpeed() {}
  reportRemoteAudioLevel() {}
  beginTurn() {
    this.turns += 1;
  }
  endTurn() {}
  dropPendingTurn() {}
  stopListening() {}
  speakReply() {
    return true;
  }
  settle(status: RealtimeStatus) {
    this.status = status;
    this.hooks.onStatus(status);
  }
}

/** Whichever calls the orchestrator has asked this harness to build. */
interface FakeCalls {
  conversation?: FakeCall;
  speakOnly?: FakeCall;
}

function orchestrator() {
  const reports: { view: VoiceViewReport; exchange: VoiceExchangeOpening | undefined }[] = [];
  const calls: FakeCalls = {};
  let granted = true;
  const bridge: VoiceBridge = {
    reportView: (view, exchange) => reports.push({ view, exchange }),
    reportReady: () => {},
    appendConversation: () => Promise.resolve(true),
    settleSpeech: () => {},
    submitBrainAsk: () => Promise.reject(new Error("not asked")),
    waitBrainAsk: () => Promise.reject(new Error("not waited")),
    claimBrainReply: () => Promise.reject(new Error("not claimed")),
    ackBrainReply: () => {},
    requestMicrophone: () => Promise.resolve(granted),
    hostedUnavailableNote: () => Promise.resolve(undefined),
  };
  const subject = new VoiceOrchestrator<string>({
    bridge,
    createConversationCall: (hooks: ConversationCallHooks<string>) => {
      calls.conversation = new FakeCall(hooks, true);
      return calls.conversation;
    },
    createSpeakOnlyCall: (hooks) => {
      calls.speakOnly = new FakeCall(hooks, false);
      return calls.speakOnly;
    },
    schedule: () => 0,
    cancel: () => undefined,
  });
  subject.applyBootstrap({ conversation: { entries: [], cleared: false }, epoch: 1 });
  return {
    subject,
    reports,
    calls,
    deny: () => {
      granted = false;
    },
  };
}

/** The report is coalesced onto a microtask, so a settled view is one drain away. */
const drain = () => Promise.resolve().then(() => undefined);

test("a view that did not move is not reported again", async () => {
  const { subject, reports } = orchestrator();
  await drain();
  assert.equal(reports.length, 1);
  // Every report becomes a version of the document this window itself reads,
  // so a report the view did not move would be answered by a delivery asking
  // for another, and the two would never stop.
  subject.surround({
    captionsEnabled: false,
    outputSilent: false,
    microphoneGranted: true,
    announcementsHeld: false,
    sessions: [],
  });
  await drain();
  assert.equal(reports.length, 1);
});

test("the exchange is counted on its opening edge alone", async () => {
  const { subject, calls, reports } = orchestrator();
  await subject.beginTalk();
  await drain();
  const conversation = calls.conversation;
  assert.ok(conversation);
  conversation.settle(REALTIME_STATUS.LISTENING);
  await drain();
  conversation.settle(REALTIME_STATUS.RESPONDING);
  await drain();

  const counted = reports.filter((report) => report.exchange !== undefined);
  assert.deepEqual(
    counted.map((report) => report.exchange),
    [{ microphoneCall: true, typedAsk: false }],
  );
  // A turn walking from connecting through responding is one exchange.
  assert.equal(counted[0]?.view.voiceStatus, REALTIME_STATUS.CONNECTING);
});

test("a press the microphone is refused opens no turn and says why", async () => {
  const { subject, calls, reports, deny } = orchestrator();
  deny();
  subject.surround({
    captionsEnabled: false,
    outputSilent: false,
    microphoneGranted: false,
    announcementsHeld: false,
    sessions: [],
  });
  await subject.beginTalk();
  await drain();

  assert.equal(calls.conversation?.turns, 0);
  assert.match(String(reports.at(-1)?.view.voiceError), /needs the microphone/);
});

test("the meter is pointed at whoever holds the turn, and the element at Luke", async () => {
  const { subject, calls } = orchestrator();
  const seen: (string | undefined)[][] = [];
  subject.subscribe((state) => seen.push([state.meterStream, state.remoteStream]));
  await subject.beginTalk();
  const conversation = calls.conversation;
  assert.ok(conversation);
  conversation.hooks.onLocalStream?.("mic");
  // The press's device is metered while the call is still opening, so the
  // bars draw the same listening before and after the channel comes up.
  assert.equal(seen.at(-1)?.[0], "mic");
  conversation.hooks.onRemoteStream("luke");
  conversation.settle(REALTIME_STATUS.LISTENING);
  assert.deepEqual(seen.at(-1), ["mic", "luke"]);
  conversation.settle(REALTIME_STATUS.RESPONDING);
  assert.deepEqual(seen.at(-1), ["luke", "luke"]);
  // Between turns the meter listens to nobody, but the element keeps the
  // stream Luke's voice would arrive on.
  conversation.settle(REALTIME_STATUS.READY);
  assert.deepEqual(seen.at(-1), [undefined, "luke"]);
});

test("a Clear retires the latch, so the next press opens a turn rather than ending one", async () => {
  const { subject, calls } = orchestrator();
  await subject.beginTalk();
  const conversation = calls.conversation;
  assert.ok(conversation);
  conversation.settle(REALTIME_STATUS.LISTENING);
  // A tap leaves the turn open for a later press to end.
  subject.endTalk();
  subject.clearConversation();

  await subject.beginTalk();
  assert.equal(conversation.turns, 2);
});
