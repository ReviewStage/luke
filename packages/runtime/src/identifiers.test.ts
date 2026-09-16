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
