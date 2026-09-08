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
  assert.equal(conversationKindOf("agent:main:cron:nightly"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("global"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:thread:a:b"), CONVERSATION_KIND.UNKNOWN);
  assert.throws(() => threadSessionKey("a:b"), TypeError);
});
