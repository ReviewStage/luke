import assert from "node:assert/strict";
import {
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { test } from "vitest";
import {
  anyNeedsYou,
  CODE_READ,
  codeNotice,
  codeReadOf,
  codeWindow,
  EMPTY_INBOX_DRAFT,
  firstChoice,
  holderName,
  INBOX_GROUPING,
  type InboxListView,
  inboxBoard,
  inboxList,
  inboxReply,
  inboxSteps,
  listedItems,
  nextNeedingYou,
  proposedOptions,
  SETTLED_BY,
  settlementOf,
  taskHolder,
  tasklessGroups,
  withChoice,
  withValue,
} from "./inbox-model";

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

test("a press picks one option at a time on a choice and any number where the choice allows several, pressing a picked one again lets it go, and the picks are the answer in the order pressed", () => {
  const one = withChoice(withChoice(EMPTY_INBOX_DRAFT, "Postgres", false), "Redis", false);
  assert.deepEqual(one.choices, ["Redis"]);
  assert.deepEqual(withChoice(one, "Redis", false).choices, []);
  const several = withChoice(withChoice(EMPTY_INBOX_DRAFT, "Slack", true), "Email", true);
  assert.deepEqual(several.choices, ["Slack", "Email"]);
  assert.deepEqual(withChoice(several, "Slack", true).choices, ["Email"]);
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

test("a form is answered by its fields in the form's own order whatever order they were filled in, a blank text left out, a required one holding the answer back, a switch left alone sent as no, and a field's value replacing the one before it", () => {
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

test("an approval, a task, and an item asking nothing are answered by their presses alone, and words by words", () => {
  const task = item({ id: "task", response: { type: INBOX_RESPONSE.TODO } });
  assert.equal(inboxReply(task, { ...EMPTY_INBOX_DRAFT, note: "done it" }), undefined);
  assert.deepEqual(inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.DONE), {
    reply: INBOX_REPLY.DONE,
  });
  assert.equal(
    inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.APPROVED),
    undefined,
    "a task takes no approval",
  );
  const fyi = item({ id: "fyi", response: { type: INBOX_RESPONSE.NONE } });
  assert.equal(inboxReply(fyi, { ...EMPTY_INBOX_DRAFT, note: "ok" }), undefined);
  assert.deepEqual(
    inboxReply(fyi, { ...EMPTY_INBOX_DRAFT, note: "ok" }, INBOX_REPLY.ACKNOWLEDGED),
    {
      reply: INBOX_REPLY.ACKNOWLEDGED,
      note: "ok",
    },
  );
  const question = item({ id: "question" });
  assert.equal(inboxReply(question, { ...EMPTY_INBOX_DRAFT, note: "  " }), undefined);
  assert.deepEqual(inboxReply(question, { ...EMPTY_INBOX_DRAFT, note: "Hello" }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Hello",
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

/** A plan of the account's, holding inbox items. */
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

/** Each group of a list as its plan's name, or its person's, You for the reader's own, and its items' ids, or the one run's ids. */
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
  return view.items.map(({ item }) => item.id);
}

test("the list holds every item the latest changed first, under its plan, the plan whose item changed latest first, or in one run across plans", () => {
  const chosen = undefined;
  assert.deepEqual(
    drawn(
      inboxList(TASKS, {
        grouping: INBOX_GROUPING.TASK,
        waitingOnly: false,
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
        grouping: INBOX_GROUPING.NEWEST,
        waitingOnly: false,
        readerId: undefined,
        chosen,
      }),
    ),
    ["retry", "expiry", "threshold", "channel"],
  );
});

test("Needs you lists only what waits, and the item chosen where one is given, as the steps through the list keep it, and a plan with nothing listed has no group", () => {
  const waiting = {
    grouping: INBOX_GROUPING.TASK,
    waitingOnly: true,
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
  const all = { waitingOnly: false, readerId: undefined, chosen: undefined } as const;
  assert.equal(
    firstChoice(inboxList(TASKS, { ...all, grouping: INBOX_GROUPING.TASK }))?.item.id,
    "threshold",
  );
  assert.equal(
    firstChoice(inboxList(TASKS, { ...all, grouping: INBOX_GROUPING.NEWEST }))?.item.id,
    "expiry",
  );
  const settled = [
    { holder: taskHolder(BILLING), items: [item({ id: "done", status: INBOX_STATUS.ANSWERED })] },
  ];
  assert.equal(
    firstChoice(inboxList(settled, { ...all, grouping: INBOX_GROUPING.NEWEST }))?.item.id,
    "done",
  );
  assert.equal(firstChoice(inboxList([], { ...all, grouping: INBOX_GROUPING.TASK })), undefined);
});

test("the next item that needs you follows the chosen one in the list's order, wrapping round to its top, never the chosen one itself, and none where nothing else needs you", () => {
  const newest = inboxList(TASKS, {
    grouping: INBOX_GROUPING.NEWEST,
    waitingOnly: false,
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
    { grouping: INBOX_GROUPING.NEWEST, waitingOnly: false, readerId: undefined, chosen: undefined },
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

test("only an open item the reader's own agent asks needs them, or one whose starter the service does not name: Needs you leaves a teammate's out, though the list holds it, and the Inbox's dot does not count it", () => {
  const newest = { grouping: INBOX_GROUPING.NEWEST, chosen: undefined } as const;
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, waitingOnly: true, readerId: ME.userId })),
    ["mine-invites", "mine", "unnamed"],
  );
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, waitingOnly: false, readerId: ME.userId })),
    ["danas-answered", "danas", "kais", "mine-invites", "mine", "unnamed"],
  );
  assert.deepEqual(
    drawn(inboxList(SHARED, { ...newest, waitingOnly: true, readerId: DANA.userId })),
    ["danas", "unnamed"],
    "the same list read by the teammate needs them for their own",
  );
  const teammates = [{ holder: taskHolder(BILLING), items: [item({ id: "d", startedBy: DANA })] }];
  assert.equal(anyNeedsYou(teammates, ME.userId), false);
  assert.equal(anyNeedsYou(teammates, DANA.userId), true);
  assert.equal(
    anyNeedsYou(teammates, undefined),
    true,
    "a reader not known yet is asked everything",
  );
});

test("a teammate's open item is never the one chosen first nor the next that needs you, which go to the reader's own", () => {
  const list = inboxList(SHARED, {
    grouping: INBOX_GROUPING.NEWEST,
    waitingOnly: false,
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

test("grouped by person, the reader's own items stand first as You, then each teammate's, the one whose item changed latest first, each item keeping the plan that holds it", () => {
  const view = inboxList(SHARED, {
    grouping: INBOX_GROUPING.PERSON,
    waitingOnly: false,
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
        waitingOnly: true,
        readerId: ME.userId,
        chosen: "kais",
      }),
    ),
    [
      ["You", ["mine-invites", "mine", "unnamed"]],
      ["Kai Moreno", ["kais"]],
    ],
    "Needs you leaves a teammate's group out but for the item chosen",
  );
});

test("grouped by person, a folded person's items are stepped past but for the one chosen", () => {
  const view = inboxList(SHARED, {
    grouping: INBOX_GROUPING.PERSON,
    waitingOnly: false,
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

/** An item of an agent with no plan as main's read lists it. */
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
