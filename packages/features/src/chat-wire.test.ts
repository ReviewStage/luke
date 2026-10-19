import assert from "node:assert/strict";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Result, type Schema } from "effect";
import { test } from "vitest";
import {
  CHAT_ASK,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_NOTICE_LEAD,
  CHAT_REPLY,
  chatChannelNameSchema,
  chatHandleSchema,
  chatNoticeAsksLine,
  chatNoticeReplyLine,
  chatNoticeWords,
  chatTargetSchema,
  chatWriteRequestSchema,
  mentionedHandles,
  postChatAskInputSchema,
  postChatInputSchema,
} from "./chat-wire.js";

/** Whether the schema takes the value as the wire hands it in. */
function takes(schema: Schema.Codec<unknown, unknown>, value: WireBoundaryInput): boolean {
  return Result.isSuccess(readEither(schema)(unparsedWire(value)));
}

test("a handle is a slug opening on a letter, bounded; anything else is refused", () => {
  for (const handle of ["luke", "agent-12", "charles-2", "a"]) {
    assert.equal(takes(chatHandleSchema, handle), true, handle);
  }
  for (const handle of [
    "",
    "2fast",
    "-agent",
    "Agent",
    "agent_1",
    "agent.1",
    "@luke",
    "a b",
    "a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS + 1),
  ]) {
    assert.equal(takes(chatHandleSchema, handle), false, handle);
  }
});

test("a channel's name is the inbox key's slug, bounded; a sigil, a capital, or a space is refused", () => {
  for (const name of ["general", "billing-export", "v2.api", "2026-plan", "a_b"]) {
    assert.equal(takes(chatChannelNameSchema, name), true, name);
  }
  for (const name of [
    "",
    "#general",
    "General",
    "-lead",
    "two words",
    "x".repeat(CHAT_BOUNDS.MAX_KEY_CHARS + 1),
  ]) {
    assert.equal(takes(chatChannelNameSchema, name), false, name);
  }
});

test("a post goes to `#name` or `@handle` alone, and refuses a key it does not name", () => {
  assert.equal(takes(chatTargetSchema, "#billing-export"), true);
  assert.equal(takes(chatTargetSchema, "@agent-2"), true);
  assert.equal(takes(chatTargetSchema, `@${"a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS)}`), true);
  assert.equal(takes(chatTargetSchema, `@${"a".repeat(CHAT_BOUNDS.MAX_HANDLE_CHARS + 1)}`), false);
  assert.equal(takes(chatTargetSchema, `#${"a".repeat(CHAT_BOUNDS.MAX_KEY_CHARS)}`), true);
  assert.equal(takes(chatTargetSchema, `#${"a".repeat(CHAT_BOUNDS.MAX_KEY_CHARS + 1)}`), false);
  for (const to of ["billing-export", "@2", "#", "@", "#Billing", "@agent 2", "#a #b"]) {
    assert.equal(takes(chatTargetSchema, to), false, to);
  }
  assert.equal(takes(postChatInputSchema, { text: "Taking the table.", to: "#general" }), true);
  assert.equal(takes(postChatInputSchema, { text: "" }), false);
  assert.equal(
    takes(postChatInputSchema, { text: "x".repeat(CHAT_BOUNDS.MAX_TEXT_CHARS + 1) }),
    false,
  );
  assert.equal(
    takes(postChatInputSchema, { text: "Which?", ask: { response: { type: CHAT_ASK.TEXT } } }),
    false,
  );
  assert.equal(
    takes(postChatAskInputSchema, {
      text: "Which?",
      key: "table-owner",
      ask: { response: { type: CHAT_ASK.TEXT } },
    }),
    true,
  );
  assert.equal(
    takes(postChatAskInputSchema, { text: "Which?", ask: { response: { type: CHAT_ASK.TEXT } } }),
    false,
  );
  assert.equal(takes(postChatAskInputSchema, { text: "Plain, no key." }), true);
  // A reply posts into its thread's channel, so it names no destination of its own.
  assert.equal(takes(postChatInputSchema, { text: "Agreed.", replyTo: 41 }), true);
  assert.equal(takes(postChatInputSchema, { text: "Agreed.", replyTo: 41, to: "#general" }), false);
  assert.equal(
    takes(postChatAskInputSchema, { text: "Agreed.", replyTo: 41, to: "@agent-2" }),
    false,
  );
});

test("every kind of ask a post may carry is taken under its key, a task's among them", () => {
  for (const type of Object.values(CHAT_ASK)) {
    assert.equal(
      takes(postChatAskInputSchema, {
        text: "Over to you.",
        key: "next",
        ask: { response: { type } },
      }),
      type !== CHAT_ASK.CHOICE && type !== CHAT_ASK.FORM,
      type,
    );
  }
  assert.equal(
    takes(postChatAskInputSchema, {
      text: "Rotate the key.",
      key: "rotate",
      ask: { response: { type: CHAT_ASK.TASK } },
    }),
    true,
  );
});

test("the handles a post mentions are each named once, in order, and an address or a glued @ is none", () => {
  assert.deepEqual(
    mentionedHandles("@agent-2 and @luke: see @agent-2's note; mail me@example.com or a@@b"),
    ["agent-2", "luke"],
  );
  assert.deepEqual(mentionedHandles("(@charles) done."), ["charles"]);
  assert.deepEqual(mentionedHandles("@luke: yes, and @agent-2's too"), ["luke", "agent-2"]);
  assert.deepEqual(mentionedHandles("ask @agent_2 or @Luke or @team.lead or @x@y"), []);
  assert.deepEqual(mentionedHandles("nobody here"), []);
  // A handle glued to more words is no handle, rather than the handle before its last hyphen.
  assert.deepEqual(mentionedHandles("@agent-2-TEAM and @agent-2-Ops"), []);
});

test("a window's write is a post with its words one way and one place, an answer, a resolve, or a read, and refuses anything between", () => {
  const key = "send-1";
  const link = {
    type: CHAT_BLOCK.LINK,
    url: "https://github.com/acme/relay/pull/12",
    label: "#12",
  };
  for (const write of [
    { text: "Morning.", clientKey: key },
    { text: "@agent-2 take the table.", to: "#billing-export", clientKey: key },
    { text: "On it.", replyTo: 41, clientKey: key },
    { blocks: [link], to: "@agent-2", clientKey: key },
    { answer: { seq: 41, revision: 2, reply: { reply: CHAT_REPLY.APPROVED } }, clientKey: key },
    { resolve: { seq: 41, reason: "Settled in the call." } },
    { readTo: 41 },
    { readTo: 41, channelId: "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f" },
  ]) {
    assert.equal(takes(chatWriteRequestSchema, write), true, JSON.stringify(write));
  }
  for (const write of [
    { clientKey: key },
    { text: "Both.", blocks: [link], clientKey: key },
    { text: "Two places.", to: "#general", replyTo: 41, clientKey: key },
    { text: "No key." },
    { text: "", clientKey: key },
    { blocks: [], clientKey: key },
    {
      blocks: [{ type: CHAT_BLOCK.IMAGE, path: "shot.png", alt: "A picture." }],
      clientKey: key,
    },
    { text: "Stray.", clientKey: key, delivery: "queue" },
    { answer: { seq: 41, revision: 2, reply: { reply: CHAT_REPLY.APPROVED } } },
    { resolve: { seq: 41, reason: "" } },
    { readTo: -1 },
    { readTo: 41, channelId: "general" },
  ]) {
    assert.equal(takes(chatWriteRequestSchema, write), false, JSON.stringify(write));
  }
});

test("a notice's words as a person reads them keep the message alone, without the head the card says or the closing lines telling the agent how to answer, keep a message that itself opens as a closing does, and leave any other text as it is", () => {
  const notice = (words: string, asks?: string) =>
    [
      `${CHAT_NOTICE_LEAD} · @billing-agent in #invoices (m 41):`,
      words,
      ...(asks === undefined ? [] : [chatNoticeAsksLine(asks)]),
      chatNoticeReplyLine(41),
    ].join("\n\n");
  assert.equal(
    chatNoticeWords(notice("Is the refund export\n\nready for review?", "approval")),
    "Is the refund export\n\nready for review?",
  );
  assert.equal(
    chatNoticeWords(notice("Reply with the revised invoice.")),
    "Reply with the revised invoice.",
  );
  assert.equal(
    chatNoticeWords(notice("Check this.\n\nIt asks you nothing, really.")),
    "Check this.\n\nIt asks you nothing, really.",
  );
  assert.equal(chatNoticeWords("Reply with care."), "Reply with care.");
});

test("a topic's purpose is one line within its bound, as an open, an edit, and an agent's post write it, and an edit may clear it", () => {
  const id = "00000000-0000-4000-8000-0000000000c1";
  assert.equal(
    takes(chatWriteRequestSchema, { open: { name: "release", purpose: "Friday" } }),
    true,
  );
  assert.equal(
    takes(chatWriteRequestSchema, { open: { name: "release", purpose: "Friday\nMonday" } }),
    false,
  );
  assert.equal(
    takes(chatWriteRequestSchema, {
      open: { name: "release", purpose: "x".repeat(CHAT_BOUNDS.MAX_PURPOSE_CHARS + 1) },
    }),
    false,
  );
  assert.equal(takes(chatWriteRequestSchema, { edit: { channelId: id, purpose: null } }), true);
  assert.equal(takes(chatWriteRequestSchema, { edit: { channelId: id, purpose: "a\rb" } }), false);
  assert.equal(
    takes(postChatAskInputSchema, { text: "Hi.", to: "#release", purpose: "Two\nlines" }),
    false,
  );
});
