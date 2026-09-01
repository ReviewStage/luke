import assert from "node:assert/strict";
import test from "node:test";
import { BRIDGE } from "./bridge";

test("act bridge entries reject legacy and malformed outcomes", () => {
  for (const entry of [
    BRIDGE.authorizeAct,
    BRIDGE.disconnectSuperset,
    BRIDGE.renameSessionWorkspace,
    BRIDGE.renameSession,
    BRIDGE.executeIssueAction,
  ]) {
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

test("a conversation history report carries only bounded history lines", () => {
  const guard = BRIDGE.reportConversationHistory.args;
  const ask = { kind: "typed-ask", words: "how is it going?", recordedAt: 1 };
  const announcement = {
    kind: "announcement",
    words: "A chat finished.",
    identity: { providerId: "claude-code", providerSessionId: "session-a" },
  };
  assert.equal(guard([[]]), true);
  assert.equal(guard([[ask, announcement]]), true);
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
