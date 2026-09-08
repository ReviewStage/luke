import assert from "node:assert/strict";
import test from "node:test";
import { maximumTypedAskLength } from "@sidecar/realtime";
import { BRIDGE } from "./bridge";

test("act bridge entries reject legacy and malformed outcomes", () => {
  for (const entry of [BRIDGE.disconnectSuperset]) {
    const guard = entry.result;
    assert.ok(guard);
    assert.equal(guard({ status: "accepted" }), true);
    assert.equal(guard({ status: "rejected", reason: "Not now." }), true);
    assert.equal(guard({ status: "unsupported", reason: "Not here." }), true);
    assert.equal(guard({ status: "accepted", reason: "contradiction" }), false);
    assert.equal(guard({ status: "accepted", setting: "Captions" }), false);
    assert.equal(guard({ status: "rejected" }), false);
    assert.equal(guard({ status: "refused" }), false);
    assert.equal(guard({ ok: false }), false);
  }
});

test("a conversation history report carries only well-formed history lines", () => {
  const guard = BRIDGE.appendConversationHistory.args;
  const ask = { kind: "typed-ask", words: "how is it going?", recordedAt: 1 };
  const announcement = {
    kind: "announcement",
    words: "A chat finished.",
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
    recordedAt: 2,
  };
  assert.equal(guard([[]]), true);
  assert.equal(guard([[ask, announcement]]), true);
  // A field an older build stored beside the words is left unread, not refused.
  assert.equal(guard([[{ ...announcement, mentions: [{ title: "checkout" }] }]]), true);
  // One argument, and it is the thread itself.
  assert.equal(guard([]), false);
  assert.equal(guard([[ask], [announcement]]), false);
  assert.equal(guard([ask]), false);
  // A line is only a line: a made-up kind, wordless words, a malformed
  // identity, or a smuggled extra shape all refuse the whole report.
  assert.equal(guard([[{ kind: "transcript", words: "x" }]]), false);
  assert.equal(guard([[{ kind: "reply" }]]), false);
  assert.equal(guard([[{ kind: "reply", words: 3 }]]), false);
  assert.equal(guard([[{ ...ask, identity: { providerId: "claude-code" } }]]), false);
  assert.equal(
    guard([[{ ...ask, identity: { providerId: "nope", providerSessionId: "s" } }]]),
    false,
  );
  assert.equal(guard([[{ ...ask, recordedAt: Number.POSITIVE_INFINITY }]]), false);
});

test("the voice bootstraps through its own invoke, taking no arguments", () => {
  assert.equal(BRIDGE.getVoiceBootstrap.kind, "invoke");
  assert.notEqual(BRIDGE.getVoiceBootstrap.channel, BRIDGE.getBootstrap.channel);
  assert.equal(BRIDGE.getVoiceBootstrap.args([]), true);
  assert.equal(BRIDGE.getVoiceBootstrap.args(["voice"]), false);
});

test("a brain ask is one submission with an id, bounded words, and an origin", () => {
  assert.equal(BRIDGE.submitBrainAsk.kind, "invoke");
  const guard = BRIDGE.submitBrainAsk.args;
  const submission = { submissionId: "sub-1", question: "what needs me?", origin: "typed" };
  assert.equal(guard([submission]), true);
  assert.equal(guard([{ ...submission, origin: "spoken" }]), true);
  assert.equal(guard([{ ...submission, question: "x".repeat(maximumTypedAskLength) }]), true);
  assert.equal(guard([{ ...submission, question: "x".repeat(maximumTypedAskLength + 1) }]), false);
  assert.equal(guard([{ ...submission, submissionId: "" }]), false);
  assert.equal(guard([{ ...submission, origin: "dreamt" }]), false);
  assert.equal(guard(["what needs me?"]), false);
  assert.equal(guard([]), false);
  const answer = BRIDGE.submitBrainAsk.result;
  assert.ok(answer);
  assert.equal(answer({ outcome: "accepted", runId: "run-1", acceptedAt: 1 }), true);
  assert.equal(answer({ outcome: "rejected", reason: "absent" }), true);
  assert.equal(answer({ outcome: "rejected", reason: "tired" }), false);
  assert.equal(answer({ status: "accepted", briefing: "words" }), false);
});

test("a run is waited on, cancelled, and listed by its own record shape", () => {
  const snapshot = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: "typed",
    question: "what needs me?",
    status: "running",
    revision: 1,
    acceptedAt: 1,
    startedAt: 2,
    performedActs: 0,
    unknownActs: 0,
  };
  assert.equal(BRIDGE.cancelBrainAsk.kind, "invoke");
  assert.equal(BRIDGE.cancelBrainAsk.args(["run-1"]), true);
  assert.equal(BRIDGE.cancelBrainAsk.args([1]), false);
  assert.ok(BRIDGE.cancelBrainAsk.result);
  assert.equal(BRIDGE.cancelBrainAsk.result(snapshot), true);
  assert.equal(BRIDGE.cancelBrainAsk.result(undefined), true);
  assert.equal(BRIDGE.cancelBrainAsk.result({ ...snapshot, status: "dreaming" }), false);
  // A wait names the caller's receiver epoch and answers the record with the
  // call's grant; a grant without a record, or a record of no known shape, is refused.
  assert.equal(BRIDGE.waitBrainAsk.args(["run-1", 3]), true);
  assert.equal(BRIDGE.waitBrainAsk.args(["run-1"]), false);
  assert.equal(BRIDGE.waitBrainAsk.args(["run-1", -1]), false);
  assert.ok(BRIDGE.waitBrainAsk.result);
  assert.equal(BRIDGE.waitBrainAsk.result({ record: snapshot, speak: false }), true);
  assert.equal(BRIDGE.waitBrainAsk.result({ record: undefined, speak: false }), true);
  assert.equal(
    BRIDGE.waitBrainAsk.result({ record: { ...snapshot, status: "dreaming" }, speak: true }),
    false,
  );
  assert.equal(BRIDGE.waitBrainAsk.result(snapshot), false);
  // A reply's offer, claim, and acknowledgement all carry the epoch; the grant carries the origin.
  assert.ok(BRIDGE.onBrainReplyOffered.result);
  assert.equal(
    BRIDGE.onBrainReplyOffered.result({ runId: "run-1", deliveryId: "d-1", epoch: 2 }),
    true,
  );
  assert.equal(BRIDGE.onBrainReplyOffered.result({ runId: "run-1", deliveryId: "d-1" }), false);
  assert.equal(BRIDGE.claimBrainReply.args(["run-1", "d-1", 2]), true);
  assert.equal(BRIDGE.claimBrainReply.args(["run-1", "d-1"]), false);
  assert.ok(BRIDGE.claimBrainReply.result);
  assert.equal(
    BRIDGE.claimBrainReply.result({ granted: true, words: "w", origin: "spoken" }),
    true,
  );
  assert.equal(BRIDGE.claimBrainReply.result({ granted: true, words: "w" }), false);
  assert.equal(BRIDGE.claimBrainReply.result({ granted: false }), true);
  assert.equal(BRIDGE.ackBrainReply.args(["run-1", "d-1", 2]), true);
  assert.equal(BRIDGE.ackBrainReply.args(["run-1", "d-1", "2"]), false);
  assert.ok(BRIDGE.onBrainRepliesWithdrawn.result);
  assert.equal(BRIDGE.onBrainRepliesWithdrawn.result(2), true);
  assert.equal(BRIDGE.onBrainRepliesWithdrawn.result("2"), false);
  assert.equal(BRIDGE.brainRequestSnapshots.args([]), true);
  assert.ok(BRIDGE.brainRequestSnapshots.result);
  assert.equal(BRIDGE.brainRequestSnapshots.result([snapshot]), true);
  assert.equal(BRIDGE.brainRequestSnapshots.result([snapshot, { runId: "x" }]), false);
  assert.ok(BRIDGE.onBrainRequestsChanged.result);
  assert.equal(BRIDGE.onBrainRequestsChanged.result([]), true);
});

test("a reported guide is refused whole when any entry is malformed", () => {
  const guard = BRIDGE.reportAppGuide.args;
  const setting = {
    id: "voice_captions",
    label: "Captions",
    description: "Luke's words on screen.",
    kind: "toggle",
    value: "off",
    defaultValue: "off",
    adjustable: true,
    manual: "the Voice page",
  };
  assert.equal(guard([{ facts: [], settings: [] }]), true);
  assert.equal(
    guard([{ facts: [{ label: "Talk key", detail: "⌥Space" }], settings: [setting] }]),
    true,
  );
  assert.equal(
    guard([
      { facts: [], settings: [], update: { version: "1", detail: "Up to date", button: "check" } },
    ]),
    true,
  );
  assert.equal(guard([{ facts: [], settings: [{ ...setting, adjustable: "yes" }] }]), false);
  assert.equal(guard([{ facts: [{ label: "x" }], settings: [] }]), false);
  assert.equal(
    guard([{ facts: [], settings: [], update: { version: "1", detail: "", button: "eject" } }]),
    false,
  );
  assert.equal(guard([{ facts: [] }]), false);
});

test("an app act pushed to the renderer never carries a memory write", () => {
  const guard = BRIDGE.onBrainAppAct.result;
  assert.ok(guard);
  assert.equal(guard({ requestId: "r1", action: { kind: "panel", tab: "sessions" } }), true);
  assert.equal(guard({ requestId: "r1", action: { kind: "remember", words: "x" } }), false);
  assert.equal(guard({ requestId: "r1", action: { kind: "forget", id: "f" } }), false);
  assert.equal(guard({ action: { kind: "panel", tab: "sessions" } }), false);
});

test("a speech offer carries an id, a deadline, and one well-formed turn", () => {
  const guard = BRIDGE.onSpeechOffered.result;
  assert.ok(guard);
  const briefing = { kind: "briefing", briefing: "Claude Code finished checkout.", decidedAt: 1 };
  assert.equal(guard({ id: "one", speakBy: 120_001, turn: briefing }), true);
  assert.equal(guard({ id: "two", speakBy: 5, turn: { kind: "arrival", decidedAt: 2 } }), true);
  assert.equal(
    guard({
      id: "three",
      speakBy: 5,
      turn: { kind: "arrival", decidedAt: 2, sessionTitle: "checkout", talkKeyLabel: "F5" },
    }),
    true,
  );
  assert.equal(
    guard({ id: "four", speakBy: 5, turn: { kind: "calendar-onboarding", decidedAt: 3 } }),
    true,
  );
  assert.equal(guard({ speakBy: 5, turn: briefing }), false);
  assert.equal(guard({ id: "", speakBy: 5, turn: briefing }), false);
  assert.equal(guard({ id: "five", turn: briefing }), false);
  assert.equal(guard({ id: "five", speakBy: "soon", turn: briefing }), false);
  assert.equal(guard({ id: "six", speakBy: 5, turn: { kind: "edge", decidedAt: 1 } }), false);
  assert.equal(
    guard({ id: "seven", speakBy: 5, turn: { kind: "briefing", briefing: 3, decidedAt: 1 } }),
    false,
  );
  assert.equal(
    guard({ id: "eight", speakBy: 5, turn: { kind: "briefing", briefing: "x", decidedAt: "1" } }),
    false,
  );
  assert.equal(
    guard({ id: "nine", speakBy: 5, turn: { kind: "arrival", decidedAt: 1, sessionTitle: 4 } }),
    false,
  );
  assert.equal(guard({ id: "ten", speakBy: 5 }), false);
});

test("a speech withdrawal names the offer by a string id", () => {
  const guard = BRIDGE.onSpeechWithdrawn.result;
  assert.ok(guard);
  assert.equal(guard({ id: "one" }), true);
  assert.equal(guard({ id: "" }), false);
  assert.equal(guard({ id: 1 }), false);
  assert.equal(guard({}), false);
  assert.equal(guard("one"), false);
});

test("settling speech takes an id and one of the four outcomes", () => {
  assert.equal(BRIDGE.settleSpeech.kind, "invoke");
  const guard = BRIDGE.settleSpeech.args;
  for (const outcome of ["spoken", "refused", "held", "stale"]) {
    assert.equal(guard(["one", outcome]), true);
  }
  assert.equal(guard(["one"]), false);
  assert.equal(guard(["one", "dropped"]), false);
  assert.equal(guard([1, "spoken"]), false);
  assert.equal(guard(["one", "spoken", "extra"]), false);
});

test("the window role guard admits the hidden voice role beside the drawn two", () => {
  const guard = BRIDGE.getWindowRole.result;
  assert.ok(guard);
  assert.equal(guard("panel"), true);
  assert.equal(guard("introduction"), true);
  assert.equal(guard("voice"), true);
  assert.equal(guard("takeover"), false);
});

const VOICE_VIEW = {
  voiceStatus: "responding",
  voiceError: undefined,
  voiceNotice: "Listening on the built-in microphone.",
  talkOpening: false,
  lukeCaptions: ["Claude Code finished checkout."],
  liveConversationEntries: [{ kind: "reply", words: "Checkout is green.", recordedAt: 12 }],
};

test("a voice view carries its six fields and nothing malformed", () => {
  const guard = BRIDGE.onVoiceViewChanged.result;
  assert.ok(guard);
  assert.equal(guard(VOICE_VIEW), true);
  assert.equal(guard({ ...VOICE_VIEW, lukeCaptions: undefined, voiceNotice: undefined }), true);
  assert.equal(guard({ ...VOICE_VIEW, voiceStatus: "shouting" }), false);
  assert.equal(guard({ ...VOICE_VIEW, talkOpening: "yes" }), false);
  assert.equal(guard({ ...VOICE_VIEW, voiceError: 4 }), false);
  assert.equal(guard({ ...VOICE_VIEW, lukeCaptions: [1] }), false);
  assert.equal(guard({ ...VOICE_VIEW, liveConversationEntries: [{ kind: "reply" }] }), false);
  assert.equal(guard({ ...VOICE_VIEW, liveConversationEntries: undefined }), false);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, undefined]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW]), false);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, VOICE_VIEW]), false);
  assert.equal(BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: 1 }, undefined]), false);
});

test("an exchange kind rides a voice view only on an edge that opened one", () => {
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "spoken"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "typed"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "announcement"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "shouted"]), false);
  // A settled call opened nothing, so nothing may be counted against it.
  assert.equal(
    BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: "ready" }, "spoken"]),
    false,
  );
  assert.equal(
    BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: "ready" }, undefined]),
    true,
  );
});

test("a voice level is one finite number in the unit interval", () => {
  const guard = BRIDGE.onVoiceLevelChanged.result;
  assert.ok(guard);
  assert.equal(guard(0), true);
  assert.equal(guard(0.5), true);
  assert.equal(guard(1), true);
  assert.equal(guard(1.5), false);
  assert.equal(guard(-0.1), false);
  assert.equal(guard(Number.NaN), false);
  assert.equal(guard("loud"), false);
  assert.equal(BRIDGE.reportVoiceLevel.args([0.25]), true);
  assert.equal(BRIDGE.reportVoiceLevel.args([]), false);
  assert.equal(BRIDGE.reportVoiceLevel.args([0.25, 0.5]), false);
});

test("a microphone status broadcast is one of the system's five answers", () => {
  const guard = BRIDGE.onMicrophoneStatusChanged.result;
  assert.ok(guard);
  for (const status of ["not-determined", "granted", "denied", "restricted", "unknown"]) {
    assert.equal(guard(status), true);
  }
  assert.equal(guard("allowed"), false);
  assert.equal(guard(undefined), false);
});

test("a voice command is one of the four commands and carries no words", () => {
  assert.equal(BRIDGE.voiceCommand.kind, "invoke");
  const guard = BRIDGE.voiceCommand.args;
  for (const command of [
    "discard-listening",
    "stop-speaking",
    "request-microphone-access",
    "clear-conversation",
  ]) {
    assert.equal(guard([command]), true);
    assert.equal(guard([command, "words"]), false);
  }
  // A typed ask is a brain submission now, not a command to the voice window.
  assert.equal(guard(["ask-text"]), false);
  assert.equal(guard(["stop-microphone"]), false);
  assert.equal(guard([]), false);
  const forwarded = BRIDGE.onVoiceCommand.result;
  assert.ok(forwarded);
  assert.equal(forwarded({ command: "stop-speaking" }), true);
  assert.equal(forwarded({ command: "ask-text" }), false);
  assert.equal(forwarded({ command: "dance" }), false);
});

test("a Clear is answered with its outcome, and nothing else is", () => {
  const outcome = BRIDGE.voiceCommand.result;
  assert.ok(outcome);
  assert.equal(outcome("accepted"), true);
  assert.equal(outcome("refused"), true);
  assert.equal(outcome(undefined), true);
  assert.equal(outcome("sent"), false);
  assert.equal(outcome(true), false);
});

test("shortcut capture is reported as one boolean", () => {
  assert.equal(BRIDGE.setShortcutCapturing.kind, "send");
  assert.equal(BRIDGE.setShortcutCapturing.args([true]), true);
  assert.equal(BRIDGE.setShortcutCapturing.args(["true"]), false);
  assert.equal(BRIDGE.setShortcutCapturing.args([]), false);
});
