import assert from "node:assert/strict";
import { test } from "vitest";
import { MAX_REPLY_CHARS, replyOf, withReply } from "./reply-quote.js";

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

test("a reply leads the message as a quote of every line, a blank line before the words", () => {
  assert.equal(
    withReply("Two options:\n\nA or B", "Go with B."),
    "> Two options:\n>\n> A or B\n\nGo with B.",
  );
  assert.equal(withReply("", "Go with B."), "Go with B.", "no reply sends the words alone");
});

test("past the bound the reply gives way, cut from its end, and the words go whole", () => {
  const words = "Go with B.";
  const cut = withReply("Option A or option B", words, 24);
  assert.equal(cut, "> Option A…\n\nGo with B.");
  assert.ok(cut.length <= 24);
  assert.equal(withReply("Option A or option B", words, 14), words, "no room left drops the reply");
});
