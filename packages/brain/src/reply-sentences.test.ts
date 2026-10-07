import assert from "node:assert/strict";
import { test } from "vitest";
import { finishedSentencesOf, replySentences } from "./run-events.js";

test("a planning return written in Markdown is spoken as its words alone", () => {
  const reply = [
    "## The plan is complete.",
    "",
    "**Working assumptions:**",
    "",
    "- Invites expire after *seven* days.",
    "- The `invite_token` column is reused.",
    "1. Read [the invite spec](https://example.com/spec) before building.",
    "2) [ ] Check the __resend__ limit.",
    "",
    "---",
    "> Left to the agent: ~~the email copy~~ the button label.",
  ].join("\n");
  assert.deepEqual(replySentences(reply), [
    "The plan is complete.",
    "Working assumptions:",
    "Invites expire after seven days.",
    "The invite_token column is reused.",
    "Read the invite spec before building.",
    "Check the resend limit.",
    "Left to the agent: the email copy the button label.",
  ]);
});

test("emphasis that spans a sentence end is taken out as one pair", () => {
  assert.deepEqual(replySentences("**Two things changed. Both are tested.** Nothing else did."), [
    "Two things changed.",
    "Both are tested.",
    "Nothing else did.",
  ]);
});

test("symbols that are not Markdown stand as written", () => {
  assert.deepEqual(
    replySentences("It computes 2 * 3 * 4 in snake_case_name. The hook is pre__commit__check now."),
    ["It computes 2 * 3 * 4 in snake_case_name.", "The hook is pre__commit__check now."],
  );
});

test("a code block loses its fences and keeps its lines, and an autolink its brackets", () => {
  assert.deepEqual(
    replySentences("Run this:\n```sh\npnpm test\n```\nSee <https://example.com/run> for more."),
    ["Run this:", "pnpm test", "See https://example.com/run for more."],
  );
});

test("a heading's closing hashes go, and a line of only syntax says nothing", () => {
  assert.deepEqual(replySentences("### Status ###\n***\n- \nAll green."), ["Status", "All green."]);
});

test("emphasis nested inside strong emphasis is taken out with it", () => {
  assert.deepEqual(replySentences("**Keep *both* flags.**"), ["Keep both flags."]);
});

/** Every cut the words take as they grow a character at a time is spoken as the first sentences of the whole. */
function assertCutsHold(whole: string): void {
  const sentences = replySentences(whole);
  for (let length = 0; length <= whole.length; length += 1) {
    const cut = replySentences(finishedSentencesOf(whole.slice(0, length)));
    assert.deepEqual(
      cut,
      sentences.slice(0, cut.length),
      `at ${length}: ${whole.slice(0, length)}`,
    );
  }
}

test("words still forming are cut at their last finished sentence, and the forming one waits", () => {
  assert.equal(finishedSentencesOf("One agent finished. Another is"), "One agent finished.");
  assert.equal(finishedSentencesOf("Still forming"), "");
  assert.equal(finishedSentencesOf("A line.\nThe next"), "A line.");
});

test("a sentence inside emphasis still open or behind a list marker waits for its line", () => {
  assert.equal(finishedSentencesOf("**Two things changed. Both"), "");
  assert.equal(finishedSentencesOf("1. Read it. Then"), "1. Read it.");
  assert.equal(finishedSentencesOf("1."), "");
  for (const whole of [
    "**Two things changed. Both are tested.** Nothing else did.",
    "## The plan is complete.\n\n- Invites expire after *seven* days. Resend once.\n1. Read [the spec. Now](https://example.com) first.",
    "Run this:\n```sh\npnpm test. Then\n```\nIt computes 2 * 3 * 4. Done.",
  ]) {
    assertCutsHold(whole);
  }
});
