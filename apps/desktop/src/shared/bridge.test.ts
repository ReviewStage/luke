import assert from "node:assert/strict";
import test from "node:test";
import { ONE_ACT_OF_EACH_KIND } from "../testing/acts";
import { BRIDGE, bridgeEntries, channels } from "./bridge";
import { ACT_KIND, type ActKind } from "./messages/acts";

const KINDS: readonly ActKind[] = Object.values(ACT_KIND);

test("the bridge is one act channel, one state read, and the reports beside them", () => {
  const entries = bridgeEntries();
  // Three kinds and no fourth: what a window causes, what it reads, what it
  // reports. Anything else added here is a second way in.
  assert.deepEqual(
    entries.filter(([, entry]) => entry.kind === "invoke").map(([method]) => method),
    ["act", "requestAppState", "appendConversationLines"],
  );
  // Every entry parses what arrives, and a channel names exactly one entry.
  for (const [method, entry] of entries) {
    assert.ok(entry.args, method);
  }
  const named = entries.map(([, entry]) => entry.channel);
  assert.equal(new Set(named).size, named.length);
  assert.equal(Object.keys(channels).length, entries.length);
});

test("the act channel takes one act of any kind and nothing else", () => {
  const guard = BRIDGE.act.args;
  assert.equal(BRIDGE.act.kind, "invoke");
  for (const kind of KINDS) assert.equal(guard([ONE_ACT_OF_EACH_KIND[kind]]), true, kind);
  // One argument, and it is one act of a kind this build knows.
  assert.equal(guard([]), false);
  assert.equal(guard([{ kind: ACT_KIND.WINDOW_QUIT }, { kind: ACT_KIND.WINDOW_QUIT }]), false);
  assert.equal(guard(["window.quit"]), false);
  assert.equal(guard([{ kind: "window.sleep" }]), false);
  assert.equal(guard([{ kind: ACT_KIND.WINDOW_COPY_TEXT }]), false);
  assert.equal(guard([{ kind: ACT_KIND.WINDOW_QUIT, payload: { now: true } }]), false);
  const answer = BRIDGE.act.result;
  assert.ok(answer);
  assert.equal(answer({ status: "done", value: undefined }), true);
  assert.equal(answer({ status: "refused", reason: "Not now." }), true);
  assert.equal(answer({ status: "unknown-act" }), true);
  assert.equal(answer({ status: "thrown", reason: "Not now." }), false);
  assert.equal(answer(undefined), false);
});

test("a conversation report carries only well-formed conversation lines", () => {
  const guard = BRIDGE.appendConversationLines.args;
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

const WINDOW = { role: "panel", mode: "compact" };

test("app state is read on one invoke and delivered on one subscription", () => {
  assert.equal(BRIDGE.requestAppState.kind, "invoke");
  assert.equal(BRIDGE.onAppState.kind, "subscribe");
  assert.equal(BRIDGE.requestAppState.args([]), true);
  assert.equal(BRIDGE.requestAppState.args(["panel"]), false);
  assert.equal(BRIDGE.onAppState.args([]), true);
  for (const guard of [BRIDGE.requestAppState.result, BRIDGE.onAppState.result]) {
    assert.ok(guard);
    assert.equal(guard({ version: 0, window: WINDOW }), true);
    assert.equal(guard({ version: 12, window: { ...WINDOW, role: "voice" } }), true);
    // The version orders every delivery, so nothing but a whole count is one.
    assert.equal(guard({ version: -1, window: WINDOW }), false);
    assert.equal(guard({ version: 1.5, window: WINDOW }), false);
    assert.equal(guard({ version: "1", window: WINDOW }), false);
    assert.equal(guard({ window: WINDOW }), false);
    // The facts decide which surface draws at all, so a snapshot without
    // them, or naming a role this build has no surface for, is refused.
    assert.equal(guard({ version: 0 }), false);
    assert.equal(guard({ version: 0, window: { role: "takeover", mode: "compact" } }), false);
    assert.equal(guard({ version: 0, window: { role: "panel" } }), false);
    assert.equal(guard(undefined), false);
  }
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
  const guard = BRIDGE.onBrainAppAction.result;
  assert.ok(guard);
  assert.equal(guard({ requestId: "r1", action: { kind: "panel", tab: "sessions" } }), true);
  assert.equal(guard({ requestId: "r1", action: { kind: "remember", words: "x" } }), false);
  assert.equal(guard({ requestId: "r1", action: { kind: "forget", id: "f" } }), false);
  assert.equal(guard({ action: { kind: "panel", tab: "sessions" } }), false);
});

const VOICE_VIEW = {
  voiceStatus: "speaking",
  voiceError: undefined,
  voiceNotice: "Listening on the built-in microphone.",
  talkOpening: false,
  lukeCaptions: ["Claude Code finished checkout."],
  liveConversationEntries: [{ kind: "reply", words: "Checkout is green.", recordedAt: 12 }],
  spokenAskPending: false,
};

test("a voice view carries its seven fields and nothing malformed", () => {
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, undefined]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW]), false);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, VOICE_VIEW]), false);
  assert.equal(BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: 1 }, undefined]), false);
  assert.equal(
    BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, spokenAskPending: "yes" }, undefined]),
    false,
  );
});

test("an exchange kind rides a voice view only on an edge that opened one", () => {
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "spoken"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "typed"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "announcement"]), true);
  assert.equal(BRIDGE.reportVoiceView.args([VOICE_VIEW, "shouted"]), false);
  // A muted standing session is no exchange, so nothing may be counted against it.
  assert.equal(
    BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: "muted" }, "spoken"]),
    false,
  );
  assert.equal(
    BRIDGE.reportVoiceView.args([{ ...VOICE_VIEW, voiceStatus: "muted" }, undefined]),
    true,
  );
  // A press still waiting on its session is the exchange opening.
  assert.equal(
    BRIDGE.reportVoiceView.args([
      { ...VOICE_VIEW, voiceStatus: "muted", talkOpening: true },
      "spoken",
    ]),
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

test("shortcut capture is reported as one boolean", () => {
  assert.equal(BRIDGE.setShortcutCapturing.kind, "send");
  assert.equal(BRIDGE.setShortcutCapturing.args([true]), true);
  assert.equal(BRIDGE.setShortcutCapturing.args(["true"]), false);
  assert.equal(BRIDGE.setShortcutCapturing.args([]), false);
});
