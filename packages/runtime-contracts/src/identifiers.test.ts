import assert from "node:assert/strict";
import test from "node:test";
import {
  agentId,
  isRunOrigin,
  MAIN_SESSION_KEY,
  mainSessionKey,
  RUN_ORIGIN,
  runId,
  submissionId,
} from "./identifiers.js";

test("the default agent's main conversation has the fixed address the plan names", () => {
  assert.equal(MAIN_SESSION_KEY, "agent:main:main");
  assert.equal(mainSessionKey(agentId("other")), "agent:other:main");
});

test("an identifier is made only through its own constructor, which refuses an empty one", () => {
  assert.equal(runId("run-1"), "run-1");
  assert.throws(() => submissionId(""), TypeError);
  // @ts-expect-error a run is not a submission, whatever its letters.
  const wrong: ReturnType<typeof submissionId> = runId("run-1");
  assert.equal(wrong, "run-1");
});

test("run origins are the fixed vocabulary and nothing else", () => {
  for (const origin of Object.values(RUN_ORIGIN)) assert.ok(isRunOrigin(origin));
  assert.equal(isRunOrigin("developer"), false);
  assert.equal(isRunOrigin(undefined), false);
});

test("session keys classify into the conversation kinds maintenance tells apart", async () => {
  const { CONVERSATION_KIND, conversationKindOf, threadSessionKey } = await import(
    "./identifiers.js"
  );
  assert.equal(conversationKindOf(MAIN_SESSION_KEY), CONVERSATION_KIND.MAIN);
  assert.equal(threadSessionKey("t-1"), "agent:main:thread:t-1");
  assert.equal(conversationKindOf(threadSessionKey("t-1")), CONVERSATION_KIND.THREAD);
  assert.equal(conversationKindOf("agent:main:observed:codex:abc"), CONVERSATION_KIND.OBSERVED);
  assert.equal(conversationKindOf("agent:main:observed:codex"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:observed:codex:a:b"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:cron:nightly"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("global"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:thread:a:b"), CONVERSATION_KIND.UNKNOWN);
  assert.throws(() => threadSessionKey("a:b"), TypeError);
});

test("an observed session's key encodes its provider ids reversibly, whatever they carry", async () => {
  const { decodeKeyComponent, encodeKeyComponent, observedSessionKey, observedSessionRefOf } =
    await import("./identifiers.js");
  const source = { providerId: "claude-code", providerSessionId: "sess:1/2 %(x)*'!~" };
  const key = observedSessionKey(source);
  assert.equal(key.split(":").length, 5);
  assert.match(key, /^agent:main:observed:claude-code:/);
  assert.deepEqual(observedSessionRefOf(key), source);
  assert.equal(decodeKeyComponent(encodeKeyComponent("a:b%c")), "a:b%c");
  assert.equal(decodeKeyComponent("a:b"), undefined);
  assert.equal(decodeKeyComponent("%ZZ"), undefined);
  assert.equal(decodeKeyComponent(""), undefined);
  // A component the encoder would have written differently is not one it wrote.
  assert.equal(decodeKeyComponent("%3a"), undefined);
  assert.equal(observedSessionRefOf("agent:main:observed:codex"), undefined);
  assert.equal(observedSessionRefOf("agent:main:thread:t"), undefined);
  assert.throws(() => observedSessionKey({ providerId: "", providerSessionId: "x" }), TypeError);
  assert.notEqual(
    observedSessionKey({ providerId: "a:b", providerSessionId: "c" }),
    observedSessionKey({ providerId: "a", providerSessionId: "b:c" }),
  );
});
