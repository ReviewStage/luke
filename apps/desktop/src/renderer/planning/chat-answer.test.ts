import assert from "node:assert/strict";
import {
  CHAT_ASK,
  CHAT_BOUNDS,
  CHAT_FIELD,
  CHAT_REPLY,
  type ChatResponse,
} from "@luke/features/chat-wire";
import { test } from "vitest";
import { chatReply, EMPTY_CHAT_DRAFT, withChoice, withValue } from "./chat-answer";

const QUEUE: ChatResponse = {
  type: CHAT_ASK.CHOICE,
  options: [{ label: "Postgres" }, { label: "Redis" }],
};

const CHANNELS: ChatResponse = {
  type: CHAT_ASK.CHOICE,
  options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
  multiple: true,
};

const SMTP: ChatResponse = {
  type: CHAT_ASK.FORM,
  fields: [
    { type: CHAT_FIELD.TEXT, label: "Host", required: true },
    { type: CHAT_FIELD.NUMBER, label: "Port" },
    { type: CHAT_FIELD.SELECT, label: "Security", options: ["TLS", "STARTTLS"] },
    { type: CHAT_FIELD.BOOLEAN, label: "Verify certificate" },
  ],
};

const CONSENT: ChatResponse = {
  type: CHAT_ASK.FORM,
  fields: [{ type: CHAT_FIELD.BOOLEAN, label: "Keep the old route?", required: true }],
};

const TASK: ChatResponse = { type: CHAT_ASK.TASK };
const NONE: ChatResponse = { type: CHAT_ASK.NONE };
const WORDS: ChatResponse = { type: CHAT_ASK.TEXT };

test("a choice is answered by its option with the note beside it, or by the developer's own words, and holds no answer with neither", () => {
  assert.equal(chatReply(QUEUE, EMPTY_CHAT_DRAFT), undefined);
  assert.deepEqual(
    chatReply(QUEUE, { ...EMPTY_CHAT_DRAFT, choices: ["Redis"], note: " Keep it simple. " }),
    {
      reply: CHAT_REPLY.CHOSE,
      choices: ["Redis"],
      note: "Keep it simple.",
    },
  );
  assert.deepEqual(chatReply(QUEUE, { ...EMPTY_CHAT_DRAFT, note: "Use SQS." }), {
    reply: CHAT_REPLY.ANSWERED,
    note: "Use SQS.",
  });
  assert.equal(
    chatReply(QUEUE, { ...EMPTY_CHAT_DRAFT, choices: ["SQS"] }),
    undefined,
    "no such option",
  );
});

test("a press picks one option at a time on a choice and any number where the choice allows several, pressing a picked one again lets it go, and the picks are the answer in the order pressed", () => {
  const one = withChoice(withChoice(EMPTY_CHAT_DRAFT, "Postgres", false), "Redis", false);
  assert.deepEqual(one.choices, ["Redis"]);
  assert.deepEqual(withChoice(one, "Redis", false).choices, []);
  const several = withChoice(withChoice(EMPTY_CHAT_DRAFT, "Slack", true), "Email", true);
  assert.deepEqual(several.choices, ["Slack", "Email"]);
  assert.deepEqual(withChoice(several, "Slack", true).choices, ["Email"]);
  assert.deepEqual(chatReply(CHANNELS, several), {
    reply: CHAT_REPLY.CHOSE,
    choices: ["Slack", "Email"],
  });
  assert.equal(
    chatReply(QUEUE, { ...EMPTY_CHAT_DRAFT, choices: ["Postgres", "Redis"] }),
    undefined,
    "a choice of one takes no two",
  );
});

test("a form is answered by its fields in the form's own order whatever order they were filled in, a blank text left out, a required one holding the answer back, a switch left alone sent as no, and a field's value replacing the one before it", () => {
  assert.equal(chatReply(SMTP, EMPTY_CHAT_DRAFT), undefined, "Host is required");
  let draft = withValue(EMPTY_CHAT_DRAFT, "Host", "  ");
  assert.equal(chatReply(SMTP, draft), undefined, "blank is not filled");
  draft = withValue(draft, "Security", "TLS");
  draft = withValue(draft, "Port", 25);
  draft = withValue(draft, "Port", 587);
  draft = withValue(draft, "Host", " smtp.acme.test ");
  assert.deepEqual(chatReply(SMTP, { ...draft, note: "Staging." }), {
    reply: CHAT_REPLY.SUBMITTED,
    values: [
      { label: "Host", value: "smtp.acme.test" },
      { label: "Port", value: 587 },
      { label: "Security", value: "TLS" },
      { label: "Verify certificate", value: false },
    ],
    note: "Staging.",
  });
  draft = withValue(draft, "Verify certificate", true);
  assert.deepEqual(chatReply(SMTP, draft)?.values?.at(-1), {
    label: "Verify certificate",
    value: true,
  });
  assert.deepEqual(
    withValue(draft, "Port", undefined).values.map((each) => each.label),
    ["Security", "Host", "Verify certificate"],
  );
  assert.deepEqual(chatReply(CONSENT, EMPTY_CHAT_DRAFT), {
    reply: CHAT_REPLY.SUBMITTED,
    values: [{ label: "Keep the old route?", value: false }],
  });
});

test("an approval, a task, and an ask of nothing are answered by their presses alone, and words by words", () => {
  assert.equal(chatReply(TASK, { ...EMPTY_CHAT_DRAFT, note: "done it" }), undefined);
  assert.deepEqual(chatReply(TASK, EMPTY_CHAT_DRAFT, CHAT_REPLY.DONE), {
    reply: CHAT_REPLY.DONE,
  });
  assert.equal(
    chatReply(TASK, EMPTY_CHAT_DRAFT, CHAT_REPLY.APPROVED),
    undefined,
    "a task takes no approval",
  );
  assert.equal(chatReply(NONE, { ...EMPTY_CHAT_DRAFT, note: "ok" }), undefined);
  assert.deepEqual(chatReply(NONE, { ...EMPTY_CHAT_DRAFT, note: "ok" }, CHAT_REPLY.ACKNOWLEDGED), {
    reply: CHAT_REPLY.ACKNOWLEDGED,
    note: "ok",
  });
  assert.equal(chatReply(WORDS, { ...EMPTY_CHAT_DRAFT, note: "  " }), undefined);
  assert.deepEqual(chatReply(WORDS, { ...EMPTY_CHAT_DRAFT, note: "Hello" }), {
    reply: CHAT_REPLY.ANSWERED,
    note: "Hello",
  });
});

test("a note past the wire's bound is no answer, so the card offers no send for it", () => {
  const long = "x".repeat(CHAT_BOUNDS.MAX_NOTE_CHARS + 1);
  assert.equal(chatReply(WORDS, { ...EMPTY_CHAT_DRAFT, note: long }), undefined);
  assert.equal(
    chatReply(QUEUE, { ...EMPTY_CHAT_DRAFT, choices: ["Redis"], note: long }),
    undefined,
  );
});
