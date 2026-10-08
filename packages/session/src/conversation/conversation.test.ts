import assert from "node:assert/strict";
import { test } from "vitest";
import { CONVERSATION_ENTRY_KIND, streamingConversationEntry } from "./conversation.js";

test("a streaming line is trimmed and its line endings made uniform, with nothing cut", () => {
  const long = "x".repeat(800);
  const line = streamingConversationEntry(
    CONVERSATION_ENTRY_KIND.REPLY,
    `  Checkout\r\n\r\nfinished ${long}  `,
  );
  assert.deepEqual(line, {
    kind: CONVERSATION_ENTRY_KIND.REPLY,
    words: `Checkout\n\nfinished ${long}`,
  });

  // Words that trim to nothing preview nothing.
  assert.equal(streamingConversationEntry(CONVERSATION_ENTRY_KIND.ASK, "   "), undefined);
});
