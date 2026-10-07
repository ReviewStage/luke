import assert from "node:assert/strict";
import { test } from "vitest";
import { replySentences } from "./run-events.js";

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
