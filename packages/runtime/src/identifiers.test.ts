import assert from "node:assert/strict";
import { test } from "vitest";
import { agentId, sessionKey } from "./identifiers.js";

test("an identifier's constructor refuses an empty one", () => {
  assert.throws(() => sessionKey(""), TypeError);
  assert.throws(() => agentId(""), TypeError);
});
