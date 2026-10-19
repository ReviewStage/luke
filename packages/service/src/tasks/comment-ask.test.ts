import assert from "node:assert/strict";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { test } from "vitest";
import { commentAskMessage } from "./comment-ask.js";

const THREAD: PlanCommentThread = {
  id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  scope: PLAN_COMMENT_SCOPE.WORDS,
  quote: "a retry",
  anchor: { from: 20, to: 27 },
  section: "Testing",
  status: PLAN_COMMENT_STATUS.OPEN,
  createdAt: 1_792_108_800_000,
  updatedAt: 1_792_108_800_000,
  revision: 1,
  entries: [
    {
      id: "5f2b0c1e-8d3a-4c7b-9e6f-1a2b3c4d5e6f",
      kind: PLAN_COMMENT_ENTRY.COMMENT,
      writer: { actor: PLAN_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
      words: "Is this covered already?",
      at: 1_792_108_800_000,
    },
  ],
};

test("a thread is handed over as its quoted words, its section's name, and its comments, and never the plan's text", () => {
  const message = commentAskMessage({
    taskName: "Invites",
    thread: THREAD,
    sender: "Dean",
    toLuke: false,
  });

  assert.ok(message.startsWith('Dean sent you a comment thread on the plan "Invites"'));
  assert.ok(message.includes('On: "a retry" (section "Testing")'));
  assert.ok(message.includes("Dean: Is this covered already?"));
  assert.ok(message.includes("Read the thread, then answer"));
  assert.equal(message.includes("as the plan now reads"), false);
});
