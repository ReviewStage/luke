import assert from "node:assert/strict";
import { test } from "vitest";
import { agentId, MAIN_SESSION_KEY, sessionKey } from "./identifiers.js";

test("the default agent's main conversation has the fixed address the plan names", () => {
  assert.equal(MAIN_SESSION_KEY, "agent:main:main");
});

test("an identifier is made only through its own constructor, which refuses an empty one", () => {
  assert.equal(agentId("main"), "main");
  assert.throws(() => sessionKey(""), TypeError);
  // @ts-expect-error an agent is not a conversation's address, whatever its letters.
  const wrong: ReturnType<typeof sessionKey> = agentId("main");
  assert.equal(wrong, "main");
});

test("session keys classify into the conversation kinds maintenance tells apart", async () => {
  const { CONVERSATION_KIND, conversationKindOf } = await import("./identifiers.js");
  assert.equal(conversationKindOf(MAIN_SESSION_KEY), CONVERSATION_KIND.MAIN);
  assert.equal(conversationKindOf("agent:main:thread:t-1"), CONVERSATION_KIND.THREAD);
  assert.equal(conversationKindOf("agent:main:observed:codex:abc"), CONVERSATION_KIND.OBSERVED);
  assert.equal(conversationKindOf("agent:main:observed:codex"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:observed:codex:a:b"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:cron:nightly"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("global"), CONVERSATION_KIND.UNKNOWN);
  assert.equal(conversationKindOf("agent:main:thread:a:b"), CONVERSATION_KIND.UNKNOWN);
});
