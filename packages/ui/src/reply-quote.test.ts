import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_REPLY_CHARS, replyOf, withReplies, withReplyAdded } from "./reply-quote.js";

/**
 * reply-quote.test.ts -- words picked out of an agent's message are kept
 * tidy and bounded, and lead the message sent as a Markdown quote of every
 * line. Synthetic words.
 */

test("words picked across a message's blocks keep one blank line between them, and none around them", () => {
  assert.equal(
    replyOf("\n  Run the migration first.  \n\n\n\nThen deploy.\r\n\n"),
    "Run the migration first.\n\nThen deploy.",
  );
  assert.equal(replyOf(" \n\t\n"), "", "nothing but space picked is no reply");
});

test("a long pick is cut to the bound and says so", () => {
  const reply = replyOf("word ".repeat(1000));
  assert.ok(reply.length <= MAX_REPLY_CHARS);
  assert.ok(reply.endsWith("word…"));
});

test("replies lead the message in the order added, each a quote of every line, a blank line after each", () => {
  assert.equal(
    withReplies(["Two options:\n\nA or B", "Ship today."], "Go with B."),
    "> Two options:\n>\n> A or B\n\n> Ship today.\n\nGo with B.",
  );
  assert.equal(withReplies([], "Go with B."), "Go with B.", "no reply sends the words alone");
});

test("a reply is added once, at the end", () => {
  assert.deepEqual(withReplyAdded(["A"], "B"), ["A", "B"]);
  assert.deepEqual(
    withReplyAdded(["A", "B"], "A"),
    ["A", "B"],
    "the same words are not quoted twice",
  );
  assert.deepEqual(withReplyAdded(["A"], ""), ["A"]);
});

test("past the bound the latest replies give way, cut from their ends, and the words go whole", () => {
  const words = "Go with B.";
  const cut = withReplies(["Option A or option B"], words, 24);
  assert.equal(cut, "> Option A…\n\nGo with B.");
  assert.ok(cut.length <= 24);
  assert.equal(withReplies(["Option A or option B"], words, 14), words, "no room left drops it");
  assert.equal(
    withReplies(["Keep me", "Option A or option B"], words, 35),
    "> Keep me\n\n> Option A…\n\nGo with B.",
    "the first stands whole while the latest is cut",
  );
});
