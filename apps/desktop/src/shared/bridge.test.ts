import assert from "node:assert/strict";
import test from "node:test";
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
  const guard = BRIDGE.reportConversationHistory.args;
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

test("clearing conversation history is acknowledged", () => {
  assert.equal(BRIDGE.clearConversationHistory.kind, "invoke");
  assert.equal(BRIDGE.clearConversationHistory.result?.(true), true);
  assert.equal(BRIDGE.clearConversationHistory.result?.(false), true);
  assert.equal(BRIDGE.clearConversationHistory.result?.(undefined), false);
});

test("remembered-fact pushes enforce their complete bounded shape", () => {
  const guard = BRIDGE.onRememberedFactsChanged.result;
  assert.equal(guard?.([{ id: "one", words: "kept" }]), true);
  assert.equal(guard?.([{ id: "one", words: "x".repeat(241) }]), false);
  assert.equal(
    guard?.([
      { id: "one", words: "first" },
      { id: "one", words: "second" },
    ]),
    false,
  );
});

test("a brain ask is one bounded string and nothing else", () => {
  assert.equal(BRIDGE.askBrain.kind, "invoke");
  assert.equal(BRIDGE.askBrain.args(["what needs me?"]), true);
  assert.equal(BRIDGE.askBrain.args([]), false);
  assert.equal(BRIDGE.askBrain.args([3]), false);
  assert.equal(BRIDGE.askBrain.args(["a", "b"]), false);
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
