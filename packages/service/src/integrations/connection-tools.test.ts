import assert from "node:assert/strict";
import { test } from "vitest";
import { storedRemoteCall } from "./connection-tools.js";

/**
 * A nested call of an integration's own tool, as a transcript stores it:
 * under the provider's fixed name, with the remote tool's own name in the
 * envelope. MCP allows a dot in a tool's name, which Y Combinator's
 * Bookface server uses for every tool, so a dotted name is stored like any
 * other; a name shaped like a sentence is still no tool's.
 */

test("a dotted tool name, as Y Combinator's server names its tools, is stored under the provider's fixed name", () => {
  assert.deepEqual(storedRemoteCall("ycombinator__hiring.list_jobs", { limit: 5 }, "call_1"), {
    name: "ycombinator_remote",
    input: { remoteTool: "hiring.list_jobs", parentCallId: "call_1", input: { limit: 5 } },
  });
});

test("a name shaped like a sentence is no remote tool's, and is left out", () => {
  assert.equal(storedRemoteCall("ycombinator__list my jobs", {}, "call_1"), undefined);
});

test("a call of an account past the provider's first is stored under the provider's fixed name, with the account it ran against", () => {
  assert.deepEqual(storedRemoteCall("notion-2__notion-fetch", { id: "p1" }, "call_2"), {
    name: "notion_remote",
    input: {
      remoteTool: "notion-fetch",
      parentCallId: "call_2",
      input: { id: "p1" },
      connection: "notion-2",
    },
  });
  assert.deepEqual(storedRemoteCall("notion__notion-fetch", {}, "call_3"), {
    name: "notion_remote",
    input: { remoteTool: "notion-fetch", parentCallId: "call_3", input: {} },
  });
});
