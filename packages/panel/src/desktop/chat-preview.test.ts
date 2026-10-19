import assert from "node:assert/strict";
import { CHAT_BLOCK, type ChatMessage } from "@luke/features/chat-wire";
import { test } from "vitest";
import { previewWords } from "./chat-preview.js";

function said(...texts: readonly string[]): ChatMessage {
  return {
    id: "m1",
    seq: 1,
    touchedSeq: 1,
    channelId: "general",
    authorId: "00000000-0000-4000-8000-0000000000a4",
    blocks: texts.map((text) => ({ type: CHAT_BLOCK.MARKDOWN, text })),
    mentions: [],
    postedAt: 1,
  };
}

test("a preview reads a message as one plain line: a chip by its label, no Markdown marks, a picture by its words", () => {
  const message: ChatMessage = {
    ...said(),
    blocks: [
      {
        type: CHAT_BLOCK.MARKDOWN,
        text: "## Heads up\n**[@agent-2](https://tryluke.dev/acme/agent/x)** read `memberships`",
      },
      { type: CHAT_BLOCK.IMAGE, attachmentId: "a", alt: "mock.png" },
    ],
  };
  assert.equal(previewWords(message), "Heads up @agent-2 read memberships mock.png");
});

test("a preview keeps every word the message shows as written: an identifier's underscores, a lone star, a code span's marks", () => {
  assert.equal(
    previewWords(said("Set user_id to 2 * 3, _now_, ~~not~~ via `a_b*c` and ``a`b`` __here__")),
    "Set user_id to 2 * 3, now, not via a_b*c and a`b here",
  );
});

test("a preview drops a fence and its language, nested emphasis, and emphasis across lines, as the message draws them", () => {
  assert.equal(previewWords(said("Run:\n```ts\nfoo()\n```")), "Run: foo()");
  assert.equal(previewWords(said("***hello***")), "hello");
  assert.equal(previewWords(said("**bold\nand bold**")), "bold and bold");
  assert.equal(previewWords(said("- one\n- two\n\n> quoted")), "one two quoted");
});
