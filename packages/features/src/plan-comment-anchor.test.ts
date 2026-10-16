import assert from "node:assert/strict";
import { test } from "vitest";
import { type CommentSpan, spanWithin, textChange } from "./plan-comment-anchor.js";

const PLAN =
  "## Goal\n\nAn admin invites a teammate by email, and the invite lands as a single-use link that expires in seven days.\n\n## Approach\n\nThe invite email follows the mock Lee shared.\n";

/** The span of the first place `words` stands in `text`. */
function spanOf(text: string, words: string): CommentSpan {
  const from = text.indexOf(words);
  assert.ok(from >= 0, `"${words}" is not in the text`);
  return { from, to: from + words.length };
}

/** The words a span stands over. */
function wordsAt(text: string, span: CommentSpan | undefined): string | undefined {
  return span === undefined ? undefined : text.slice(span.from, span.to);
}

test("an anchor moves with its words when a change writes in above them", () => {
  const after = PLAN.replace(
    "## Goal\n\n",
    "## Context\n\nOnly an admin can add someone.\n\n## Goal\n\n",
  );
  const moved = textChange(PLAN, after)(spanOf(PLAN, "single-use link"));

  assert.equal(wordsAt(after, moved), "single-use link");
});

test("words written between an anchor's words join it, and words written at its edges do not", () => {
  const after = PLAN.replace("single-use link", "short, single-use invite link").replace(
    "expires in",
    "expires after",
  );
  const moved = textChange(PLAN, after)(spanOf(PLAN, "single-use link"));

  assert.equal(wordsAt(after, moved), "single-use invite link");
});

test("an anchor shrinks to the words a change kept of it", () => {
  const after = PLAN.replace("single-use link that expires", "link that expires");
  const moved = textChange(PLAN, after)(spanOf(PLAN, "single-use link that expires"));

  assert.equal(wordsAt(after, moved), "link that expires");
});

test("an anchor whose every word a change took out stands nowhere", () => {
  const after = PLAN.replace("The invite email follows the mock Lee shared.\n", "");
  const moved = textChange(PLAN, after)(spanOf(PLAN, "follows the mock Lee shared"));

  assert.equal(moved, undefined);
});

test("an anchor whose sentence a change rewrote whole stands nowhere, though a word or two recur", () => {
  const after = PLAN.replace(
    "The invite email follows the mock Lee shared.",
    "Every message reuses the shared template.",
  );
  const change = textChange(PLAN, after);

  assert.equal(change(spanOf(PLAN, "follows the mock Lee shared")), undefined);
  assert.equal(wordsAt(after, change(spanOf(PLAN, "seven days"))), "seven days");
});

test("an anchored word keeps its anchor through a typo fixed inside it", () => {
  const typo = PLAN.replace("teammate", "temate");
  const after = PLAN;

  assert.equal(wordsAt(after, textChange(typo, after)(spanOf(typo, "temate"))), "teammate");
});

test("a change that moves nothing leaves every anchor where it was", () => {
  const span = spanOf(PLAN, "teammate");

  assert.deepEqual(textChange(PLAN, PLAN)(span), span);
});

test("a span is within a text only where it holds at least one of its letters", () => {
  assert.equal(spanWithin({ from: 0, to: 3 }, 3), true);
  assert.equal(spanWithin({ from: 2, to: 2 }, 3), false);
  assert.equal(spanWithin({ from: 1, to: 4 }, 3), false);
  assert.equal(spanWithin({ from: -1, to: 2 }, 3), false);
});
