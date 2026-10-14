import assert from "node:assert/strict";
import { MESSAGE_ROLE } from "@luke/wire";
import { test } from "vitest";
import { applyMessagesPage, type CodingAgentMessage } from "./coding-agent-wire.js";

function message(id: string, text: string): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text }] };
}

test("a page joins the messages held: one heard again is replaced in place, a new one joins at the end", () => {
  const held = [message("a", "first"), message("b", "second")];

  const joined = applyMessagesPage(held, [message("a", "first, amended"), message("c", "third")]);

  assert.deepEqual(
    joined.map((each) => [each.id, each.parts]),
    [
      ["a", [{ type: "text", text: "first, amended" }]],
      ["b", [{ type: "text", text: "second" }]],
      ["c", [{ type: "text", text: "third" }]],
    ],
  );
  assert.equal(applyMessagesPage(held, []), held);
});
