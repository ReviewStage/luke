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
  type InboxAsk,
  type InboxResponse,
  inboxAcknowledgeRequestSchema,
  inboxAnswerFileSchema,
  inboxAnswersRefusal,
  inboxMessageSchema,
  inboxReplyAnswers,
  inboxReplyRefusal,
  inboxThreadPostInputSchema,
  keptInboxAsk,
  recommendedLabels,
} from "./inbox-wire.js";
import {
  countedNumber,
  memberRefSchema,
  readServiceAnswer,
  wireUuidSchema,
} from "./service-wire.js";

/**
 * inbox-asks.test.ts -- the inbox wire's asks: an ask on a thread's
 * message and the answer to it, how each reads off the wire, an answer
 * given against a response read as the answer to the ask it stands for, and
 * every answer an ask refuses.
 * Synthetic items throughout.
 */

const ASKING_ID = "6f1c2a4e-1b9d-4c7e-9a52-3d8e0f4b7c11";
const ITEM_ID = "a4b2c6d8-3e5f-4a7b-8c9d-1e2f3a4b5c6d";

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

/**
 * A message as a desktop that reads a choice's one recommended label
 * declares it, written out as it stood, so the test reads what a released
 * build reads of a choice recommending several.
 */
const oneRecommendedMessageSchema = Schema.Struct({
  id: wireUuidSchema,
  author: Schema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  member: Schema.optionalKey(memberRefSchema),
  text: Schema.String,
  files: Schema.optionalKey(Schema.Array(inboxAnswerFileSchema)),
  createdAt: countedNumber,
  ask: Schema.Struct({
    type: Schema.Literal(INBOX_ASK.DECIDE),
    options: Schema.Array(
      Schema.Struct({ label: Schema.String, detail: Schema.optionalKey(Schema.String) }),
    ),
    multiple: Schema.optionalKey(Schema.Boolean),
    recommended: Schema.optionalKey(Schema.String),
    status: Schema.Literals(Object.values(INBOX_ASK_STATUS)),
  }),
});

/** What a desktop reads off the wire through the schema, or nothing where the read is refused. */
function read<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  value: WireBoundaryInput,
): S["Type"] | undefined {
  return Result.getOrUndefined(readServiceAnswer(schema)(unparsedWire(value)));
}

test("a nod on a notice is a revision, the acknowledgement, and a key, and takes no other answer", () => {
  const nod = { revision: 3, reply: INBOX_REPLY.ACKNOWLEDGED, clientKey: "nod-1" };
  assert.deepEqual(read(inboxAcknowledgeRequestSchema, nod), nod);
  assert.equal(read(inboxAcknowledgeRequestSchema, { ...nod, reply: INBOX_REPLY.DONE }), undefined);
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

test("a decide posted recommending several is kept as its first label and every label, which a desktop reading one label reads as its first", () => {
  const options = [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }];
  const posted = read(inboxThreadPostInputSchema, {
    key: "invite-channels",
    body: "Pick any.",
    ask: { type: INBOX_ASK.DECIDE, options, multiple: true, recommended: ["Slack", "Email"] },
  });
  assert.ok(posted?.ask !== undefined);
  const kept = keptInboxAsk(posted.ask);
  assert.ok(kept.type === INBOX_ASK.DECIDE);
  assert.deepEqual(recommendedLabels(kept), ["Slack", "Email"]);
  const message = { ...ASKING, ask: { ...kept, status: INBOX_ASK_STATUS.OPEN } };
  assert.deepEqual(read(inboxMessageSchema, message), message);
  assert.deepEqual(read(oneRecommendedMessageSchema, message)?.ask, {
    type: INBOX_ASK.DECIDE,
    options,
    multiple: true,
    recommended: "Slack",
    status: INBOX_ASK_STATUS.OPEN,
  });
});

test("an agent's answer ask keeps the option its select recommends", () => {
  const ask = {
    type: INBOX_ASK.ANSWER,
    fields: [
      {
        type: INBOX_FIELD.SELECT,
        label: "Region",
        options: ["us-east", "eu-west"],
        recommended: "eu-west",
      },
    ],
  } as const;
  const posted = read(inboxThreadPostInputSchema, {
    key: "deploy-region",
    title: "Where should it deploy?",
    body: "Two regions are free.",
    ask,
  });
  assert.deepEqual(posted?.ask, ask);
});

test("an answer given against a response reads as the answer to the ask it stands for, Done ticking every step", () => {
  const asking = (view: InboxResponse, ask: InboxAsk) => ({ id: ASKING_ID, ask, view });
  const choice = asking(
    { type: INBOX_RESPONSE.CHOICE, options: DEPLOY.options },
    { type: INBOX_ASK.DECIDE, options: DEPLOY.options },
  );
  const approval = asking(
    { type: INBOX_RESPONSE.APPROVAL },
    {
      type: INBOX_ASK.DECIDE,
      options: [{ label: INBOX_APPROVAL_OPTION.APPROVE }, { label: INBOX_APPROVAL_OPTION.DECLINE }],
    },
  );
  const todo = asking({ type: INBOX_RESPONSE.TODO }, { type: INBOX_ASK.DO, steps: [] });
  const form = asking(
    { type: INBOX_RESPONSE.FORM, fields: REGION.fields },
    { type: INBOX_ASK.ANSWER, fields: REGION.fields },
  );
  const cases = [
    [
      choice,
      { reply: INBOX_REPLY.CHOSE, choices: ["Wait"], note: "Not today." },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["Wait"] },
    ],
    [
      approval,
      { reply: INBOX_REPLY.APPROVED },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.APPROVE] },
    ],
    [
      approval,
      { reply: INBOX_REPLY.DECLINED },
      { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.DECLINE] },
    ],
    [
      choice,
      { reply: INBOX_REPLY.ANSWERED, note: "Neither." },
      { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED },
    ],
    [todo, { reply: INBOX_REPLY.DONE }, { ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [] }],
    [todo, { reply: INBOX_REPLY.NOT_DONE }, { ask: ASKING_ID, reply: INBOX_REPLY.NOT_DONE }],
    [
      form,
      { reply: INBOX_REPLY.SUBMITTED, values: [{ label: "Region", value: "eu-west" }] },
      {
        ask: ASKING_ID,
        reply: INBOX_REPLY.SUBMITTED,
        values: [{ label: "Region", value: "eu-west" }],
      },
    ],
  ] as const;
  for (const [open, reply, answers] of cases) {
    // The answer fits the response it was given against, and its reading fits the ask.
    const note: string | undefined = "note" in reply ? reply.note : undefined;
    assert.equal(inboxReplyRefusal(open.view, reply), undefined, reply.reply);
    const read = inboxReplyAnswers(open, reply);
    assert.deepEqual(read, answers, reply.reply);
    assert.equal(
      read === undefined ? "none" : inboxAnswersRefusal(open.ask, read, note ?? ""),
      undefined,
      reply.reply,
    );
  }
  const words = asking({ type: INBOX_RESPONSE.TEXT }, { type: INBOX_ASK.ANSWER });
  assert.equal(inboxReplyAnswers(words, { reply: INBOX_REPLY.ACKNOWLEDGED }), undefined);
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
  const todo = { type: INBOX_ASK.DO, steps: [] };
  assert.equal(inboxAnswersRefusal(todo, answer(INBOX_REPLY.DONE), ""), undefined);
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

test("a do takes the steps ticked with neither press as an answer, once one is ticked", () => {
  const ticked = (steps?: number[]) => ({
    ask: ASKING_ID,
    reply: INBOX_REPLY.ANSWERED,
    ...(steps === undefined ? undefined : { steps }),
  });
  assert.equal(inboxAnswersRefusal(SECRET, ticked([1]), ""), undefined);
  assert.equal(inboxAnswersRefusal(SECRET, ticked([0, 1]), ""), undefined);
  const refusals = [
    [ticked([]), "The ask does not take that answer."],
    [ticked(), "The ask does not take that answer."],
    [ticked([2]), "A tick names no step of the ask."],
    [ticked([1, 1]), "A step is ticked twice."],
  ] as const;
  for (const [answers, refusal] of refusals) {
    assert.equal(inboxAnswersRefusal(SECRET, answers, "Some words."), refusal, refusal);
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

test("a form filled in part is taken with a required field left empty, as is one given words or a file beside it, while one given nothing at all is not", () => {
  const submitted = (values: { label: string; value: string | number | boolean }[]) => ({
    ask: ASKING_ID,
    reply: INBOX_REPLY.SUBMITTED,
    values,
  });
  const file = { attachmentId: ITEM_ID, name: "plan.pdf", mediaType: "application/pdf" };
  const partial = submitted([{ label: "Replicas", value: 3 }]);
  assert.equal(inboxAnswersRefusal(REGION, partial, ""), undefined);
  assert.equal(inboxAnswersRefusal(REGION, submitted([]), "Whichever is cheaper."), undefined);
  assert.equal(inboxAnswersRefusal(REGION, submitted([]), "", [file]), undefined);
  assert.equal(
    inboxAnswersRefusal(REGION, submitted([]), "  "),
    "A required field of the form is empty.",
  );
  const owner = {
    type: INBOX_ASK.ANSWER,
    fields: [{ type: INBOX_FIELD.TEXT, label: "Owner", required: true }],
  } as const;
  assert.equal(
    inboxAnswersRefusal(owner, submitted([{ label: "Owner", value: "  " }]), "Ask ops."),
    "A required field of the form is empty.",
    "a required field left empty is absent, never there blank",
  );

  const form = { type: INBOX_RESPONSE.FORM, fields: REGION.fields } as const;
  const reply = { reply: INBOX_REPLY.SUBMITTED, values: partial.values };
  assert.equal(inboxReplyRefusal(form, reply), undefined);
  assert.equal(inboxReplyRefusal(form, { ...reply, values: [], note: "Either." }), undefined);
  assert.equal(
    inboxReplyRefusal(form, { ...reply, values: [] }),
    "A required field of the form is empty.",
  );
});
