import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
} from "./conversation-event.js";

test("the speech kinds are every event kind but the rating", () => {
  const kinds: ConversationEventKind[] = Object.values(CONVERSATION_EVENT_KIND);
  assert.equal(kinds.length, 7);
  for (const kind of kinds) {
    assert.equal(isSpeechEventKind(kind), kind !== CONVERSATION_EVENT_KIND.RATING);
  }
});
