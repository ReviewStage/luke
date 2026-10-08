import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionKey } from "./identifiers.js";

test("a session key is made only through its own constructor, which refuses an empty one", () => {
  assert.equal(sessionKey("agent:main:main"), "agent:main:main");
  assert.throws(() => sessionKey(""), TypeError);
});
