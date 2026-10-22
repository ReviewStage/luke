import assert from "node:assert/strict";
import {
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { test } from "vitest";
import { commentSpansIn, marginTops, PENDING_THREAD } from "./plan-comments.js";

/**
 * Where a plan's comments are drawn: each open thread's words marked inside
 * the section they stand in, a resolved thread's and a deleted passage's
 * not at all, and the margin's cards stood level with their words without
 * overlapping, the open one exactly level. Synthetic threads.
 */

function thread(
  id: string,
  anchor: { from: number; to: number } | undefined,
  overrides: Partial<PlanCommentThread> = {},
): PlanCommentThread {
  return {
    id,
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "words",
    ...(anchor === undefined ? undefined : { anchor }),
    section: "Goal",
    status: PLAN_COMMENT_STATUS.OPEN,
    entries: [],
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    ...overrides,
  };
}

test("an open thread's words are marked in the section they stand in, in its own offsets, cut at its edge", () => {
  const threads = [
    thread("a", { from: 12, to: 20 }),
    thread("b", { from: 28, to: 40 }),
    thread("resolved", { from: 12, to: 20 }, { status: PLAN_COMMENT_STATUS.RESOLVED }),
    thread("gone", undefined),
    thread("block", { from: 0, to: 9 }, { scope: PLAN_COMMENT_SCOPE.BLOCK }),
  ];

  assert.deepEqual(commentSpansIn(threads, { from: 10, to: 30 }, "a", undefined), [
    { from: 2, to: 10, thread: "a", active: true, block: false },
    { from: 18, to: 20, thread: "b", active: false, block: false },
  ]);
  assert.deepEqual(commentSpansIn(threads, { from: 0, to: 10 }, undefined, undefined), [
    { from: 0, to: 9, thread: "block", active: false, block: true },
  ]);
});

test("the thread being started is marked with the rest, under its own id", () => {
  const pending = { from: 3, to: 7, scope: PLAN_COMMENT_SCOPE.WORDS, quote: "some" };

  assert.deepEqual(commentSpansIn([], { from: 0, to: 10 }, PENDING_THREAD, pending), [
    { from: 3, to: 7, thread: PENDING_THREAD, active: true, block: false },
  ]);
});

test("cards stand level with their words, a later one stepped below an earlier one it would overlap", () => {
  const tops = marginTops(
    [
      { id: "b", top: 40, height: 60 },
      { id: "a", top: 0, height: 80 },
      { id: "c", top: 300, height: 20 },
    ],
    undefined,
    8,
  );

  assert.deepEqual(Object.fromEntries(tops), { a: 0, b: 88, c: 300 });
});

test("the open card stands exactly level with its words, and the ones above it step up out of its way", () => {
  const tops = marginTops(
    [
      { id: "a", top: 0, height: 80 },
      { id: "b", top: 40, height: 200 },
      { id: "c", top: 100, height: 20 },
    ],
    "b",
    8,
  );

  assert.deepEqual(Object.fromEntries(tops), { a: -48, b: 40, c: 248 });
});

test("a thread begun on the editor's words is marked on the same words of the saved text, though words typed before them are not saved yet", () => {
  const saved = "alpha beta gamma";
  const draft = "alpha new beta gamma";
  const from = draft.indexOf("beta");
  const pending = {
    from,
    to: from + 4,
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: "beta",
    text: draft,
  };

  const [span] = commentSpansIn([], { from: 0, to: saved.length }, undefined, pending, saved);
  const onlyDraft = commentSpansIn(
    [],
    { from: 0, to: saved.length },
    undefined,
    { ...pending, from: draft.indexOf("new"), to: draft.indexOf("new") + 3, quote: "new" },
    saved,
  );

  assert.equal(span?.thread, PENDING_THREAD);
  assert.equal(span === undefined ? "" : saved.slice(span.from, span.to), "beta");
  assert.deepEqual(onlyDraft, [], "words not saved yet mark nothing");
});
