import assert from "node:assert/strict";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { test } from "vitest";
import { commentAskMessage } from "./comment-ask.js";

const THREAD: DescriptionCommentThread = {
  id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
  quote: "a retry",
  anchor: { from: 20, to: 27 },
  section: "Testing",
  status: DESCRIPTION_COMMENT_STATUS.OPEN,
  createdAt: 1_792_108_800_000,
  updatedAt: 1_792_108_800_000,
  revision: 1,
  entries: [
    {
      id: "5f2b0c1e-8d3a-4c7b-9e6f-1a2b3c4d5e6f",
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
      words: "Is this covered already?",
      at: 1_792_108_800_000,
    },
  ],
};

test("a thread is handed over as its quoted words, its section's name, its comments, and the task a reply names, and never the description's text", () => {
  const message = commentAskMessage({
    taskId: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
    taskName: "Invites",
    thread: THREAD,
    sender: "Dean",
  });

  assert.ok(message.startsWith('Dean sent you a comment thread on the description of "Invites"'));
  assert.ok(message.includes('On: "a retry" (section "Testing")'));
  assert.ok(message.includes("Dean: Is this covered already?"));
  assert.ok(message.includes("Read the thread, then answer"));
  assert.ok(message.includes('of task "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b"'));
});
