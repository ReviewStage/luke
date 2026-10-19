import assert from "node:assert/strict";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Result, Schema } from "effect";
import { test } from "vitest";
import {
  INBOX_APPROVAL_OPTION,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  inboxAnswerFileSchema,
  inboxAnswersRefusal,
  inboxAskResponse,
  inboxItemSchema,
  inboxMessageSchema,
  inboxReplyAnswers,
  inboxReplyRefusal,
  inboxResponseAsk,
} from "./inbox-wire.js";
import {
  countedNumber,
  memberRefSchema,
  readServiceAnswer,
  wireUuidSchema,
} from "./service-wire.js";

/**
 * inbox-asks.test.ts -- version 5 of the inbox wire: an ask on a thread's
 * message and the answer to it, how each reads off the wire, a desktop
 * before version 5 reading the same item, the mapping between an ask and
 * the version 4 response nearest it both ways, an older desktop's answer
 * read as the answer to the open ask, and every answer an ask refuses.
 * Synthetic items throughout.
 */

const ASKING_ID = "6f1c2a4e-1b9d-4c7e-9a52-3d8e0f4b7c11";
const ANSWERING_ID = "0d3e5b7a-2c4f-4e8a-b1d6-9f7a3c5e2b40";
const ITEM_ID = "a4b2c6d8-3e5f-4a7b-8c9d-1e2f3a4b5c6d";
const AGENT_ID = "b1c3d5e7-4f6a-4b8c-9d0e-2f3a4b5c6d7e";
const MEMBER = { userId: "user-dean", name: "Dean" };

const DEPLOY = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "Ship it", detail: "Today, behind the flag." }, { label: "Wait" }],
  recommended: "Ship it",
} as const;

const SECRET = {
  type: INBOX_ASK.DO,
  steps: ["Open the repository's **Settings → Secrets**.", "Add `SENTRY_DSN`."],
} as const;

const REGION = {
  type: INBOX_ASK.ANSWER,
  fields: [
    { type: INBOX_FIELD.SELECT, label: "Region", options: ["us-east", "eu-west"], required: true },
    { type: INBOX_FIELD.NUMBER, label: "Replicas" },
  ],
} as const;

const WORDS = { type: INBOX_ASK.ANSWER } as const;

/** The agent's message asking, and a member's answering it, as a version 5 service writes them. */
const ASKING = {
  id: ASKING_ID,
  author: INBOX_MESSAGE_AUTHOR.AGENT,
  text: "Ready to deploy the billing export.",
  ask: { ...DEPLOY, status: INBOX_ASK_STATUS.ANSWERED },
  createdAt: 1_000,
};
const ANSWERING = {
  id: ANSWERING_ID,
  author: INBOX_MESSAGE_AUTHOR.MEMBER,
  member: MEMBER,
  text: "Go ahead.",
  answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["Ship it"] },
  createdAt: 2_000,
};

/** An item as a version 5 service writes it: its response a view of the ask, its thread carrying the ask and its answer. */
const ITEM = {
  id: ITEM_ID,
  agentId: AGENT_ID,
  key: "deploy-billing",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Deploy the billing export?",
  blocks: [{ type: "markdown", text: "Ready to deploy the billing export." }],
  response: inboxAskResponse(DEPLOY),
  needsReply: true,
  status: INBOX_STATUS.ANSWERED,
  answer: { reply: INBOX_REPLY.CHOSE, choices: ["Ship it"], note: "Go ahead." },
  messages: [ASKING, ANSWERING],
  postedAt: 1_000,
  updatedAt: 2_000,
};

/**
 * A message as a desktop before version 5 declares one, written out as it
 * stood, so the test reads what a released build reads rather than this
 * build's schema with its new keys taken off.
 */
const v4MessageSchema = Schema.Struct({
  id: wireUuidSchema,
  author: Schema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  member: Schema.optionalKey(memberRefSchema),
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(inboxAnswerFileSchema)),
  createdAt: countedNumber,
});
const v4ItemSchema = Schema.Struct({
  ...inboxItemSchema.fields,
  messages: Schema.optionalKey(Schema.Array(v4MessageSchema)),
});

/** What a desktop reads off the wire through the schema, or nothing where the read is refused. */
function read<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  value: WireBoundaryInput,
): S["Type"] | undefined {
  return Result.getOrUndefined(readServiceAnswer(schema)(unparsedWire(value)));
}

test("a message reads with its ask and where it stands, with the answer it carries, and with neither", () => {
  assert.deepEqual(read(inboxMessageSchema, ASKING), ASKING);
  assert.deepEqual(read(inboxMessageSchema, ANSWERING), ANSWERING);
  const plain = { id: ASKING_ID, author: INBOX_MESSAGE_AUTHOR.AGENT, text: "On it.", createdAt: 1 };
  assert.deepEqual(read(inboxMessageSchema, plain), plain);
  const withdrawn = {
    ...ASKING,
    ask: { ...SECRET, status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: "Found the key." },
  };
  assert.deepEqual(read(inboxMessageSchema, withdrawn), withdrawn);
  const replaced = { ...ASKING, ask: { ...WORDS, status: INBOX_ASK_STATUS.REPLACED } };
  assert.deepEqual(read(inboxMessageSchema, replaced), replaced);
});

test("a known ask that fails its own shape is refused, and an ask without where it stands is too", () => {
  const oneOption = {
    ...ASKING,
    ask: { ...DEPLOY, options: [{ label: "Ship it" }], status: "open" },
  };
  assert.equal(read(inboxMessageSchema, oneOption), undefined);
  const nineSteps = {
    ...ASKING,
    ask: { ...SECRET, steps: Array(9).fill("Step."), status: "open" },
  };
  assert.equal(read(inboxMessageSchema, nineSteps), undefined);
  assert.equal(read(inboxMessageSchema, { ...ASKING, ask: DEPLOY }), undefined);
});

test("an ask of a type this build does not know reads as its type and where it stands alone", () => {
  const vote = {
    ...ASKING,
    ask: { type: "vote", ballots: ["a", "b"], status: INBOX_ASK_STATUS.OPEN },
  };
  assert.deepEqual(read(inboxMessageSchema, vote)?.ask, {
    type: "vote",
    status: INBOX_ASK_STATUS.OPEN,
  });
});

test("a desktop before version 5 reads a version 5 item whole, its response the ask's view and its messages without the new keys", () => {
  const v4 = read(v4ItemSchema, ITEM);
  assert.notEqual(v4, undefined);
  assert.deepEqual(v4?.response, {
    type: INBOX_RESPONSE.CHOICE,
    options: DEPLOY.options,
    recommended: "Ship it",
  });
  assert.deepEqual(
    v4?.messages?.map((message) => Object.keys(message).sort()),
    [
      ["author", "createdAt", "id", "text"],
      ["author", "createdAt", "id", "member", "text"],
    ],
  );
  assert.deepEqual(read(inboxItemSchema, ITEM)?.messages, [ASKING, ANSWERING]);
});

test("an ask maps to the version 4 response nearest it", () => {
  assert.deepEqual(inboxAskResponse({ ...DEPLOY, multiple: true }), {
    type: INBOX_RESPONSE.CHOICE,
    options: DEPLOY.options,
    multiple: true,
    recommended: "Ship it",
  });
  assert.deepEqual(inboxAskResponse(SECRET), { type: INBOX_RESPONSE.TODO });
  assert.deepEqual(inboxAskResponse(REGION), {
    type: INBOX_RESPONSE.FORM,
    fields: REGION.fields,
  });
  assert.deepEqual(inboxAskResponse(WORDS), { type: INBOX_RESPONSE.TEXT });
});

test("a stored version 4 response maps to the ask it stands for, and an acknowledgement to none", () => {
  const options = [{ label: "Postgres" }, { label: "SQLite", detail: "Simpler." }];
  assert.deepEqual(
    inboxResponseAsk({
      type: INBOX_RESPONSE.CHOICE,
      options,
      multiple: true,
      recommended: "Postgres",
    }),
    { type: INBOX_ASK.DECIDE, options, multiple: true, recommended: "Postgres" },
  );
  assert.deepEqual(inboxResponseAsk({ type: INBOX_RESPONSE.APPROVAL }), {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Approve" }, { label: "Decline" }],
  });
  assert.deepEqual(inboxResponseAsk({ type: INBOX_RESPONSE.TODO }), {
    type: INBOX_ASK.DO,
    steps: [],
  });
  assert.deepEqual(inboxResponseAsk({ type: INBOX_RESPONSE.FORM, fields: REGION.fields }), {
    type: INBOX_ASK.ANSWER,
    fields: REGION.fields,
  });
  assert.deepEqual(inboxResponseAsk({ type: INBOX_RESPONSE.TEXT, placeholder: "Which one?" }), {
    type: INBOX_ASK.ANSWER,
  });
  assert.equal(inboxResponseAsk({ type: INBOX_RESPONSE.NONE }), undefined);
});

test("an older desktop's answer reads as the answer to the open ask, Done ticking every step", () => {
  const asking = (ask: Parameters<typeof inboxAskResponse>[0]) => ({
    id: ASKING_ID,
    ask,
    view: inboxAskResponse(ask),
  });
  // A stored approval keeps its own response as the view an older desktop answers.
  const stored = { type: INBOX_RESPONSE.APPROVAL } as const;
  const approval = inboxResponseAsk(stored);
  assert.notEqual(approval, undefined);
  if (approval === undefined) return;
  const approvalAsking = { id: ASKING_ID, ask: approval, view: stored };
  const cases = [
    [
      asking(DEPLOY),
      { reply: INBOX_REPLY.CHOSE, choices: ["Wait"], note: "Not today." },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["Wait"] },
    ],
    [
      approvalAsking,
      { reply: INBOX_REPLY.APPROVED },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.APPROVE] },
    ],
    [
      approvalAsking,
      { reply: INBOX_REPLY.DECLINED },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.DECLINE] },
    ],
    [
      asking(DEPLOY),
      { reply: INBOX_REPLY.ANSWERED, note: "Neither." },
      { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED },
    ],
    [
      asking(SECRET),
      { reply: INBOX_REPLY.DONE },
      { ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1] },
    ],
    [
      asking(SECRET),
      { reply: INBOX_REPLY.NOT_DONE },
      { ask: ASKING_ID, reply: INBOX_REPLY.NOT_DONE },
    ],
    [
      asking(REGION),
      { reply: INBOX_REPLY.SUBMITTED, values: [{ label: "Region", value: "eu-west" }] },
      {
        ask: ASKING_ID,
        reply: INBOX_REPLY.SUBMITTED,
        values: [{ label: "Region", value: "eu-west" }],
      },
    ],
  ] as const;
  for (const [open, reply, answers] of cases) {
    // The older desktop's answer fits the view it was given, and its reading fits the ask.
    const note: string | undefined = "note" in reply ? reply.note : undefined;
    assert.equal(inboxReplyRefusal({ response: open.view }, reply), undefined, reply.reply);
    const read = inboxReplyAnswers(open, reply);
    assert.deepEqual(read, answers, reply.reply);
    assert.equal(
      read === undefined ? "none" : inboxAnswersRefusal(open.ask, read, note ?? ""),
      undefined,
      reply.reply,
    );
  }
  assert.equal(inboxReplyAnswers(asking(WORDS), { reply: INBOX_REPLY.ACKNOWLEDGED }), undefined);
});

test("a decide takes a pick of its offered options, or words or files where none fits", () => {
  const answer = (
    reply: (typeof INBOX_REPLY)[keyof typeof INBOX_REPLY],
    choices: string[] = [],
  ) => ({
    ask: ASKING_ID,
    reply,
    choices,
  });
  const several = { ...DEPLOY, multiple: true };
  assert.equal(inboxAnswersRefusal(DEPLOY, answer(INBOX_REPLY.CHOSE, ["Wait"]), ""), undefined);
  assert.equal(
    inboxAnswersRefusal(several, answer(INBOX_REPLY.CHOSE, ["Wait", "Ship it"]), ""),
    undefined,
  );
  assert.equal(inboxAnswersRefusal(DEPLOY, answer(INBOX_REPLY.ANSWERED), "Neither."), undefined);
  const file = { attachmentId: ITEM_ID, name: "plan.pdf", mediaType: "application/pdf" };
  assert.equal(inboxAnswersRefusal(DEPLOY, answer(INBOX_REPLY.ANSWERED), "", [file]), undefined);
  const refusals = [
    [DEPLOY, answer(INBOX_REPLY.CHOSE), "A pick names no option."],
    [DEPLOY, answer(INBOX_REPLY.CHOSE, ["Wait", "Ship it"]), "The choice takes one option."],
    [several, answer(INBOX_REPLY.CHOSE, ["Wait", "Wait"]), "A pick names an option twice."],
    [DEPLOY, answer(INBOX_REPLY.CHOSE, ["Later"]), "The pick names no option of the item."],
    [
      DEPLOY,
      answer(INBOX_REPLY.ANSWERED),
      "An answer in the developer's own words needs words or a file.",
    ],
    [DEPLOY, answer(INBOX_REPLY.APPROVED), "The ask does not take that answer."],
    [DEPLOY, answer(INBOX_REPLY.DONE), "The ask does not take that answer."],
  ] as const;
  for (const [ask, answers, refusal] of refusals) {
    assert.equal(inboxAnswersRefusal(ask, answers, "  "), refusal, refusal);
  }
});

test("a do takes Mark done once every step is ticked, or Couldn't do it with any ticked", () => {
  const answer = (
    reply: typeof INBOX_REPLY.DONE | typeof INBOX_REPLY.NOT_DONE,
    steps: number[] = [],
  ) => ({
    ask: ASKING_ID,
    reply,
    steps,
  });
  assert.equal(inboxAnswersRefusal(SECRET, answer(INBOX_REPLY.DONE, [1, 0]), ""), undefined);
  assert.equal(inboxAnswersRefusal(SECRET, answer(INBOX_REPLY.NOT_DONE, [0]), ""), undefined);
  assert.equal(inboxAnswersRefusal(SECRET, answer(INBOX_REPLY.NOT_DONE), ""), undefined);
  // A stored to-do maps to a do of no steps, which Mark done answers ticking none.
  const todo = inboxResponseAsk({ type: INBOX_RESPONSE.TODO });
  assert.notEqual(todo, undefined);
  if (todo !== undefined) {
    assert.equal(inboxAnswersRefusal(todo, answer(INBOX_REPLY.DONE), ""), undefined);
  }
  const refusals = [
    [answer(INBOX_REPLY.DONE, [0]), "Mark done needs every step ticked."],
    [answer(INBOX_REPLY.DONE), "Mark done needs every step ticked."],
    [answer(INBOX_REPLY.DONE, [0, 0, 1]), "A step is ticked twice."],
    [answer(INBOX_REPLY.NOT_DONE, [2]), "A tick names no step of the ask."],
    [{ ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED }, "The ask does not take that answer."],
  ] as const;
  for (const [answers, refusal] of refusals) {
    assert.equal(inboxAnswersRefusal(SECRET, answers, "Done."), refusal, refusal);
  }
});

test("an answer with fields takes their values filled, and one without takes words or files", () => {
  const submitted = (values: { label: string; value: string | number | boolean }[]) => ({
    ask: ASKING_ID,
    reply: INBOX_REPLY.SUBMITTED,
    values,
  });
  const answered = { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED };
  assert.equal(
    inboxAnswersRefusal(REGION, submitted([{ label: "Region", value: "us-east" }]), ""),
    undefined,
  );
  assert.equal(inboxAnswersRefusal(WORDS, answered, "Use the staging key."), undefined);
  const refusals = [
    [REGION, submitted([]), "", "A required field of the form is empty."],
    [
      REGION,
      submitted([{ label: "Region", value: "mars" }]),
      "",
      "A value is not of its field's type.",
    ],
    [REGION, submitted([{ label: "Zone", value: "a" }]), "", "A value names no field of the form."],
    [REGION, answered, "us-east", "The ask does not take that answer."],
    [WORDS, answered, " ", "An answer in the developer's own words needs words or a file."],
    [WORDS, submitted([]), "Here.", "The ask does not take that answer."],
  ] as const;
  for (const [ask, answers, words, refusal] of refusals) {
    assert.equal(inboxAnswersRefusal(ask, answers, words), refusal, refusal);
  }
});
