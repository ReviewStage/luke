import assert from "node:assert/strict";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxAsk,
  type InboxItem,
  type InboxMessage,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { test } from "vitest";
import {
  ANSWER_TONE,
  awaitsNod,
  CODE_READ,
  codeNotice,
  codeReadOf,
  codeWindow,
  EMPTY_INBOX_DRAFT,
  EVERYONES,
  firstChoice,
  holderName,
  INBOX_DIRECTION,
  INBOX_GROUPING,
  INBOX_LINE,
  INBOX_MEDIA,
  INBOX_MISSING,
  INBOX_SHOW,
  INBOX_SORT,
  INBOX_STATUS_GROUP,
  INBOX_WHOSE,
  type InboxDraft,
  type InboxGrouping,
  type InboxListView,
  type InboxShow,
  type InboxSort,
  type InboxWhose,
  inboxBoard,
  inboxCommentFiles,
  inboxCounts,
  inboxLineKind,
  inboxList,
  inboxMedia,
  inboxMissing,
  inboxPreview,
  inboxReply,
  inboxSettledWords,
  inboxSteps,
  inboxThreadOf,
  inboxThreadSend,
  listedItems,
  nextNeedingYou,
  numberedPick,
  openItems,
  proposedOptions,
  SETTLED_BY,
  sentStamp,
  settlementOf,
  shownTicks,
  taskHolder,
  tasklessGroups,
  withChoice,
  withDecision,
  withStep,
  withValue,
} from "./inbox-model.js";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const UNLISTED = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** An item of the agent's, open and asking words, as the service answers one. */
function item(overrides: Partial<InboxItem> & Pick<InboxItem, "id">): InboxItem {
  return {
    agentId: AGENT,
    key: overrides.id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "What should the email say?",
    blocks: [],
    response: { type: INBOX_RESPONSE.TEXT },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const DANA = { userId: "user-dana", name: "Dana Reyes" };

const QUEUE = item({
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres" }, { label: "Redis" }],
  },
});

const CHANNELS = item({
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
    multiple: true,
  },
});

const SMTP = item({
  id: "a1b2c3d4-0000-4000-8000-000000000003",
  response: {
    type: INBOX_RESPONSE.FORM,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Host", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Port" },
      { type: INBOX_FIELD.SELECT, label: "Security", options: ["TLS", "STARTTLS"] },
      { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
    ],
  },
});

test("the board holds every item the plan's inbox holds, an agent the window has not listed yet's too: what waits the oldest posted first, what is settled the latest changed first", () => {
  const board = inboxBoard([
    item({ id: "late", postedAt: 30, updatedAt: 30 }),
    item({ id: "early", postedAt: 10, updatedAt: 40 }),
    item({ id: "answered", status: INBOX_STATUS.ANSWERED, updatedAt: 20 }),
    item({ id: "closed", status: INBOX_STATUS.CLOSED, updatedAt: 50 }),
    item({ id: "unlisted", agentId: UNLISTED, postedAt: 20, updatedAt: 20 }),
  ]);
  assert.deepEqual(
    board.open.map((each) => each.id),
    ["early", "unlisted", "late"],
  );
  assert.deepEqual(
    board.settled.map((each) => each.id),
    ["closed", "answered"],
  );
});

test("a choice is answered by its option with the note beside it, or by the developer's own words, and holds no answer with neither", () => {
  assert.equal(inboxReply(QUEUE, EMPTY_INBOX_DRAFT), undefined);
  assert.deepEqual(
    inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["Redis"], note: " Keep it simple. " }),
    {
      reply: INBOX_REPLY.CHOSE,
      choices: ["Redis"],
      note: "Keep it simple.",
    },
  );
  assert.deepEqual(inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, note: "Use SQS." }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Use SQS.",
  });
  assert.equal(
    inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["SQS"] }),
    undefined,
    "no such option",
  );
});

test("the picks are the answer in the order pressed, and a choice of one takes no two", () => {
  const several = { ...EMPTY_INBOX_DRAFT, choices: ["Slack", "Email"] };
  assert.deepEqual(inboxReply(CHANNELS, several), {
    reply: INBOX_REPLY.CHOSE,
    choices: ["Slack", "Email"],
  });
  assert.equal(
    inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["Postgres", "Redis"] }),
    undefined,
    "a choice of one takes no two",
  );
});

test("a form is answered by its fields in the form's own order whatever order they were filled in, a blank text left out, a required one holding back a form given nothing, a switch left alone sent as no, and a field's value replacing the one before it", () => {
  assert.equal(inboxReply(SMTP, EMPTY_INBOX_DRAFT), undefined, "Host is required");
  let draft = withValue(EMPTY_INBOX_DRAFT, "Host", "  ");
  assert.equal(inboxReply(SMTP, draft), undefined, "blank is not filled");
  draft = withValue(draft, "Security", "TLS");
  draft = withValue(draft, "Port", 25);
  draft = withValue(draft, "Port", 587);
  draft = withValue(draft, "Host", " smtp.acme.test ");
  assert.deepEqual(inboxReply(SMTP, { ...draft, note: "Staging." }), {
    reply: INBOX_REPLY.SUBMITTED,
    values: [
      { label: "Host", value: "smtp.acme.test" },
      { label: "Port", value: 587 },
      { label: "Security", value: "TLS" },
      { label: "Verify certificate", value: false },
    ],
    note: "Staging.",
  });
  draft = withValue(draft, "Verify certificate", true);
  assert.deepEqual(inboxReply(SMTP, draft)?.values?.at(-1), {
    label: "Verify certificate",
    value: true,
  });
  assert.deepEqual(
    withValue(draft, "Port", undefined).values.map((each) => each.label),
    ["Security", "Host", "Verify certificate"],
  );
  const consent = item({
    id: "consent",
    response: {
      type: INBOX_RESPONSE.FORM,
      fields: [{ type: INBOX_FIELD.BOOLEAN, label: "Keep the old route?", required: true }],
    },
  });
  assert.deepEqual(inboxReply(consent, EMPTY_INBOX_DRAFT), {
    reply: INBOX_REPLY.SUBMITTED,
    values: [{ label: "Keep the old route?", value: false }],
  });
});

test("a form filled in part sends what was filled, a required field left empty absent from its values, as does one given only the developer's words or files; one given nothing, a switch left alone filling nothing, sends nothing", () => {
  const settings = item({
    id: "settings",
    response: {
      type: INBOX_RESPONSE.FORM,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Host", required: true },
        { type: INBOX_FIELD.NUMBER, label: "Port", required: true },
        { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
      ],
    },
  });
  assert.equal(inboxReply(settings, EMPTY_INBOX_DRAFT), undefined);
  assert.equal(inboxReply(settings, withValue(EMPTY_INBOX_DRAFT, "Host", "  ")), undefined);
  assert.deepEqual(inboxReply(settings, withValue(EMPTY_INBOX_DRAFT, "Port", 587)), {
    reply: INBOX_REPLY.SUBMITTED,
    values: [
      { label: "Port", value: 587 },
      { label: "Verify certificate", value: false },
    ],
  });
  assert.deepEqual(inboxReply(settings, { ...EMPTY_INBOX_DRAFT, note: "Ask ops for it." }), {
    reply: INBOX_REPLY.SUBMITTED,
    values: [{ label: "Verify certificate", value: false }],
    note: "Ask ops for it.",
  });
  const files = [{ name: "smtp.txt", mediaType: "text/plain", data: btoa("host\n") }] as const;
  assert.equal(
    inboxReply(settings, { ...EMPTY_INBOX_DRAFT, attachments: files })?.reply,
    INBOX_REPLY.SUBMITTED,
  );
});

test("a thread's form attaches its values to the reply as they are filled, with no press, a required field left empty absent from them; a reply with nothing filled stays plain, a switch left alone filling nothing", () => {
  const form = [
    asking({
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Host", required: true },
        { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate", required: true },
      ],
    }),
  ];
  assert.equal(inboxThreadSend(form, EMPTY_INBOX_DRAFT), undefined, "nothing filled sends nothing");
  assert.deepEqual(
    inboxThreadSend(form, { ...EMPTY_INBOX_DRAFT, note: "Which host?" }),
    { text: "Which host?", attachments: [] },
    "words alone are a plain reply, keeping the ask open",
  );
  const partial = withValue(EMPTY_INBOX_DRAFT, "Verify certificate", true);
  const sent = inboxThreadSend(form, { ...partial, note: "No host yet." });
  assert.deepEqual(sent, {
    text: "No host yet.",
    attachments: [],
    answers: {
      ask: ASKING_ID,
      reply: INBOX_REPLY.SUBMITTED,
      values: [{ label: "Verify certificate", value: true }],
    },
  });
});

test("what an answer lacks is said by what it asks: a choice its pick, unless the developer's own words or files answer it, a form given nothing its first required field left empty in the form's order, and words their words; nothing once it lacks nothing", () => {
  assert.deepEqual(inboxMissing(QUEUE, EMPTY_INBOX_DRAFT), {
    kind: INBOX_MISSING.OPTION,
    line: "Pick an option",
  });
  assert.deepEqual(inboxMissing(CHANNELS, EMPTY_INBOX_DRAFT), {
    kind: INBOX_MISSING.OPTION,
    line: "Pick at least one",
  });
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["Redis"] }), undefined);
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, note: "Use SQS." }), undefined);
  const files = [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }] as const;
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, attachments: files }), undefined);

  const rollout = item({
    id: "rollout",
    response: {
      type: INBOX_RESPONSE.FORM,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Branch prefix" },
        { type: INBOX_FIELD.SELECT, label: "Effort", required: true, options: ["high", "xhigh"] },
        { type: INBOX_FIELD.TEXT, label: "Reviewer", required: true },
        { type: INBOX_FIELD.BOOLEAN, label: "Post in #eng", required: true },
      ],
    },
  });
  assert.deepEqual(inboxMissing(rollout, EMPTY_INBOX_DRAFT), {
    kind: INBOX_MISSING.FIELD,
    label: "Effort",
    line: "Fill in Effort",
  });
  assert.deepEqual(
    inboxMissing(rollout, withValue(EMPTY_INBOX_DRAFT, "Reviewer", "  ")),
    { kind: INBOX_MISSING.FIELD, label: "Effort", line: "Fill in Effort" },
    "blank words fill nothing",
  );
  const effort = withValue(EMPTY_INBOX_DRAFT, "Effort", "high");
  assert.equal(
    inboxMissing(rollout, effort),
    undefined,
    "a form filled in part lacks nothing, sending what was filled",
  );
  assert.equal(
    inboxMissing(rollout, withValue(effort, "Reviewer", "Dean")),
    undefined,
    "a yes-or-no left alone is a no",
  );

  const question = item({ id: "question" });
  assert.deepEqual(inboxMissing(question, { ...EMPTY_INBOX_DRAFT, note: " " }), {
    kind: INBOX_MISSING.WORDS,
    line: "Write your answer",
  });
  assert.equal(inboxMissing(question, { ...EMPTY_INBOX_DRAFT, note: "Hello" }), undefined);
});

test("an option picked by its number is the one pick of a choice of one, picked again it stays; of a choice of several it joins the picks, and picked again it leaves them", () => {
  assert.deepEqual(
    withChoice({}, { ...EMPTY_INBOX_DRAFT, choices: ["Postgres"] }, "Redis").choices,
    ["Redis"],
  );
  assert.deepEqual(withChoice({}, { ...EMPTY_INBOX_DRAFT, choices: ["Redis"] }, "Redis").choices, [
    "Redis",
  ]);
  const several = { multiple: true };
  let draft = withChoice(several, EMPTY_INBOX_DRAFT, "SMS");
  draft = withChoice(several, draft, "Email");
  assert.deepEqual(draft.choices, ["SMS", "Email"]);
  assert.deepEqual(withChoice(several, draft, "SMS").choices, ["Email"]);
});

test("an approval and a task are answered by the decision the card holds, or a chat ask's press, an item asking nothing by its nod with or without a note, and words by words", () => {
  const task = item({ id: "task", response: { type: INBOX_RESPONSE.TODO } });
  assert.equal(inboxReply(task, { ...EMPTY_INBOX_DRAFT, note: "done it" }), undefined);
  assert.deepEqual(inboxReply(task, withDecision(EMPTY_INBOX_DRAFT, INBOX_REPLY.NOT_DONE)), {
    reply: INBOX_REPLY.NOT_DONE,
  });
  assert.deepEqual(inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.DONE), {
    reply: INBOX_REPLY.DONE,
  });
  assert.equal(
    inboxReply(task, withDecision(EMPTY_INBOX_DRAFT, INBOX_REPLY.APPROVED)),
    undefined,
    "a task takes no approval",
  );
  const step = item({ id: "step", response: { type: INBOX_RESPONSE.APPROVAL } });
  assert.deepEqual(
    inboxReply(step, {
      ...withDecision(EMPTY_INBOX_DRAFT, INBOX_REPLY.DECLINED),
      note: " Not yet. ",
    }),
    { reply: INBOX_REPLY.DECLINED, note: "Not yet." },
  );
  const fyi = item({ id: "fyi", response: { type: INBOX_RESPONSE.NONE } });
  assert.deepEqual(inboxReply(fyi, EMPTY_INBOX_DRAFT), { reply: INBOX_REPLY.ACKNOWLEDGED });
  assert.deepEqual(inboxReply(fyi, { ...EMPTY_INBOX_DRAFT, note: "ok" }), {
    reply: INBOX_REPLY.ACKNOWLEDGED,
    note: "ok",
  });
  const question = item({ id: "question" });
  assert.equal(inboxReply(question, { ...EMPTY_INBOX_DRAFT, note: "  " }), undefined);
  assert.deepEqual(inboxReply(question, { ...EMPTY_INBOX_DRAFT, note: "Hello" }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Hello",
  });
});

test("an approval or a to-do lacks its decision until one is picked, a note lacks nothing, and a number key picks an approval's or a to-do's decision, the one going ahead first, as it picks a choice's option", () => {
  const step = item({ id: "step", response: { type: INBOX_RESPONSE.APPROVAL } });
  const task = item({ id: "task", response: { type: INBOX_RESPONSE.TODO } });
  assert.deepEqual(inboxMissing(step, EMPTY_INBOX_DRAFT), {
    kind: INBOX_MISSING.OPTION,
    line: "Approve or decline",
  });
  assert.deepEqual(inboxMissing(task, { ...EMPTY_INBOX_DRAFT, note: "Did half." }), {
    kind: INBOX_MISSING.OPTION,
    line: "Tick it, or say you couldn't",
  });
  assert.equal(inboxMissing(task, withDecision(EMPTY_INBOX_DRAFT, INBOX_REPLY.DONE)), undefined);
  const fyi = item({ id: "fyi", response: { type: INBOX_RESPONSE.NONE } });
  assert.equal(inboxMissing(fyi, EMPTY_INBOX_DRAFT), undefined);

  const decided = (picked: InboxDraft | undefined) =>
    picked === undefined ? undefined : inboxReply(step, picked)?.reply;
  assert.equal(decided(numberedPick(step, EMPTY_INBOX_DRAFT, 1)), INBOX_REPLY.APPROVED);
  assert.equal(decided(numberedPick(step, EMPTY_INBOX_DRAFT, 2)), INBOX_REPLY.DECLINED);
  assert.equal(numberedPick(step, EMPTY_INBOX_DRAFT, 3), undefined);
  assert.equal(
    inboxReply(task, numberedPick(task, EMPTY_INBOX_DRAFT, 2) ?? EMPTY_INBOX_DRAFT)?.reply,
    INBOX_REPLY.NOT_DONE,
  );
  assert.deepEqual(numberedPick(QUEUE, EMPTY_INBOX_DRAFT, 2)?.choices, ["Redis"]);
  assert.equal(numberedPick(fyi, EMPTY_INBOX_DRAFT, 1), undefined);
});

test("files attached alone answer an item in the developer's own words, and travel apart from the answer", () => {
  const files = [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }] as const;
  assert.deepEqual(
    inboxReply(item({ id: "question" }), { ...EMPTY_INBOX_DRAFT, attachments: files }),
    {
      reply: INBOX_REPLY.ANSWERED,
    },
  );
  assert.deepEqual(inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, attachments: files }), {
    reply: INBOX_REPLY.ANSWERED,
  });
});

test("a settled item says what its answerer did: the developer's pick, a form's values a line each, and their note, or the agent taking it back and why; an open one is not settled", () => {
  assert.equal(settlementOf(QUEUE), undefined);
  assert.deepEqual(
    settlementOf(
      item({
        id: "a",
        status: INBOX_STATUS.ANSWERED,
        answeredBy: DANA,
        answer: { reply: INBOX_REPLY.CHOSE, choices: ["Redis", "Postgres"], note: "Fine." },
      }),
    ),
    { by: SETTLED_BY.DEVELOPER, did: "chose Redis, Postgres", note: "Fine." },
  );
  assert.deepEqual(
    settlementOf(
      item({
        id: "f",
        status: INBOX_STATUS.ANSWERED,
        answeredBy: DANA,
        answer: {
          reply: INBOX_REPLY.SUBMITTED,
          values: [
            { label: "Port", value: 587 },
            { label: "Verify certificate", value: true },
          ],
        },
      }),
    ),
    {
      by: SETTLED_BY.DEVELOPER,
      did: "filled it in",
      values: "Port: 587\nVerify certificate: yes",
    },
  );
  assert.deepEqual(
    settlementOf(
      item({
        id: "n",
        status: INBOX_STATUS.ANSWERED,
        answeredBy: DANA,
        answer: { reply: INBOX_REPLY.ACKNOWLEDGED },
      }),
    ),
    { by: SETTLED_BY.DEVELOPER, did: "acknowledged it" },
  );
  assert.deepEqual(
    settlementOf(item({ id: "b", status: INBOX_STATUS.CLOSED, closedReason: "Found it." })),
    { by: SETTLED_BY.AGENT, lead: "Withdrawn by the agent", words: "Found it." },
  );
});

test("a settled choice keeps every option the agent offered with the developer's pick marked, one answered in their own words marks none, a settled approval keeps both presses with the one pressed marked, and words or a form, or an item still open, offer nothing to mark", () => {
  const offered = item({
    id: "q",
    status: INBOX_STATUS.ANSWERED,
    response: {
      type: INBOX_RESPONSE.CHOICE,
      options: [{ label: "Postgres", detail: "Already deployed." }, { label: "Redis" }],
      recommended: "Postgres",
    },
    answer: { reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
  });
  assert.deepEqual(proposedOptions(offered), [
    { label: "Postgres", detail: "Already deployed.", recommended: true, picked: false },
    { label: "Redis", recommended: false, picked: true },
  ]);
  assert.deepEqual(
    proposedOptions({ ...offered, answer: { reply: INBOX_REPLY.ANSWERED, note: "Use SQS." } }).map(
      (option) => option.picked,
    ),
    [false, false],
  );
  const approval = item({
    id: "ship",
    status: INBOX_STATUS.ANSWERED,
    response: { type: INBOX_RESPONSE.APPROVAL },
    answer: { reply: INBOX_REPLY.APPROVED, note: "After 6pm." },
  });
  assert.deepEqual(proposedOptions(approval), [
    { label: "Decline", recommended: false, picked: false },
    { label: "Approve", recommended: false, picked: true },
  ]);
  assert.deepEqual(
    proposedOptions(
      item({ id: "withdrawn", status: INBOX_STATUS.CLOSED, response: approval.response }),
    ).map((option) => option.picked),
    [false, false],
    "taken back, nothing was pressed",
  );
  assert.deepEqual(proposedOptions({ ...offered, status: INBOX_STATUS.OPEN }), []);
  assert.deepEqual(
    proposedOptions({
      ...SMTP,
      status: INBOX_STATUS.ANSWERED,
      answer: { reply: INBOX_REPLY.SUBMITTED },
    }),
    [],
  );
});

/** A task of the account's, holding inbox items. */
function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: null,
  };
}

const BILLING = task("7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", "Billing alerts");
const INVITES = task("9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32", "Invites");
const TASKS = [
  {
    holder: taskHolder(BILLING),
    items: [
      item({ id: "threshold", updatedAt: 30 }),
      item({ id: "retry", status: INBOX_STATUS.ANSWERED, updatedAt: 50 }),
      item({ id: "channel", status: INBOX_STATUS.CLOSED, updatedAt: 10 }),
    ],
  },
  { holder: taskHolder(INVITES), items: [item({ id: "expiry", updatedAt: 40 })] },
];

/** Each group of a list as its task's name, its person's, You for the reader's own, or its status, and its items' ids, or the one run's ids. */
function drawn(view: InboxListView): readonly (string | readonly [string, readonly string[]])[] {
  if (view.grouping === INBOX_GROUPING.TASK) {
    return view.groups.map(
      ({ holder, items }) => [holderName(holder), items.map((each) => each.id)] as const,
    );
  }
  if (view.grouping === INBOX_GROUPING.PERSON) {
    return view.groups.map(
      ({ starter, items }) => [starter?.name ?? "You", items.map(({ item }) => item.id)] as const,
    );
  }
  if (view.grouping === INBOX_GROUPING.STATUS) {
    return view.groups.map(
      ({ status, items }) => [status, items.map(({ item }) => item.id)] as const,
    );
  }
  return view.items.map(({ item }) => item.id);
}

test("the list holds every item the latest changed first, under its plan, the plan whose item changed latest first, or in one run across plans", () => {
  const chosen = undefined;
  assert.deepEqual(
    drawn(
      inboxList(TASKS, {
        grouping: INBOX_GROUPING.TASK,
        show: INBOX_SHOW.ALL,
        readerId: undefined,
        chosen,
      }),
    ),
    [
      ["Billing alerts", ["retry", "threshold", "channel"]],
      ["Invites", ["expiry"]],
    ],
  );
  assert.deepEqual(
    drawn(
      inboxList(TASKS, {
        grouping: INBOX_GROUPING.NONE,
        show: INBOX_SHOW.ALL,
        readerId: undefined,
        chosen,
      }),
    ),
    ["retry", "expiry", "threshold", "channel"],
  );
});

test("To do lists only what waits, and the item chosen where one is given, as the steps through the list keep it, and a plan with nothing listed has no group", () => {
  const waiting = {
    grouping: INBOX_GROUPING.TASK,
    show: INBOX_SHOW.TO_DO,
    readerId: undefined,
  } as const;
  assert.deepEqual(drawn(inboxList(TASKS, { ...waiting, chosen: undefined })), [
    ["Invites", ["expiry"]],
    ["Billing alerts", ["threshold"]],
  ]);
  assert.deepEqual(drawn(inboxList(TASKS, { ...waiting, chosen: "retry" })), [
    ["Billing alerts", ["retry", "threshold"]],
    ["Invites", ["expiry"]],
  ]);
  assert.deepEqual(
    drawn(
      inboxList(
        [
          {
            holder: taskHolder(BILLING),
            items: [item({ id: "done", status: INBOX_STATUS.ANSWERED })],
          },
        ],
        {
          ...waiting,
          chosen: undefined,
        },
      ),
    ),
    [],
  );
});

test("with nothing chosen, the first listed item that waits stands chosen, else the first listed, and nothing where nothing is listed", () => {
  const all = { show: INBOX_SHOW.ALL, readerId: undefined, chosen: undefined } as const;
  assert.equal(
    firstChoice(inboxList(TASKS, { ...all, grouping: INBOX_GROUPING.TASK }))?.item.id,
    "threshold",
  );
  assert.equal(
    firstChoice(inboxList(TASKS, { ...all, grouping: INBOX_GROUPING.NONE }))?.item.id,
    "expiry",
  );
  const settled = [
    { holder: taskHolder(BILLING), items: [item({ id: "done", status: INBOX_STATUS.ANSWERED })] },
  ];
  assert.equal(
    firstChoice(inboxList(settled, { ...all, grouping: INBOX_GROUPING.NONE }))?.item.id,
    "done",
  );
  assert.equal(firstChoice(inboxList([], { ...all, grouping: INBOX_GROUPING.TASK })), undefined);
});

test("the next item that needs you follows the chosen one in the list's order, wrapping round to its top, never the chosen one itself, and none where nothing else needs you", () => {
  const newest = inboxList(TASKS, {
    grouping: INBOX_GROUPING.NONE,
    show: INBOX_SHOW.ALL,
    readerId: undefined,
    chosen: undefined,
  });
  assert.deepEqual(
    ["retry", "expiry", "threshold", "channel"].map(
      (id) => nextNeedingYou(newest, id, () => false)?.item.id,
    ),
    ["expiry", "threshold", "expiry", "expiry"],
  );
  const settled = inboxList(
    [
      {
        holder: taskHolder(BILLING),
        items: [
          item({ id: "done", status: INBOX_STATUS.ANSWERED }),
          item({ id: "only", updatedAt: 5 }),
        ],
      },
    ],
    { grouping: INBOX_GROUPING.NONE, show: INBOX_SHOW.ALL, readerId: undefined, chosen: undefined },
  );
  assert.equal(
    nextNeedingYou(settled, "only", () => false),
    undefined,
  );
});

const ME = { userId: "user-me", name: "Sam Ortiz" };
const KAI = { userId: "user-kai", name: "Kai Moreno" };

/** Items of the reader's agents, of teammates' agents, and one the service names no starter for, across two plans. */
const SHARED = [
  {
    holder: taskHolder(BILLING),
    items: [
      item({ id: "mine", startedBy: ME, updatedAt: 20 }),
      item({ id: "danas", startedBy: DANA, updatedAt: 60 }),
      item({ id: "unnamed", updatedAt: 10 }),
      item({ id: "danas-answered", startedBy: DANA, status: INBOX_STATUS.ANSWERED, updatedAt: 70 }),
    ],
  },
  {
    holder: taskHolder(INVITES),
    items: [
      item({ id: "kais", startedBy: KAI, updatedAt: 40 }),
      item({ id: "mine-invites", startedBy: ME, updatedAt: 30 }),
    ],
  },
];

test("only an open item the reader's own agent asks needs them, or one whose starter the service does not name: To do leaves a teammate's out, though the list holds it, and does not count it", () => {
  const newest = { grouping: INBOX_GROUPING.NONE, chosen: undefined } as const;
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, show: INBOX_SHOW.TO_DO, readerId: ME.userId })),
    ["mine-invites", "mine", "unnamed"],
  );
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, show: INBOX_SHOW.ALL, readerId: ME.userId })),
    ["danas-answered", "danas", "kais", "mine-invites", "mine", "unnamed"],
  );
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, show: INBOX_SHOW.TO_DO, readerId: DANA.userId })),
    ["danas", "unnamed"],
    "the same list read by the teammate needs them for their own",
  );
  const teammates = [{ holder: taskHolder(BILLING), items: [item({ id: "d", startedBy: DANA })] }];
  const needingYou = (readerId: string | undefined) =>
    inboxCounts(teammates, readerId)[INBOX_SHOW.TO_DO];
  assert.equal(needingYou(ME.userId), 0);
  assert.equal(needingYou(DANA.userId), 1);
  assert.equal(needingYou(undefined), 1, "a reader not known yet is asked everything");
});

test("an archived task's items, open or unread, need nobody, as a plan's own Inbox lists them: To do neither lists nor counts them, nor is one the next, while All still lists them", () => {
  const archived = [
    {
      holder: taskHolder({ ...BILLING, archivedAt: 9 }),
      items: [
        item({ id: "put-away", updatedAt: 20 }),
        item({ id: "also", updatedAt: 10 }),
        item({ id: "unread", status: INBOX_STATUS.ANSWERED, updatedAt: 5, unread: true }),
      ],
    },
  ];
  const counts = inboxCounts(archived, undefined);
  assert.equal(counts[INBOX_SHOW.TO_DO], 0);
  assert.equal(counts[INBOX_SHOW.ALL], 3);
  const view = { grouping: INBOX_GROUPING.NONE, readerId: undefined, chosen: undefined } as const;
  assert.deepEqual(drawn(inboxList(archived, { ...view, show: INBOX_SHOW.TO_DO })), []);
  const open = inboxList(archived, { ...view, show: INBOX_SHOW.ALL });
  assert.deepEqual(drawn(open), ["put-away", "also", "unread"]);
  assert.equal(
    nextNeedingYou(open, "put-away", () => false),
    undefined,
  );
});

test("a teammate's open item is never the one chosen first nor the next that needs you, which go to the reader's own", () => {
  const list = inboxList(SHARED, {
    grouping: INBOX_GROUPING.NONE,
    show: INBOX_SHOW.ALL,
    readerId: ME.userId,
    chosen: undefined,
  });
  assert.equal(firstChoice(list)?.item.id, "mine-invites");
  assert.deepEqual(
    ["danas", "mine-invites", "unnamed"].map(
      (id) => nextNeedingYou(list, id, () => false)?.item.id,
    ),
    ["mine-invites", "mine", "mine-invites"],
  );
});

test("going up, the next item that needs you is the nearest above the chosen one, wrapping round from the list's foot, where going down it is the nearest below", () => {
  const list = inboxList(SHARED, {
    grouping: INBOX_GROUPING.NONE,
    show: INBOX_SHOW.ALL,
    readerId: ME.userId,
    chosen: undefined,
  });
  const ids = ["danas-answered", "kais", "mine-invites", "mine", "unnamed"];
  assert.deepEqual(
    ids.map((id) => nextNeedingYou(list, id, () => false, INBOX_DIRECTION.UP)?.item.id),
    ["unnamed", "unnamed", "unnamed", "mine-invites", "mine"],
  );
  assert.deepEqual(
    ids.map((id) => nextNeedingYou(list, id, () => false, INBOX_DIRECTION.DOWN)?.item.id),
    ["mine-invites", "mine-invites", "mine", "unnamed", "mine-invites"],
  );
});

/**
 * The shared items with three of them unread: a teammate's settled one, the
 * reader's own open one, and the reader's own settled one, whose agent wrote
 * on the thread again after it was answered.
 */
const UNREAD_SHARED = SHARED.map(({ holder, items }) => ({
  holder,
  items: [
    ...items.map((each) =>
      each.id === "danas-answered" || each.id === "mine" ? { ...each, unread: true } : each,
    ),
    ...(holder === SHARED[0]?.holder
      ? [
          item({
            id: "mine-followed",
            startedBy: ME,
            status: INBOX_STATUS.ANSWERED,
            updatedAt: 50,
            unread: true,
          }),
        ]
      : []),
  ],
}));

test("To do lists the reader's own open items and their own unread ones, a settled thread written on again among them, never a teammate's however unread, and All lists every item; each counts its own", () => {
  const rows = (show: InboxShow) =>
    drawn(
      inboxList(UNREAD_SHARED, {
        grouping: INBOX_GROUPING.NONE,
        show,
        readerId: ME.userId,
        chosen: undefined,
      }),
    );
  assert.deepEqual(rows(INBOX_SHOW.TO_DO), ["mine-followed", "mine-invites", "mine", "unnamed"]);
  assert.deepEqual(rows(INBOX_SHOW.ALL), [
    "danas-answered",
    "danas",
    "mine-followed",
    "kais",
    "mine-invites",
    "mine",
    "unnamed",
  ]);
  assert.deepEqual(inboxCounts(UNREAD_SHARED, ME.userId), {
    [INBOX_SHOW.TO_DO]: 4,
    [INBOX_SHOW.ALL]: 7,
  });
});

test("the first item chosen and the next one reach the reader's own unread update as they reach what waits on them, and the item read keeps its place among the steps once To do leaves it out", () => {
  const all = inboxList(UNREAD_SHARED, {
    grouping: INBOX_GROUPING.NONE,
    show: INBOX_SHOW.ALL,
    readerId: ME.userId,
    chosen: undefined,
  });
  assert.equal(
    firstChoice(all)?.item.id,
    "mine-followed",
    "All chooses the reader's own unread update first, past a teammate's newer items",
  );
  assert.equal(nextNeedingYou(all, "danas", () => false)?.item.id, "mine-followed");
  assert.equal(
    nextNeedingYou(all, "mine-followed", () => false)?.item.id,
    "mine-invites",
    "a teammate's open item between them is passed over",
  );
  // Note that an item read once opened leaves To do's rows but not its steps.
  const read = UNREAD_SHARED.map(({ holder, items }) => ({
    holder,
    items: items.map((each) => (each.id === "mine-followed" ? { ...each, unread: false } : each)),
  }));
  const view = { grouping: INBOX_GROUPING.NONE, show: INBOX_SHOW.TO_DO, readerId: ME.userId };
  assert.deepEqual(drawn(inboxList(read, { ...view, chosen: undefined })), [
    "mine-invites",
    "mine",
    "unnamed",
  ]);
  const steps = inboxList(read, { ...view, chosen: "mine-followed" });
  assert.equal(inboxSteps(steps, "mine-followed", () => false)?.next?.item.id, "mine-invites");
  assert.equal(inboxSteps(steps, "mine-followed", () => false)?.previous, undefined);
});

test("what waits, as Home, Factory, and a person's page list it, is every open item of a standing task, whoever's, the latest first, never a settled one however unread nor an archived task's", () => {
  const archived = {
    holder: taskHolder({ ...INVITES, id: "put-away", archivedAt: 9 }),
    items: [item({ id: "archived-open", updatedAt: 90 })],
  };
  assert.deepEqual(
    openItems([...UNREAD_SHARED, archived]).map(({ item }) => item.id),
    ["danas", "kais", "mine-invites", "mine", "unnamed"],
  );
});

test("grouped by person, the reader's own items stand first as You, then each teammate's, the one whose item changed latest first, each item keeping the plan that holds it", () => {
  const view = inboxList(SHARED, {
    grouping: INBOX_GROUPING.PERSON,
    show: INBOX_SHOW.ALL,
    readerId: ME.userId,
    chosen: undefined,
  });
  assert.deepEqual(drawn(view), [
    ["You", ["mine-invites", "mine", "unnamed"]],
    ["Dana Reyes", ["danas-answered", "danas"]],
    ["Kai Moreno", ["kais"]],
  ]);
  assert.deepEqual(
    listedItems(view).map(({ holder }) => holderName(holder)),
    ["Invites", "Billing alerts", "Billing alerts", "Billing alerts", "Billing alerts", "Invites"],
  );
  assert.deepEqual(
    drawn(
      inboxList(SHARED, {
        grouping: INBOX_GROUPING.PERSON,
        show: INBOX_SHOW.TO_DO,
        readerId: ME.userId,
        chosen: "kais",
      }),
    ),
    [
      ["You", ["mine-invites", "mine", "unnamed"]],
      ["Kai Moreno", ["kais"]],
    ],
    "To do leaves a teammate's group out but for the item chosen",
  );
});

test("grouped by status, what needs the reader stands first, then what waits on a teammate, then what is answered or taken back, each in the list's order, a status with nothing in it left out; a folded status's items are stepped past but for the one chosen", () => {
  const status = (show: InboxShow) =>
    inboxList(SHARED, {
      grouping: INBOX_GROUPING.STATUS,
      show,
      readerId: ME.userId,
      chosen: undefined,
    });
  assert.deepEqual(drawn(status(INBOX_SHOW.ALL)), [
    [INBOX_STATUS_GROUP.NEEDS_YOU, ["mine-invites", "mine", "unnamed"]],
    [INBOX_STATUS_GROUP.WAITING, ["danas", "kais"]],
    [INBOX_STATUS_GROUP.ANSWERED, ["danas-answered"]],
  ]);
  assert.deepEqual(
    drawn(status(INBOX_SHOW.TO_DO)),
    [[INBOX_STATUS_GROUP.NEEDS_YOU, ["mine-invites", "mine", "unnamed"]]],
    "To do holds nothing waiting on a teammate nor answered and read",
  );
  const view = status(INBOX_SHOW.ALL);
  const waiting = view.grouping === INBOX_GROUPING.STATUS ? view.groups[1]?.key : undefined;
  const folded = (key: string) => key === waiting;
  assert.equal(inboxSteps(view, "unnamed", folded)?.next?.item.id, "danas-answered");
  assert.equal(inboxSteps(view, "danas", folded)?.next?.item.id, "danas-answered");
});

test("sorted oldest first, the item changed longest ago stands first, open or settled, and the tasks in the order their first item stands; latest first is its reverse", () => {
  const tasks = [
    {
      holder: taskHolder(BILLING),
      items: [
        item({ id: "fresh", updatedAt: 95 }),
        item({ id: "settled-late", status: INBOX_STATUS.ANSWERED, updatedAt: 99 }),
      ],
    },
    {
      holder: taskHolder(INVITES),
      items: [
        item({ id: "open-late", updatedAt: 98 }),
        item({ id: "settled-early", status: INBOX_STATUS.CLOSED, updatedAt: 50 }),
      ],
    },
  ];
  const sorted = (grouping: InboxGrouping, sort: InboxSort) =>
    drawn(
      inboxList(tasks, {
        grouping,
        show: INBOX_SHOW.ALL,
        readerId: undefined,
        chosen: undefined,
        sort,
      }),
    );
  assert.deepEqual(sorted(INBOX_GROUPING.NONE, INBOX_SORT.OLDEST), [
    "settled-early",
    "fresh",
    "open-late",
    "settled-late",
  ]);
  assert.deepEqual(sorted(INBOX_GROUPING.TASK, INBOX_SORT.OLDEST), [
    ["Invites", ["settled-early", "open-late"]],
    ["Billing alerts", ["fresh", "settled-late"]],
  ]);
  assert.deepEqual(sorted(INBOX_GROUPING.NONE, INBOX_SORT.LATEST), [
    "settled-late",
    "open-late",
    "fresh",
    "settled-early",
  ]);
});

test("Whose lists everyone's items, the reader's own, items whose starter the service does not name among them, or one teammate's, and the scopes count only those; the item chosen keeps its place among the steps", () => {
  const whose = (choice: InboxWhose, chosen?: string) =>
    drawn(
      inboxList(SHARED, {
        grouping: INBOX_GROUPING.NONE,
        show: INBOX_SHOW.ALL,
        readerId: ME.userId,
        chosen,
        whose: choice,
      }),
    );
  assert.equal(whose(EVERYONES).length, 6);
  assert.deepEqual(whose({ kind: INBOX_WHOSE.MINE }), ["mine-invites", "mine", "unnamed"]);
  const dana = { kind: INBOX_WHOSE.PERSON, ...DANA } as const;
  assert.deepEqual(whose(dana), ["danas-answered", "danas"]);
  assert.deepEqual(whose(dana, "kais"), ["danas-answered", "danas", "kais"]);
  assert.deepEqual(inboxCounts(SHARED, ME.userId, dana), {
    [INBOX_SHOW.TO_DO]: 0,
    [INBOX_SHOW.ALL]: 2,
  });
});

test("grouped by person, a folded person's items are stepped past but for the one chosen", () => {
  const view = inboxList(SHARED, {
    grouping: INBOX_GROUPING.PERSON,
    show: INBOX_SHOW.ALL,
    readerId: ME.userId,
    chosen: undefined,
  });
  const dana = view.grouping === INBOX_GROUPING.PERSON ? view.groups[1]?.key : undefined;
  const folded = (key: string) => key === dana;
  assert.deepEqual(inboxSteps(view, "unnamed", folded)?.next?.item.id, "kais");
  assert.deepEqual(inboxSteps(view, "danas", folded)?.previous?.item.id, "unnamed");
  assert.equal(inboxSteps(view, "danas", folded)?.total, 5);
});

test("a note past the wire's bound is no answer, so the card offers no send for it", () => {
  const question = item({ id: "question" });
  const long = "x".repeat(INBOX_BOUNDS.MAX_NOTE_CHARS + 1);
  assert.equal(inboxReply(question, { ...EMPTY_INBOX_DRAFT, note: long }), undefined);
  assert.equal(
    inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["Redis"], note: long }),
    undefined,
  );
});

test("a code block near the file's top reads from its first line, a file that ends before its lines do says so for good, a read that did not land may be read again, and lines of another repository or running backwards are not read", () => {
  const block = {
    type: INBOX_BLOCK.CODE,
    repo: "acme/relay",
    path: "src/invite.ts",
    startLine: 2,
    endLine: 4,
    sha: "0123456789abcdef0123456789abcdef01234567",
  } as const;
  assert.deepEqual(codeWindow(block), {
    path: "src/invite.ts",
    firstLine: 1,
    lastLine: 7,
    ref: block.sha,
  });
  const short = {
    file: {
      path: block.path,
      repository: "acme/relay",
      branch: block.sha,
      firstLine: 1,
      lineCount: 1,
      lines: [[{ text: "export {};" }]],
    },
  };
  assert.deepEqual(codeReadOf(block, short), {
    kind: CODE_READ.NOTICE,
    line: "The file ends before these lines do at this commit.",
    again: false,
  });
  assert.equal(
    codeReadOf({ ...block, startLine: 1 }, short).kind,
    CODE_READ.NOTICE,
    "a file ending inside the lines draws none of them, rather than some as if all",
  );
  assert.equal(codeReadOf({ ...block, startLine: 1, endLine: 1 }, short).kind, CODE_READ.READY);
  assert.deepEqual(codeReadOf(block, { failure: TASK_CALL_FAILURE.UNANSWERED }), {
    kind: CODE_READ.NOTICE,
    line: "These lines could not be read.",
    again: true,
  });
  assert.equal(
    codeNotice(block, null),
    "These lines are in acme/relay, which this task no longer reads.",
    "a plan that names no repository reads none",
  );
  assert.equal(codeNotice(block, "Acme/Relay"), undefined);
  assert.equal(
    codeNotice({ ...block, startLine: 9 }, "acme/relay"),
    "These lines cannot be read.",
    "lines running backwards are no window to read",
  );
});

/** An item of an agent with no task as main's read lists it. */
function waitingTaskless(
  agentId: string,
  patch: Partial<AppInboxTasklessItem> = {},
): AppInboxTasklessItem {
  return {
    id: `item-${agentId}`,
    agentId,
    title: "Quarantine the flaky test?",
    postedAt: 1,
    agentTitle: null,
    agentModel: "anthropic/claude-opus-5.5",
    automationId: "automation-sweep",
    automationName: "Nightly flake sweep",
    repository: "acme/relay",
    workspaceId: "workspace-acme",
    ...patch,
  };
}

test("the items of agents with no plan stand under the automation that started them, the unnamed ones together, and only the listed workspace's", () => {
  // An item from a service before workspaces were named, which stands in every workspace's list.
  const { workspaceId: _unnamed, ...unnamedWorkspace } = waitingTaskless("agent-5", {
    automationId: "automation-old",
    automationName: "Old",
  });
  const waiting = [
    waitingTaskless("agent-1"),
    waitingTaskless("agent-2"),
    waitingTaskless("agent-3", { automationId: null, automationName: null }),
    waitingTaskless("agent-4", { workspaceId: "workspace-beta" }),
    unnamedWorkspace,
  ];
  const read = new Map([
    ["agent-1", [item({ id: "one", agentId: "agent-1" })]],
    [
      "agent-2",
      [
        item({ id: "two", agentId: "agent-2" }),
        item({ id: "settled", agentId: "agent-2", status: INBOX_STATUS.ANSWERED }),
      ],
    ],
    ["agent-3", [item({ id: "three", agentId: "agent-3" })]],
    ["agent-4", [item({ id: "four", agentId: "agent-4" })]],
  ]);

  assert.deepEqual(
    tasklessGroups(waiting, read, "workspace-acme").map(({ holder, items }) => [
      holderName(holder),
      items.map((each) => each.id),
    ]),
    [
      ["Nightly flake sweep", ["one", "two", "settled"]],
      ["Other agents", ["three"]],
      ["Old", []],
    ],
  );
});

/** Names a member as a row's preview does: "You" for the reader, a teammate by name, someone unnamed where the service names nobody. */
function previewName(
  member: { readonly userId: string; readonly name: string } | undefined,
): string {
  if (member === undefined) return "Someone";
  return member.userId === READER ? "You" : member.name;
}

const READER = "user-reader";
const YOU = { userId: READER, name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };

/** A message on an item's thread, written at `createdAt`. */
function message(
  overrides: Partial<InboxMessage> & Pick<InboxMessage, "text" | "createdAt">,
): InboxMessage {
  return {
    id: `b1b2c3d4-0000-4000-8000-${String(overrides.createdAt).padStart(12, "0")}`,
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    ...overrides,
  };
}

test("an open item nobody has written on previews what it asks: a choice by its options and whether one is recommended, a form by its fields, and anything else by its kind and the first words of its context", () => {
  const context = [
    { type: INBOX_BLOCK.MARKDOWN, text: "Add the token under **Production**." },
  ] as const;
  const previews = [
    {
      ...QUEUE,
      response: {
        type: INBOX_RESPONSE.CHOICE,
        options: [{ label: "Postgres" }, { label: "Redis" }, { label: "SQS" }],
        recommended: "Postgres",
      },
    },
    QUEUE,
    {
      ...QUEUE,
      response: {
        type: INBOX_RESPONSE.CHOICE,
        options: [{ label: "Postgres" }, { label: "Redis" }],
        recommended: "Kafka",
      },
    },
    SMTP,
    item({ id: "c1", response: { type: INBOX_RESPONSE.TODO }, blocks: context }),
    item({ id: "c2", response: { type: INBOX_RESPONSE.APPROVAL } }),
    item({ id: "c3", response: { type: INBOX_RESPONSE.TEXT }, blocks: context }),
    item({ id: "c4", response: { type: INBOX_RESPONSE.NONE } }),
  ].map((each) => inboxPreview(each, previewName));
  assert.deepEqual(previews, [
    "Choice · 3 options, one recommended",
    "Choice · 2 options",
    "Choice · 2 options",
    "Form · 4 fields",
    "To-do · Add the token under Production.",
    "Approval",
    "Question · Add the token under Production.",
    "Note",
  ]);
});

test("an answered item previews its answer after who gave it: the options picked, their own words, or what they did, each with their note, and files alone where they wrote nothing", () => {
  const answered = (answer: NonNullable<InboxItem["answer"]>, extra: Partial<InboxItem> = {}) =>
    inboxPreview(
      item({ id: "d1", status: INBOX_STATUS.ANSWERED, answer, answeredBy: YOU, ...extra }),
      previewName,
    );
  assert.equal(
    answered({ reply: INBOX_REPLY.CHOSE, choices: ["Per 1,000, rounded up"] }),
    "You: Per 1,000, rounded up",
  );
  assert.equal(
    answered(
      { reply: INBOX_REPLY.CHOSE, choices: ["Email", "Slack"], note: "Not **SMS**." },
      { answeredBy: CHARLES },
    ),
    "Charles Pan: Email, Slack · Not SMS.",
  );
  assert.equal(
    answered({ reply: INBOX_REPLY.ANSWERED, note: "Admins and\nwhoever sent it" }),
    "You: Admins and whoever sent it",
  );
  assert.equal(answered({ reply: INBOX_REPLY.APPROVED }), "You: Approved");
  assert.equal(
    answered({ reply: INBOX_REPLY.DECLINED, note: "Wait for Monday" }),
    "You: Declined · Wait for Monday",
  );
  assert.equal(answered({ reply: INBOX_REPLY.DONE }), "You: Marked it done");
  const file = {
    attachmentId: "e1b2c3d4-0000-4000-8000-000000000001",
    name: "a.png",
    mediaType: "image/png",
  };
  assert.equal(
    answered({ reply: INBOX_REPLY.ANSWERED }, { answerFiles: [file, file] }),
    "You: Sent 2 files",
  );
  const { answeredBy: _by, ...unnamed } = item({
    id: "d2",
    status: INBOX_STATUS.ANSWERED,
    answer: { reply: INBOX_REPLY.APPROVED },
    answeredBy: YOU,
  });
  assert.equal(inboxPreview(unnamed, previewName), "Someone: Approved");
});

test("an item its agent took back previews that it was withdrawn and why", () => {
  const withdrawn = item({
    id: "f1",
    status: INBOX_STATUS.CLOSED,
    closedReason: "the plan settled on 5",
  });
  assert.equal(inboxPreview(withdrawn, previewName), "Withdrawn: the plan settled on 5");
});

test("an item a member closed without an answer previews who closed it, You for the reader, and never reads as withdrawn by its agent", () => {
  const closed = item({ id: "f2", status: INBOX_STATUS.CLOSED, closedBy: YOU });
  assert.equal(inboxPreview(closed, previewName), "You: Resolved without an answer");
  assert.equal(
    inboxPreview({ ...closed, closedBy: CHARLES }, previewName),
    "Charles Pan: Resolved without an answer",
  );
  const { closedBy: _by, ...unnamed } = closed;
  assert.equal(
    inboxPreview(unnamed, previewName),
    "Someone: Resolved without an answer",
    "a closed item without the agent's reason is a member's, though their account is gone",
  );
});

test("the latest message on an item's thread is its preview, open or settled, led by the agent, You, or the teammate who wrote it, a message of files alone saying so; a settlement after the last message is the preview instead", () => {
  const thread = [
    message({ text: "Is 80% too eager?", createdAt: 2_000, member: CHARLES }),
    message({
      text: "Backfilled 41,208 rows; staging totals match",
      createdAt: 3_000,
      author: INBOX_MESSAGE_AUTHOR.AGENT,
    }),
  ];
  const open = item({ id: "g1", response: { type: INBOX_RESPONSE.APPROVAL }, messages: thread });
  assert.equal(
    inboxPreview(open, previewName),
    "Agent: Backfilled 41,208 rows; staging totals match",
  );
  assert.equal(
    inboxPreview({ ...open, messages: thread.slice(0, 1) }, previewName),
    "Charles Pan: Is 80% too eager?",
  );
  const mine = message({ text: "Go ahead.", createdAt: 4_000, member: YOU });
  assert.equal(
    inboxPreview({ ...open, messages: [...thread, mine] }, previewName),
    "You: Go ahead.",
  );
  const filesOnly = message({
    text: "",
    createdAt: 4_000,
    member: CHARLES,
    files: [
      {
        attachmentId: "e1b2c3d4-0000-4000-8000-000000000002",
        name: "b.png",
        mediaType: "image/png",
      },
    ],
  });
  assert.equal(
    inboxPreview({ ...open, messages: [filesOnly] }, previewName),
    "Charles Pan: Sent a file",
  );
  const settledAfter = {
    ...open,
    status: INBOX_STATUS.ANSWERED,
    answer: { reply: INBOX_REPLY.APPROVED },
    answeredBy: YOU,
    settledAt: 5_000,
  };
  assert.equal(inboxPreview(settledAfter, previewName), "You: Approved");
  assert.equal(
    inboxPreview({ ...settledAfter, settledAt: 2_500 }, previewName),
    "Agent: Backfilled 41,208 rows; staging totals match",
  );
});

test("an item's media are its pictures and the pages it names, by any link outside code, in its blocks' order, each page of each task once, then its answer's and its thread's, a file that is no picture left out, and four at most", () => {
  const task = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const pageLink = (pageId: string) =>
    linkOf({ kind: LINK_PLACE.PAGE, planId: task, pageId }, "acme");
  const funnel = "3c4d5e6f-0000-4000-8000-000000000001";
  const pricing = "3c4d5e6f-0000-4000-8000-000000000002";
  const shot = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c70";
  const answered = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c71";
  const sent = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c72";
  const carrying = item({
    id: "m1",
    blocks: [
      { type: INBOX_BLOCK.MARKDOWN, text: `See [@Invite funnel](${pageLink(funnel)}) first.` },
      { type: INBOX_BLOCK.IMAGE, attachmentId: shot, alt: "The chart" },
      { type: INBOX_BLOCK.LINK, url: pageLink(funnel), label: "Invite funnel again" },
      { type: INBOX_BLOCK.LINK, url: "https://github.com/acme/relay/pull/42", label: "#42" },
    ],
    answerFiles: [
      { attachmentId: answered, name: "notes.pdf", mediaType: "application/pdf" },
      { attachmentId: answered, name: "after.png", mediaType: "image/png" },
    ],
  });
  assert.deepEqual(inboxMedia(carrying), [
    { kind: INBOX_MEDIA.PAGE, taskId: task, pageId: funnel },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: shot },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: answered },
  ]);
  const threaded = {
    ...carrying,
    messages: [
      {
        id: "n1",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: `Priced it on [the pricing page](${pageLink(pricing)}), then ${pageLink(funnel)} again.`,
        files: [{ attachmentId: sent, name: "before.webp", mediaType: "image/webp" }],
        createdAt: 2_000,
      },
    ],
  } satisfies InboxItem;
  assert.deepEqual(inboxMedia(threaded), [
    { kind: INBOX_MEDIA.PAGE, taskId: task, pageId: funnel },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: shot },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: answered },
    { kind: INBOX_MEDIA.PAGE, taskId: task, pageId: pricing },
  ]);
  const elsewhere = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const twoTasks = item({
    id: "m3",
    blocks: [
      { type: INBOX_BLOCK.MARKDOWN, text: `${pageLink(funnel)} and \`${pageLink(pricing)}\`` },
      {
        type: INBOX_BLOCK.LINK,
        url: linkOf({ kind: LINK_PLACE.PAGE, planId: elsewhere, pageId: funnel }, "acme"),
        label: "Its twin",
      },
    ],
  });
  assert.deepEqual(inboxMedia(twoTasks), [
    { kind: INBOX_MEDIA.PAGE, taskId: task, pageId: funnel },
    { kind: INBOX_MEDIA.PAGE, taskId: elsewhere, pageId: funnel },
  ]);
  assert.deepEqual(inboxMedia(item({ id: "m2" })), []);
});

/** The agent's message ending with `ask`, open unless it says otherwise. */
function asking(ask: InboxAsk, id = "b1b2c3d4-0000-4000-8000-000000000001"): InboxMessage {
  return {
    id,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Which way?",
    ask: { ...ask, status: INBOX_ASK_STATUS.OPEN },
    createdAt: 1_000,
  };
}

const ASKING_ID = "b1b2c3d4-0000-4000-8000-000000000001";

test("an item is drawn as its thread where the thread asks, or where the agent's note opens it with nothing in the item's blocks; one from before version 5, its question in its blocks, is drawn as it was", () => {
  const plain: InboxMessage = {
    id: "b1b2c3d4-0000-4000-8000-000000000009",
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    member: DANA,
    text: "Hm.",
    createdAt: 2_000,
  };
  const note: InboxMessage = { ...plain, author: INBOX_MESSAGE_AUTHOR.AGENT, text: "Shipped." };
  const asked = asking({ type: INBOX_ASK.ANSWER });
  const words = [{ type: INBOX_BLOCK.MARKDOWN, text: "What should the email say?" }] as const;

  assert.deepEqual(inboxThreadOf(item({ id: QUEUE.id, thread: [asked, plain] })), [asked, plain]);
  assert.deepEqual(inboxThreadOf(item({ id: QUEUE.id, thread: [note] })), [note]);
  assert.equal(inboxThreadOf(item({ id: QUEUE.id, blocks: words, thread: [note] })), undefined);
  assert.equal(inboxThreadOf(item({ id: QUEUE.id, blocks: words, thread: [plain] })), undefined);
  assert.equal(inboxThreadOf(item({ id: QUEUE.id, thread: [plain] })), undefined);
  assert.equal(inboxThreadOf(item({ id: QUEUE.id })), undefined);
});

test("a reply on a thread is plain unless an answer is attached: a pick, a press, or Submit; an attached answer the ask would refuse sends nothing, as Answer with no words", () => {
  const pick: InboxAsk = { type: INBOX_ASK.DECIDE, options: [{ label: "A" }, { label: "B" }] };
  const decide = [asking(pick)];
  const draft: InboxDraft = { ...EMPTY_INBOX_DRAFT, note: "  Why not C?  " };
  assert.deepEqual(inboxThreadSend(decide, draft), { text: "Why not C?", attachments: [] });
  assert.equal(
    inboxThreadSend(decide, EMPTY_INBOX_DRAFT),
    undefined,
    "an empty reply sends nothing",
  );
  assert.deepEqual(inboxThreadSend(decide, { ...EMPTY_INBOX_DRAFT, choices: ["B"] }), {
    text: "",
    attachments: [],
    answers: { ask: ASKING_ID, reply: INBOX_REPLY.CHOSE, choices: ["B"] },
  });

  const answer = [asking({ type: INBOX_ASK.ANSWER })];
  const pressed: InboxDraft = { ...EMPTY_INBOX_DRAFT, press: INBOX_REPLY.ANSWERED };
  assert.equal(inboxThreadSend(answer, pressed), undefined, "Answer's words are the answer");
  assert.deepEqual(inboxThreadSend(answer, { ...pressed, note: "Use 90%" })?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.ANSWERED,
  });

  const toDo = { type: INBOX_ASK.DO, steps: ["One", "Two"] } as const;
  const steps = [asking(toDo)];
  const done: InboxDraft = { ...EMPTY_INBOX_DRAFT, press: INBOX_REPLY.DONE, steps: [1] };
  assert.deepEqual(inboxThreadSend(steps, { ...done, press: INBOX_REPLY.NOT_DONE })?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.NOT_DONE,
    steps: [1],
  });
  assert.deepEqual(
    inboxThreadSend(steps, withStep(toDo, { ...done, press: INBOX_REPLY.NOT_DONE }, 0))?.answers
      ?.steps,
    [0, 1],
  );

  const settled: InboxMessage = {
    ...asking(pick),
    ask: { ...pick, status: INBOX_ASK_STATUS.ANSWERED },
  };
  assert.deepEqual(
    inboxThreadSend([settled], { ...EMPTY_INBOX_DRAFT, choices: ["B"], note: "x" }),
    { text: "x", attachments: [] },
    "a pick on a settled ask is no answer",
  );
});

test("Mark done ticks every step of a to-do, ticked by hand or not, while Couldn't do it still sends only those ticked by hand", () => {
  const ask = { type: INBOX_ASK.DO, steps: ["One", "Two", "Three"] } as const;
  const steps = [asking(ask)];
  const done: InboxDraft = { ...EMPTY_INBOX_DRAFT, press: INBOX_REPLY.DONE };
  assert.deepEqual(shownTicks(ask, done), [0, 1, 2], "the checklist shows every step ticked");
  assert.deepEqual(inboxThreadSend(steps, done)?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.DONE,
    steps: [0, 1, 2],
  });
  const byHand: InboxDraft = { ...withStep(ask, EMPTY_INBOX_DRAFT, 1), press: INBOX_REPLY.DONE };
  assert.deepEqual(inboxThreadSend(steps, byHand)?.answers?.steps, [0, 1, 2]);

  const failed: InboxDraft = { ...byHand, press: INBOX_REPLY.NOT_DONE };
  assert.deepEqual(shownTicks(ask, failed), [1]);
  assert.deepEqual(
    inboxThreadSend(steps, failed)?.answers?.steps,
    [1],
    "Couldn't do it after Mark done sends only the step ticked by hand",
  );

  const letGo = withStep(ask, done, 2);
  assert.equal(letGo.press, undefined, "letting a step go takes Mark done off");
  assert.deepEqual(shownTicks(ask, letGo), [0, 1]);

  const titled = { type: INBOX_ASK.DO, steps: [] } as const;
  assert.deepEqual(shownTicks(titled, done), [0], "the title standing as the one step is ticked");
  assert.deepEqual(inboxThreadSend([asking(titled)], done)?.answers?.steps, []);
});

test("a notice, open and asking nothing with no ask open on its thread, waits on the reader's nod, which Got it answers; a thread whose ask is open, or one settled, waits on none", () => {
  const said: InboxMessage = {
    id: "b1b2c3d4-0000-4000-8000-000000000010",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "The preview is up.",
    createdAt: 1_000,
  };
  const notice = item({
    id: "a1b2c3d4-0000-4000-8000-000000000010",
    response: { type: INBOX_RESPONSE.NONE },
    needsReply: false,
    thread: [said],
  });

  assert.equal(awaitsNod(notice, [said]), true);
  assert.deepEqual(inboxReply(notice, EMPTY_INBOX_DRAFT, INBOX_REPLY.ACKNOWLEDGED), {
    reply: INBOX_REPLY.ACKNOWLEDGED,
  });
  const asked = asking({ type: INBOX_ASK.ANSWER });
  assert.equal(awaitsNod({ ...notice, response: { type: INBOX_RESPONSE.TEXT } }, [asked]), false);
  assert.equal(
    awaitsNod(notice, [said, asked]),
    false,
    "an ask open on the thread is answered, not nodded to",
  );
  assert.equal(awaitsNod({ ...notice, status: INBOX_STATUS.ANSWERED }, [said]), false);
});

test("an answer's stamp names a pair of buttons' pick in the past where it can and which way it goes, any other pick by its options, and a to-do by the steps it ticked", () => {
  const pair = asking({
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Approve" }, { label: "Request changes" }],
  }).ask;
  const chose = (label: string) => ({
    ask: ASKING_ID,
    reply: INBOX_REPLY.CHOSE,
    choices: [label],
  });
  assert.deepEqual(sentStamp(chose("Approve"), pair), {
    tone: ANSWER_TONE.AHEAD,
    words: "Approved",
  });
  assert.deepEqual(sentStamp(chose("Request changes"), pair), {
    tone: ANSWER_TONE.BACK,
    words: "Requested changes",
  });
  assert.equal(sentStamp(chose("7 days"), undefined).words, "Chose 7 days");

  const todo = asking({ type: INBOX_ASK.DO, steps: ["One", "Two", "Three"] }).ask;
  const done = { ask: ASKING_ID, reply: INBOX_REPLY.DONE, steps: [0, 1, 2] };
  assert.deepEqual(sentStamp(done, todo), { tone: ANSWER_TONE.AHEAD, words: "Done 3/3" });
  assert.deepEqual(sentStamp({ ...done, reply: INBOX_REPLY.NOT_DONE, steps: [0] }, todo), {
    tone: ANSWER_TONE.BACK,
    words: "Couldn't do it 1/3",
  });
});

test("a thread's row previews its latest message, an answer led by its answerer and its stamp, and a note that asks nothing reads as the agent's words alone, its tile saying who", () => {
  const asked = asking({
    type: INBOX_ASK.DECIDE,
    options: [{ label: "7 days" }, { label: "14 days" }],
  });
  const answer = message({
    text: "and say it in the docs",
    createdAt: 2_000,
    member: YOU,
    answers: { ask: asked.id, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
  });
  const settled = standing(asked, INBOX_ASK_STATUS.ANSWERED);
  const answered = item({ id: "t1", status: INBOX_STATUS.ANSWERED, thread: [settled, answer] });
  assert.equal(inboxPreview(answered, previewName), "You: Chose 7 days · and say it in the docs");
  assert.equal(inboxLineKind(answered), INBOX_LINE.SETTLED);
  const wordless = { ...answer, text: "" };
  assert.equal(
    inboxPreview({ ...answered, thread: [settled, wordless] }, previewName),
    "You: Chose 7 days",
  );
  const note = message({
    text: "Shipped **#42**.",
    createdAt: 3_000,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
  });
  const settledNote = item({
    id: "t2",
    status: INBOX_STATUS.ANSWERED,
    answeredBy: YOU,
    thread: [note],
  });
  assert.equal(inboxPreview(settledNote, previewName), "Shipped #42.");
  assert.equal(inboxLineKind(settledNote), INBOX_LINE.SAID);
});

test("a thread's row says the ask itself while one is open: a choice's options, the recommended starred, the steps left and the next as its draft ticks them, or the fields; once none is open, the latest words, the agent's alone", () => {
  const rowOf = (ask: InboxAsk, ticked?: readonly number[]) =>
    inboxPreview(item({ id: "t3", thread: [asking(ask)] }), previewName, ticked);
  const lineOf = (ask: InboxAsk) => inboxLineKind(item({ id: "t3", thread: [asking(ask)] }));
  const options = [{ label: "7 days" }, { label: "14 days" }, { label: "30 days" }];
  assert.equal(rowOf({ type: INBOX_ASK.DECIDE, options }), "7 days / 14 days / 30 days");
  assert.equal(
    rowOf({ type: INBOX_ASK.DECIDE, options, multiple: true, recommended: "14 days" }),
    "7 days / 14 days ★ / 30 days",
  );
  assert.equal(lineOf({ type: INBOX_ASK.DECIDE, options }), INBOX_LINE.DECIDE);
  const steps = { type: INBOX_ASK.DO, steps: ["Open **it**", "Add it", "Redeploy"] } as const;
  assert.equal(rowOf(steps), "3 steps left · Open it");
  assert.equal(rowOf(steps, [0]), "2 steps left · Add it");
  assert.equal(rowOf(steps, [0, 2]), "1 step left · Add it");
  assert.equal(rowOf(steps, [0, 1, 2]), "Every step ticked · Mark done");
  assert.equal(rowOf({ type: INBOX_ASK.DO, steps: [] }, [0]), "Mark it done");
  assert.equal(lineOf(steps), INBOX_LINE.DO);
  assert.equal(
    rowOf({
      type: INBOX_ASK.ANSWER,
      fields: [
        { type: INBOX_FIELD.TEXT, label: "Host" },
        { type: INBOX_FIELD.TEXT, label: "Port" },
      ],
    }),
    "Fill in Host, Port",
  );
  assert.equal(rowOf({ type: INBOX_ASK.ANSWER }), "Write an answer");
  assert.equal(lineOf({ type: INBOX_ASK.ANSWER }), INBOX_LINE.ANSWER);
  const reply = message({ text: "Looking now.", createdAt: 2_000, member: CHARLES });
  assert.equal(
    inboxPreview(
      item({ id: "t4", thread: [asking({ type: INBOX_ASK.ANSWER }), reply] }),
      previewName,
    ),
    "Write an answer",
    "a reply leaves the ask open, so the row still says it",
  );
  const withdrawn = asking({ type: INBOX_ASK.ANSWER });
  const closed = item({
    id: "t5",
    status: INBOX_STATUS.CLOSED,
    thread: [standing(withdrawn, INBOX_ASK_STATUS.WITHDRAWN)],
  });
  assert.equal(inboxPreview(closed, previewName), "Which way?", "the agent's words stand alone");
  assert.equal(inboxLineKind(closed), INBOX_LINE.SAID);
});

test("a thread's row media are the pictures its messages' words draw by address and the pages they link to, outside code, in the order written, then their files' pictures, message by message, each once and four at most", () => {
  const itemId = "a1b2c3d4-0000-4000-8000-0000000000f1";
  const task = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const place = { kind: LINK_PLACE.INBOX_ITEM, planId: task, itemId } as const;
  const picture = (attachmentId: string) =>
    `![A chart](<${linkOf(place, "acme")}/files/${attachmentId}>)`;
  const pageLink = (pageId: string) =>
    linkOf({ kind: LINK_PLACE.PAGE, planId: task, pageId }, "acme");
  const chart = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c80";
  const after = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c81";
  const sent = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c82";
  const elsewhere = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c83";
  const funnel = "3c4d5e6f-0000-4000-8000-000000000011";
  const asked = {
    ...asking({ type: INBOX_ASK.ANSWER }),
    text: `See [@Invite funnel](${pageLink(funnel)}), then:\n\n${picture(chart)}`,
  };
  const answer = message({
    text: `Here it is after:\n\n${picture(after)}\n\nand ${picture(chart)} again.`,
    createdAt: 2_000,
    member: YOU,
    answers: { ask: asked.id, reply: INBOX_REPLY.ANSWERED },
    files: [
      { attachmentId: sent, name: "notes.pdf", mediaType: "application/pdf" },
      { attachmentId: sent, name: "before.png", mediaType: "image/png" },
    ],
  });
  const threaded = item({
    id: itemId,
    status: INBOX_STATUS.ANSWERED,
    blocks: [],
    thread: [standing(asked, INBOX_ASK_STATUS.ANSWERED), answer],
  });
  assert.deepEqual(inboxMedia(threaded), [
    { kind: INBOX_MEDIA.PAGE, taskId: task, pageId: funnel },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: chart },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: after },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: sent },
  ]);
  const another = { ...place, itemId: "a1b2c3d4-0000-4000-8000-0000000000f2" };
  const foreign = `![Not ours](<${linkOf(another, "acme")}/files/${elsewhere}>)`;
  const quoted = [
    foreign,
    `Write \`${picture(chart)}\` to draw it,`,
    "```md",
    picture(after),
    "```",
    `or link it bare: ${linkOf(place, "acme")}/files/${sent}`,
  ].join("\n");
  assert.deepEqual(
    inboxMedia({ ...threaded, thread: [{ ...asked, text: quoted }] }),
    [],
    "another item's picture, one quoted in code, and a bare address draw no picture, so the row shows none",
  );
});

test("a comment's files are drawn after its words but for a picture its words draw as one, the pictures apart from every other file; a file the words only link to, quote in code, or draw though it is no picture is still drawn", () => {
  const itemId = "a1b2c3d4-0000-4000-8000-0000000000f1";
  const place = {
    kind: LINK_PLACE.INBOX_ITEM,
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    itemId,
  } as const;
  const address = (attachmentId: string) => `${linkOf(place, "acme")}/files/${attachmentId}`;
  const [drawn, linked, quoted, fenced, loose, spec, drawnSpec] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c90",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c91",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c92",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c93",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c94",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c95",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c96",
  ];
  const png = (attachmentId: string) => ({
    attachmentId,
    name: `${attachmentId.slice(-2)}.png`,
    mediaType: "image/png",
  });
  const pdf = (attachmentId: string) => ({
    attachmentId,
    name: `${attachmentId.slice(-2)}.pdf`,
    mediaType: "application/pdf",
  });
  const files = [
    png(drawn),
    png(linked),
    png(quoted),
    png(fenced),
    png(loose),
    pdf(spec),
    pdf(drawnSpec),
  ];
  const words = [
    `![The form](<${address(drawn)}> "After")`,
    `See [the form](${address(linked)}), or \`![x](${address(quoted)})\`.`,
    "```md",
    `![x](${address(fenced)})`,
    "```",
    `The spec: ${address(spec)} and ![spec](${address(drawnSpec)})`,
  ].join("\n");
  const ids = (each: readonly { readonly attachmentId: string }[]) =>
    each.map(({ attachmentId }) => attachmentId);
  const read = inboxCommentFiles(files, words, itemId);
  assert.deepEqual(ids(read.pictures), [linked, quoted, fenced, loose]);
  assert.deepEqual(ids(read.others), [spec, drawnSpec]);
  // Words naming another item's picture draw none of this one's, and no words leave every file to be drawn.
  assert.deepEqual(
    ids(inboxCommentFiles(files, words, "a1b2c3d4-0000-4000-8000-0000000000f2").pictures),
    [drawn, linked, quoted, fenced, loose],
  );
  assert.deepEqual(ids(inboxCommentFiles(files, undefined, itemId).others), [spec, drawnSpec]);
});

/** The message with its ask standing as `status` says; the very message where it asks nothing. */
function standing(
  message: InboxMessage,
  status: (typeof INBOX_ASK_STATUS)[keyof typeof INBOX_ASK_STATUS],
): InboxMessage {
  const { ask } = message;
  return ask === undefined ? message : { ...message, ask: { ...ask, status } };
}

test("a settled item's card says how it ended whatever its row's glyph: an answer even with words after it, an ask taken back and why, a member's close, and an item before threads as its row said it", () => {
  const asked = asking({
    type: INBOX_ASK.DECIDE,
    options: [{ label: "7 days" }, { label: "14 days" }],
  });
  const answer = message({
    text: "",
    createdAt: 2_000,
    member: YOU,
    answers: { ask: asked.id, reply: INBOX_REPLY.CHOSE, choices: ["7 days"] },
  });
  const after = message({
    text: "Thanks, on it.",
    createdAt: 3_000,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
  });
  const settled = standing(asked, INBOX_ASK_STATUS.ANSWERED);
  const answered = item({
    id: "s1",
    status: INBOX_STATUS.ANSWERED,
    thread: [settled, answer, after],
  });
  assert.equal(inboxSettledWords(answered, previewName), "You: Chose 7 days");
  assert.equal(
    inboxLineKind(answered),
    INBOX_LINE.SAID,
    "the row's glyph reads only the last message",
  );

  const takenBack = item({
    id: "s2",
    status: INBOX_STATUS.CLOSED,
    thread: [
      {
        ...asked,
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "7 days" }, { label: "14 days" }],
          status: INBOX_ASK_STATUS.WITHDRAWN,
          withdrawnReason: "The deploy was **canceled**",
        },
      },
    ],
  });
  assert.equal(inboxSettledWords(takenBack, previewName), "Withdrawn: The deploy was canceled");

  const open = item({ id: "s3", thread: [asked] });
  assert.equal(inboxSettledWords(open, previewName), undefined, "an open item has not ended");
});
