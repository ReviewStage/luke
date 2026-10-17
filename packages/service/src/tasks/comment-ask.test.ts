import assert from "node:assert/strict";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { test } from "vitest";
import { commentAskMessage, sectionExcerpt } from "./comment-ask.js";

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

test("a thread handed to a coding agent carries the section its words stand in, which it reads in the plan's place", () => {
  const ask = {
    planName: "Invites",
    thread: THREAD,
    sender: "Dean",
    toLuke: false,
    section: undefined,
  };

  const withSection = commentAskMessage({ ...ask, section: "## Testing\n\nWe test a retry." });
  const without = commentAskMessage(ask);

  assert.ok(withSection.includes("## Testing\n\nWe test a retry."));
  assert.ok(withSection.includes("Read the thread and the section above"));
  assert.ok(without.includes("Read the thread and the plan"));
  assert.equal(without.includes("as the plan now reads"), false);
});

test("a long section is handed over as the stretch around the thread's words, marked where words were left out", () => {
  const section = `${"a".repeat(12_000)}THE WORDS${"b".repeat(10_000)}`;

  const near = sectionExcerpt(section, 12_000);
  const start = sectionExcerpt(section, 0);
  const short = sectionExcerpt("## Testing\n\nWe test a retry.", 14);

  assert.ok(near.includes("THE WORDS"));
  assert.ok(near.startsWith("[…]\n"));
  assert.ok(near.endsWith("\n[…]"));
  assert.equal(start.includes("THE WORDS"), false);
  assert.ok(start.endsWith("\n[…]") && !start.startsWith("[…]"));
  assert.equal(short, "## Testing\n\nWe test a retry.");
});
