/**
 * pending-comments.test.ts -- the member's pending comments are drawn
 * among the review threads, a reply on a published thread in that thread
 * and every other comment as a thread of its own, placed as any thread is,
 * on a line a gap opened over included. Synthetic files only.
 */

import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  DIFF_SIDE,
  type PendingReviewComment,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { gapLines, threadsOn } from "./changes-model.js";
import { pendingThreadsOf } from "./pending-comments.js";

/** A published thread on line 4 of the file. */
const PUBLISHED: ReviewThread = {
  path: "src/a.ts",
  line: 4,
  startLine: null,
  originalLine: 4,
  originalStartLine: null,
  side: DIFF_SIDE.RIGHT,
  startSide: null,
  diffHunk: "",
  resolved: false,
  outdated: false,
  comments: [{ by: { login: "octo", bot: false }, html: null, body: "Why?", at: 1, url: "r1" }],
  more: 0,
  id: "PRRT_published",
};

/** A pending comment on the file, starting a thread of its own on line 30 unless told otherwise. */
function draftOf(overrides: Partial<PendingReviewComment>): PendingReviewComment {
  return {
    id: "PRRC_start",
    by: { login: "dana", bot: false },
    path: "src/a.ts",
    line: 30,
    startLine: null,
    side: DIFF_SIDE.RIGHT,
    startSide: null,
    html: null,
    body: "Pending words",
    at: 2,
    ...overrides,
  };
}

/** A file of two hunks, new lines 3 to 6 and 41 to 43, a long gap between them. */
const FILE = {
  path: "src/a.ts",
  previousPath: null,
  status: CHANGED_FILE_STATUS.MODIFIED,
  additions: 2,
  deletions: 2,
  omitted: null,
  patch: [
    "@@ -3,3 +3,4 @@",
    " const c = 3;",
    "-const d = 4;",
    "+const d = 5;",
    "+const e = 6;",
    " const f = 7;",
    "@@ -40,3 +41,3 @@",
    " const x = 1;",
    "-const y = 2;",
    "+const y = 3;",
    " const z = 4;",
  ].join("\n"),
};

test("a pending reply is its published thread's last comment, and every other pending comment a thread of its own", () => {
  const threads = pendingThreadsOf(
    [PUBLISHED],
    [
      draftOf({ id: "PRRC_reply", threadId: "PRRT_published", line: 4 }),
      draftOf({}),
      draftOf({ id: "PRRC_lost", threadId: "PRRT_not_read", line: 5 }),
    ],
  );

  assert.deepEqual(
    threads.map((thread) => [thread.id, thread.line, thread.comments.map((each) => each.url)]),
    [
      ["PRRT_published", 4, ["r1", "PRRC_reply"]],
      [undefined, 30, ["PRRC_start"]],
      [undefined, 5, ["PRRC_lost"]],
    ],
    "a reply on a thread the conversation did not hold stands on its line all the same",
  );
  assert.equal(pendingThreadsOf([PUBLISHED], []).at(0), PUBLISHED);
});

test("a pending comment between hunks waits above the diff, and moves onto its line as a gap opened over it draws it", () => {
  const threads = pendingThreadsOf([], [draftOf({})]);

  assert.deepEqual(gapLines(threads, FILE), [30]);
  assert.deepEqual(
    threadsOn(threads, FILE).above.map(({ key }) => key),
    ["PRRC_start"],
  );
  assert.deepEqual(
    threadsOn(threads, FILE, undefined, new Set([30])).placed.map(({ key, line }) => [key, line]),
    [["PRRC_start", 30]],
  );
});
