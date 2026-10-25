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
  type InboxResponse,
} from "@luke/features/inbox-wire";
import { LINK_PLACE, linkOf } from "@luke/features/link-grammar";
import { TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import type { AppInboxTasklessItem } from "@luke/host/app-state";
import { test } from "vitest";
import {
  ANSWER_TONE,
  acknowledgedOnOpen,
  asksNod,
  awaitsNod,
  CODE_READ,
  codeNotice,
  codeReadOf,
  codeWindow,
  doDecision,
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
  inboxPlaces,
  inboxPreview,
  inboxReply,
  inboxSettledStanding,
  inboxSettledWords,
  inboxSteps,
  inboxThreadSend,
  isDone,
  listedItems,
  NO_PLACES,
  nextNeedingYou,
  openItems,
  sentStamp,
  shownTicks,
  taskHolder,
  tasklessGroups,
  waitsOnReader,
  withChoice,
  withDoPress,
  withStep,
  withValue,
} from "./inbox-model.js";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const UNLISTED = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** An item of the agent's, open, as the service answers one. */
function item(overrides: Partial<InboxItem> & Pick<InboxItem, "id">): InboxItem {
  return {
    agentId: AGENT,
    key: overrides.id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "What should the email say?",
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const DANA = { userId: "user-dana", name: "Dana Reyes" };

/** A chat ask's choice of one, as its version 4 response asks it. */
const QUEUE: InboxResponse = {
  type: INBOX_RESPONSE.CHOICE,
  options: [{ label: "Postgres" }, { label: "Redis" }],
};

/** A chat ask's choice of several. */
const CHANNELS: InboxResponse = {
  type: INBOX_RESPONSE.CHOICE,
  options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
  multiple: true,
};

/** A chat ask's form. */
const SMTP: InboxResponse = {
  type: INBOX_RESPONSE.FORM,
  fields: [
    { type: INBOX_FIELD.TEXT, label: "Host", required: true },
    { type: INBOX_FIELD.NUMBER, label: "Port" },
    { type: INBOX_FIELD.SELECT, label: "Security", options: ["TLS", "STARTTLS"] },
    { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
  ],
};

/** A chat ask asking for words. */
const QUESTION: InboxResponse = { type: INBOX_RESPONSE.TEXT };

/** A draft holding an approval's or a to-do's decision, as its card holds it: its one pick, by the reply's kind. */
function decided(reply: string): InboxDraft {
  return { ...EMPTY_INBOX_DRAFT, choices: [reply] };
}

test("the board holds every item the plan's inbox holds, an agent the window has not listed yet's too: what waits the oldest posted first, what is settled the latest changed first", () => {
  const board = inboxBoard(
    [
      item({ id: "late", postedAt: 30, updatedAt: 30 }),
      item({ id: "early", postedAt: 10, updatedAt: 40 }),
      item({ id: "answered", status: INBOX_STATUS.ANSWERED, updatedAt: 20 }),
      item({ id: "closed", status: INBOX_STATUS.CLOSED, updatedAt: 50 }),
      item({ id: "unlisted", agentId: UNLISTED, postedAt: 20, updatedAt: 20 }),
    ],
    undefined,
  );
  assert.deepEqual(
    board.open.map((each) => each.id),
    ["early", "unlisted", "late"],
  );
  assert.deepEqual(
    board.settled.map((each) => each.id),
    ["closed", "answered"],
  );
});

test("a task's Inbox counts what waits on the reader: a teammate's open item stands on the board but is left out of what waits, as is one settled", () => {
  const board = inboxBoard(
    [
      item({ id: "mine", startedBy: ME, postedAt: 10 }),
      item({ id: "assigned-to-me", startedBy: DANA, waitsOn: ME, postedAt: 20 }),
      item({ id: "danas", startedBy: DANA, postedAt: 30 }),
      item({ id: "assigned-to-dana", startedBy: ME, waitsOn: DANA, postedAt: 40 }),
      item({ id: "unowned", postedAt: 50 }),
      item({ id: "answered", startedBy: ME, status: INBOX_STATUS.ANSWERED, postedAt: 60 }),
    ],
    ME.userId,
  );
  assert.deepEqual(
    board.open.map((each) => each.id),
    ["mine", "assigned-to-me", "danas", "assigned-to-dana", "unowned"],
  );
  assert.deepEqual(
    board.waiting.map((each) => each.id),
    ["mine", "assigned-to-me", "unowned"],
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
  const consent: InboxResponse = {
    type: INBOX_RESPONSE.FORM,
    fields: [{ type: INBOX_FIELD.BOOLEAN, label: "Keep the old route?", required: true }],
  };
  assert.deepEqual(inboxReply(consent, EMPTY_INBOX_DRAFT), {
    reply: INBOX_REPLY.SUBMITTED,
    values: [{ label: "Keep the old route?", value: false }],
  });
});

test("a form filled in part sends what was filled, a required field left empty absent from its values, as does one given only the developer's words or files; one given nothing, a switch left alone filling nothing, sends nothing", () => {
  const settings: InboxResponse = {
    type: INBOX_RESPONSE.FORM,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Host", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Port", required: true },
      { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
    ],
  };
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

test("what an answer lacks follows what it asks: a choice its pick, unless the developer's own words or files answer it, a form given nothing its first required field left empty in the form's order, and words their words; nothing once it lacks nothing", () => {
  assert.deepEqual(inboxMissing(QUEUE, EMPTY_INBOX_DRAFT), { kind: INBOX_MISSING.OPTION });
  assert.deepEqual(inboxMissing(CHANNELS, EMPTY_INBOX_DRAFT), { kind: INBOX_MISSING.OPTION });
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, choices: ["Redis"] }), undefined);
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, note: "Use SQS." }), undefined);
  const files = [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }] as const;
  assert.equal(inboxMissing(QUEUE, { ...EMPTY_INBOX_DRAFT, attachments: files }), undefined);

  const rollout: InboxResponse = {
    type: INBOX_RESPONSE.FORM,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Branch prefix" },
      { type: INBOX_FIELD.SELECT, label: "Effort", required: true, options: ["high", "xhigh"] },
      { type: INBOX_FIELD.TEXT, label: "Reviewer", required: true },
      { type: INBOX_FIELD.BOOLEAN, label: "Post in #eng", required: true },
    ],
  };
  assert.deepEqual(inboxMissing(rollout, EMPTY_INBOX_DRAFT), {
    kind: INBOX_MISSING.FIELD,
    label: "Effort",
  });
  assert.deepEqual(
    inboxMissing(rollout, withValue(EMPTY_INBOX_DRAFT, "Reviewer", "  ")),
    { kind: INBOX_MISSING.FIELD, label: "Effort" },
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

  assert.deepEqual(inboxMissing(QUESTION, { ...EMPTY_INBOX_DRAFT, note: " " }), {
    kind: INBOX_MISSING.WORDS,
  });
  assert.equal(inboxMissing(QUESTION, { ...EMPTY_INBOX_DRAFT, note: "Hello" }), undefined);
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
  const task: InboxResponse = { type: INBOX_RESPONSE.TODO };
  assert.equal(inboxReply(task, { ...EMPTY_INBOX_DRAFT, note: "done it" }), undefined);
  assert.deepEqual(inboxReply(task, decided(INBOX_REPLY.NOT_DONE)), {
    reply: INBOX_REPLY.NOT_DONE,
  });
  assert.deepEqual(inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.DONE), {
    reply: INBOX_REPLY.DONE,
  });
  assert.equal(
    inboxReply(task, decided(INBOX_REPLY.APPROVED)),
    undefined,
    "a task takes no approval",
  );
  const step: InboxResponse = { type: INBOX_RESPONSE.APPROVAL };
  assert.deepEqual(
    inboxReply(step, {
      ...decided(INBOX_REPLY.DECLINED),
      note: " Not yet. ",
    }),
    { reply: INBOX_REPLY.DECLINED, note: "Not yet." },
  );
  const fyi: InboxResponse = { type: INBOX_RESPONSE.NONE };
  assert.deepEqual(inboxReply(fyi, EMPTY_INBOX_DRAFT), { reply: INBOX_REPLY.ACKNOWLEDGED });
  assert.deepEqual(inboxReply(fyi, { ...EMPTY_INBOX_DRAFT, note: "ok" }), {
    reply: INBOX_REPLY.ACKNOWLEDGED,
    note: "ok",
  });
  assert.equal(inboxReply(QUESTION, { ...EMPTY_INBOX_DRAFT, note: "  " }), undefined);
  assert.deepEqual(inboxReply(QUESTION, { ...EMPTY_INBOX_DRAFT, note: "Hello" }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Hello",
  });
});

test("an approval or a to-do lacks its decision until one is picked, and a note lacks nothing", () => {
  const step: InboxResponse = { type: INBOX_RESPONSE.APPROVAL };
  const task: InboxResponse = { type: INBOX_RESPONSE.TODO };
  assert.deepEqual(inboxMissing(step, EMPTY_INBOX_DRAFT), { kind: INBOX_MISSING.OPTION });
  assert.deepEqual(inboxMissing(task, { ...EMPTY_INBOX_DRAFT, note: "Did half." }), {
    kind: INBOX_MISSING.OPTION,
  });
  assert.equal(inboxMissing(task, decided(INBOX_REPLY.DONE)), undefined);
  assert.equal(inboxMissing({ type: INBOX_RESPONSE.NONE }, EMPTY_INBOX_DRAFT), undefined);
});

test("files attached alone answer an item in the developer's own words, and travel apart from the answer", () => {
  const files = [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }] as const;
  assert.deepEqual(inboxReply(QUESTION, { ...EMPTY_INBOX_DRAFT, attachments: files }), {
    reply: INBOX_REPLY.ANSWERED,
  });
  assert.deepEqual(inboxReply(QUEUE, { ...EMPTY_INBOX_DRAFT, attachments: files }), {
    reply: INBOX_REPLY.ANSWERED,
  });
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
      ({ person, items }) => [person?.name ?? "You", items.map(({ item }) => item.id)] as const,
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

test("an item whose place is held stands where the list drew it, under the status it stood under, whatever it changed to since, under either sort and every grouping", () => {
  // The threshold question is answered once the list is drawn, which changes when it changed and where it stands.
  const answered = TASKS.map(({ holder, items }) => ({
    holder,
    items: items.map((each) =>
      each.id === "threshold" ? { ...each, status: INBOX_STATUS.ANSWERED, updatedAt: 60 } : each,
    ),
  }));
  for (const grouping of Object.values(INBOX_GROUPING)) {
    for (const sort of Object.values(INBOX_SORT)) {
      const view = { grouping, sort, show: INBOX_SHOW.ALL, readerId: undefined, chosen: undefined };
      const drawnFirst = inboxList(TASKS, view);
      const places = inboxPlaces(drawnFirst, NO_PLACES);
      assert.deepEqual(drawn(inboxList(answered, { ...view, places })), drawn(drawnFirst));
      assert.notDeepEqual(drawn(inboxList(answered, view)), drawn(drawnFirst), "unheld, it moves");
    }
  }
  const status = {
    grouping: INBOX_GROUPING.STATUS,
    show: INBOX_SHOW.ALL,
    readerId: undefined,
    chosen: undefined,
  } as const;
  assert.deepEqual(
    drawn(
      inboxList(answered, { ...status, places: inboxPlaces(inboxList(TASKS, status), NO_PLACES) }),
    ),
    [
      [INBOX_STATUS_GROUP.NEEDS_YOU, ["expiry", "threshold"]],
      [INBOX_STATUS_GROUP.ANSWERED, ["retry"]],
      [INBOX_STATUS_GROUP.CLOSED, ["channel"]],
    ],
  );
});

test("a list's places are its rows', a held one kept and a new one where it stands now, so an item it no longer draws holds none and one new to it stands where it changed", () => {
  const all = {
    grouping: INBOX_GROUPING.NONE,
    show: INBOX_SHOW.ALL,
    readerId: undefined,
    chosen: undefined,
  } as const;
  const held = inboxPlaces(inboxList(TASKS, all), NO_PLACES);
  const toDo = inboxList(TASKS, { ...all, show: INBOX_SHOW.TO_DO, places: held });
  const kept = inboxPlaces(toDo, held);
  assert.deepEqual([...kept.keys()].toSorted(), ["expiry", "threshold"], "the settled items left");
  const fresh = [
    ...TASKS,
    { holder: taskHolder(INVITES), items: [item({ id: "fresh", updatedAt: 35 })] },
  ];
  assert.deepEqual(drawn(inboxList(fresh, { ...all, show: INBOX_SHOW.TO_DO, places: kept })), [
    "expiry",
    "fresh",
    "threshold",
  ]);
});

test("an item is done with once it is settled, answered or closed, and read; one open, or settled and unread since, is not", () => {
  assert.equal(isDone(item({ id: "answered", status: INBOX_STATUS.ANSWERED })), true);
  assert.equal(isDone(item({ id: "closed", status: INBOX_STATUS.CLOSED })), true);
  assert.equal(isDone(item({ id: "open" })), false);
  assert.equal(isDone(item({ id: "again", status: INBOX_STATUS.ANSWERED, unread: true })), false);
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

/** Items on tasks the service says wait on someone other than the agent's starter, beside one from a service before it said. */
const ASSIGNED = [
  {
    holder: taskHolder(BILLING),
    items: [
      // On a task assigned to the reader, though Dana started its agent.
      item({ id: "assigned-to-me", startedBy: DANA, waitsOn: ME, updatedAt: 30 }),
      // On a task assigned to Dana, though the reader started its agent.
      item({ id: "assigned-to-dana", startedBy: ME, waitsOn: DANA, updatedAt: 20 }),
    ],
  },
  {
    holder: taskHolder(INVITES),
    items: [
      // From a service before it named who an item waits on: its starter.
      item({ id: "older-service", startedBy: KAI, updatedAt: 10 }),
    ],
  },
];

test("an item waits on whoever the service says, its task's assignee, rather than its agent's starter, and on its starter from a service before it said: Needs you, the count, Whose, and Group by person all go by it", () => {
  const view = { chosen: undefined, readerId: ME.userId } as const;
  const none = { ...view, grouping: INBOX_GROUPING.NONE } as const;
  assert.deepEqual(drawn(inboxList(ASSIGNED, { ...none, show: INBOX_SHOW.TO_DO })), [
    "assigned-to-me",
  ]);
  assert.equal(inboxCounts(ASSIGNED, ME.userId)[INBOX_SHOW.TO_DO], 1);
  assert.equal(inboxCounts(ASSIGNED, DANA.userId)[INBOX_SHOW.TO_DO], 1);
  assert.equal(inboxCounts(ASSIGNED, KAI.userId)[INBOX_SHOW.TO_DO], 1);
  const whose = (choice: InboxWhose) =>
    drawn(inboxList(ASSIGNED, { ...none, show: INBOX_SHOW.ALL, whose: choice }));
  assert.deepEqual(whose({ kind: INBOX_WHOSE.MINE }), ["assigned-to-me"]);
  assert.deepEqual(whose({ kind: INBOX_WHOSE.PERSON, ...DANA }), ["assigned-to-dana"]);
  assert.deepEqual(whose({ kind: INBOX_WHOSE.PERSON, ...KAI }), ["older-service"]);
  assert.deepEqual(
    drawn(inboxList(ASSIGNED, { ...view, grouping: INBOX_GROUPING.PERSON, show: INBOX_SHOW.ALL })),
    [
      ["You", ["assigned-to-me"]],
      [DANA.name, ["assigned-to-dana"]],
      [KAI.name, ["older-service"]],
    ],
  );
});

test("a task done or canceled hides none of its items: its open ones need you and its unread ones wait, To do listing and counting them as any task's, and one is the next", () => {
  const finished = [
    {
      holder: taskHolder({ ...BILLING, status: TASK_STATUS.DONE }),
      items: [
        item({ id: "done-open", updatedAt: 20 }),
        item({ id: "done-unread", status: INBOX_STATUS.ANSWERED, updatedAt: 5, unread: true }),
      ],
    },
    {
      holder: taskHolder({ ...INVITES, status: TASK_STATUS.CANCELED }),
      items: [
        item({ id: "canceled-open", updatedAt: 10 }),
        item({ id: "canceled-unread", status: INBOX_STATUS.ANSWERED, updatedAt: 4, unread: true }),
      ],
    },
  ];
  const counts = inboxCounts(finished, undefined);
  assert.equal(counts[INBOX_SHOW.TO_DO], 4);
  assert.equal(counts[INBOX_SHOW.ALL], 4);
  const view = { grouping: INBOX_GROUPING.NONE, readerId: undefined, chosen: undefined } as const;
  const toDo = inboxList(finished, { ...view, show: INBOX_SHOW.TO_DO });
  assert.deepEqual(drawn(toDo), ["done-open", "canceled-open", "done-unread", "canceled-unread"]);
  assert.equal(nextNeedingYou(toDo, "done-open", () => false)?.item.id, "canceled-open");
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

test("what waits, as Home and a person's page list it, is every open item, whoever's, a finished task's among them, the latest first, never a settled one however unread", () => {
  const done = {
    holder: taskHolder({ ...INVITES, id: "done", status: TASK_STATUS.DONE }),
    items: [item({ id: "done-open", updatedAt: 90 })],
  };
  assert.deepEqual(
    openItems([...UNREAD_SHARED, done]).map(({ item }) => item.id),
    ["done-open", "danas", "kais", "mine-invites", "mine", "unnamed"],
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

test("a note past the wire's bound is no answer, so the card offers no send for it", () => {
  const long = "x".repeat(INBOX_BOUNDS.MAX_NOTE_CHARS + 1);
  assert.equal(inboxReply(QUESTION, { ...EMPTY_INBOX_DRAFT, note: long }), undefined);
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
      lines: ["export {};"],
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

test("a thread's latest message by a member is its row's preview, led by who wrote it, You for the reader, a message of files alone saying so", () => {
  const said = message({
    text: "Backfilled 41,208 rows; staging totals match",
    createdAt: 1_000,
    author: INBOX_MESSAGE_AUTHOR.AGENT,
  });
  const open = (last: InboxMessage) => item({ id: "g1", thread: [said, last] });
  assert.equal(
    inboxPreview(
      open(message({ text: "Is 80% too eager?", createdAt: 2_000, member: CHARLES })),
      previewName,
    ),
    "Charles Pan: Is 80% too eager?",
  );
  assert.equal(
    inboxPreview(open(message({ text: "Go ahead.", createdAt: 2_000, member: YOU })), previewName),
    "You: Go ahead.",
  );
  const filesOnly = message({
    text: "",
    createdAt: 2_000,
    member: CHARLES,
    files: [
      {
        attachmentId: "e1b2c3d4-0000-4000-8000-000000000002",
        name: "b.png",
        mediaType: "image/png",
      },
    ],
  });
  assert.equal(inboxPreview(open(filesOnly), previewName), "Charles Pan: Sent a file");
});

test("an item's media are the pages its thread names, by any link outside code, each page of each task once, then the pictures among a message's files, a file that is no picture left out, and four at most", () => {
  const task = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const elsewhere = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const pageLink = (pageId: string, planId = task) =>
    linkOf({ kind: LINK_PLACE.PAGE, planId, pageId }, "acme");
  const funnel = "3c4d5e6f-0000-4000-8000-000000000001";
  const pricing = "3c4d5e6f-0000-4000-8000-000000000002";
  const hidden = "3c4d5e6f-0000-4000-8000-000000000004";
  const sent = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c72";
  const cut = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c73";
  const threaded = item({
    id: "m1",
    thread: [
      message({
        text: `See [@Invite funnel](${pageLink(funnel)}) first, not \`${pageLink(hidden)}\`, and [its twin](${pageLink(funnel, elsewhere)}).`,
        createdAt: 1_000,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
      }),
      message({
        text: `Priced it on [the pricing page](${pageLink(pricing)}), then ${pageLink(funnel)} again.`,
        createdAt: 2_000,
        member: YOU,
        files: [
          { attachmentId: sent, name: "notes.pdf", mediaType: "application/pdf" },
          { attachmentId: sent, name: "before.webp", mediaType: "image/webp" },
          { attachmentId: cut, name: "after.png", mediaType: "image/png" },
        ],
      }),
    ],
  });
  assert.deepEqual(inboxMedia(threaded), [
    { kind: INBOX_MEDIA.PAGE, place: { taskId: task }, pageId: funnel },
    { kind: INBOX_MEDIA.PAGE, place: { taskId: elsewhere }, pageId: funnel },
    { kind: INBOX_MEDIA.PAGE, place: { taskId: task }, pageId: pricing },
    { kind: INBOX_MEDIA.IMAGE, attachmentId: sent },
  ]);
  assert.deepEqual(inboxMedia(item({ id: "m2" })), []);
});

test("an item's media take the page of an agent with no task as they take a task's, by its place, each page of each place once", () => {
  const agent = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const task = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
  const ledger = "3c4d5e6f-0000-4000-8000-000000000003";
  const agentLink = linkOf({ kind: LINK_PLACE.PAGE, agentId: agent, pageId: ledger }, "acme");
  const taskLink = linkOf({ kind: LINK_PLACE.PAGE, planId: task, pageId: ledger }, "acme");
  const carrying = item({
    id: "m4",
    thread: [
      {
        id: "n2",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: `[@Flake ledger](${agentLink}) and ${taskLink}, the ledger again: ${agentLink}`,
        createdAt: 1_000,
      },
    ],
  });
  assert.deepEqual(inboxMedia(carrying), [
    { kind: INBOX_MEDIA.PAGE, place: { agentId: agent }, pageId: ledger },
    { kind: INBOX_MEDIA.PAGE, place: { taskId: task }, pageId: ledger },
  ]);
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

test("a reply on a thread is plain unless an answer is attached: a pick, a press, a field filled, or, to an ask of words alone, its words or files; an attached answer the ask would refuse sends nothing", () => {
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
  assert.equal(inboxThreadSend(answer, EMPTY_INBOX_DRAFT), undefined, "no words, no answer");
  assert.deepEqual(
    inboxThreadSend(answer, { ...EMPTY_INBOX_DRAFT, note: "Use 90%" })?.answers,
    { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED },
    "an ask of words alone is answered by the reply's words, with no press",
  );
  const files = [{ name: "trace.txt", mediaType: "text/plain", data: btoa("boom\n") }] as const;
  assert.deepEqual(inboxThreadSend(answer, { ...EMPTY_INBOX_DRAFT, attachments: files })?.answers, {
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

test("ticking every step by hand counts as Mark done, which letting one go takes back off, while a press given wins", () => {
  const ask = { type: INBOX_ASK.DO, steps: ["One", "Two", "Three"] } as const;
  const steps = [asking(ask)];
  const tick = (draft: InboxDraft, ...at: number[]) =>
    at.reduce((held, each) => withStep(ask, held, each), draft);
  const every = tick(EMPTY_INBOX_DRAFT, 2, 0, 1);
  assert.equal(doDecision(ask, every), INBOX_REPLY.DONE, "Mark done stands pressed");
  assert.deepEqual(inboxThreadSend(steps, every)?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.DONE,
    steps: [0, 1, 2],
  });

  const letGo = withStep(ask, every, 1);
  assert.equal(doDecision(ask, letGo), undefined, "letting a step go takes Mark done back off");
  assert.deepEqual(shownTicks(ask, letGo), [0, 2]);

  const failed = tick({ ...EMPTY_INBOX_DRAFT, press: INBOX_REPLY.NOT_DONE }, 0, 1, 2);
  assert.equal(doDecision(ask, failed), INBOX_REPLY.NOT_DONE, "Couldn't do it pressed stands");
  assert.deepEqual(inboxThreadSend(steps, failed)?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.NOT_DONE,
    steps: [0, 1, 2],
  });

  const released = withDoPress(ask, every, INBOX_REPLY.DONE);
  assert.equal(
    doDecision(ask, released),
    undefined,
    "pressing the Mark done it stands for lets it go",
  );
  assert.deepEqual(shownTicks(ask, released), []);
  const swapped = withDoPress(ask, every, INBOX_REPLY.NOT_DONE);
  assert.equal(doDecision(ask, swapped), INBOX_REPLY.NOT_DONE);
  assert.deepEqual(inboxThreadSend(steps, swapped)?.answers?.steps, [0, 1, 2]);
  const pressed = withDoPress(ask, tick(EMPTY_INBOX_DRAFT, 1), INBOX_REPLY.DONE);
  assert.equal(doDecision(ask, pressed), INBOX_REPLY.DONE);
  assert.deepEqual(shownTicks(ask, withDoPress(ask, pressed, INBOX_REPLY.DONE)), [1]);

  const titled = { type: INBOX_ASK.DO, steps: [] } as const;
  const ticked = withStep(titled, EMPTY_INBOX_DRAFT, 0);
  assert.equal(doDecision(titled, ticked), INBOX_REPLY.DONE, "ticking the title marks it done");
  assert.deepEqual(inboxThreadSend([asking(titled)], ticked)?.answers, {
    ask: ASKING_ID,
    reply: INBOX_REPLY.DONE,
    steps: [],
  });
});

test("steps ticked with neither press go with the reply as an answer deciding nothing, its stamp saying what was ticked; none ticked leaves the reply plain", () => {
  const ask = { type: INBOX_ASK.DO, steps: ["One", "Two", "Three"] } as const;
  const steps = [asking(ask)];
  const some = withStep(ask, withStep(ask, EMPTY_INBOX_DRAFT, 2), 0);
  const answers = inboxThreadSend(steps, { ...some, note: "Stuck on two." })?.answers;
  assert.deepEqual(answers, { ask: ASKING_ID, reply: INBOX_REPLY.ANSWERED, steps: [0, 2] });
  assert.equal(doDecision(ask, some), undefined);
  if (answers !== undefined) {
    assert.deepEqual(sentStamp(answers, steps[0]?.ask), {
      tone: ANSWER_TONE.AHEAD,
      words: "Ticked 2/3",
    });
  }
  assert.deepEqual(
    inboxThreadSend(steps, { ...EMPTY_INBOX_DRAFT, note: "Later." }),
    { text: "Later.", attachments: [] },
    "a reply with nothing ticked is plain",
  );
  assert.deepEqual(
    inboxThreadSend(steps, { ...EMPTY_INBOX_DRAFT, steps: [1], press: INBOX_REPLY.NOT_DONE })
      ?.answers,
    { ask: ASKING_ID, reply: INBOX_REPLY.NOT_DONE, steps: [1] },
    "Couldn't do it carries the step ticked by hand",
  );
});

test("a notice, open with no ask open on its thread, waits on the reader's nod, which opening it gives where its agent does not wait to hear back; a thread whose ask is open, or one settled, waits on none", () => {
  const said: InboxMessage = {
    id: "b1b2c3d4-0000-4000-8000-000000000010",
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "The preview is up.",
    createdAt: 1_000,
  };
  const notice = item({
    id: "a1b2c3d4-0000-4000-8000-000000000010",
    needsReply: false,
    thread: [said],
  });

  assert.equal(awaitsNod(notice), true);
  assert.equal(acknowledgedOnOpen(notice, READER, false), true);
  assert.equal(
    acknowledgedOnOpen({ ...notice, needsReply: true }, READER, false),
    false,
    "a notice whose agent waits to hear back is not nodded to by a mere open",
  );
  assert.equal(
    acknowledgedOnOpen(notice, undefined, false),
    false,
    "nor before the reader is known",
  );
  const asked = asking({ type: INBOX_ASK.ANSWER });
  assert.equal(awaitsNod({ ...notice, thread: [asked] }), false);
  assert.equal(
    awaitsNod({ ...notice, thread: [said, asked] }),
    false,
    "an ask open on the thread is answered, not nodded to",
  );
  assert.equal(awaitsNod({ ...notice, status: INBOX_STATUS.ANSWERED }), false);
});

test("an item of an agent with no task waits on the member it is addressed to, else on its starter", () => {
  const teammate = CHARLES.userId;

  assert.deepEqual(
    [
      waitsOnReader({ startedBy: teammate, waitsOn: READER }, READER),
      waitsOnReader({ startedBy: READER, waitsOn: teammate }, READER),
      waitsOnReader({ startedBy: READER }, READER),
    ],
    [true, false, true],
  );
});

test("under Channels a notice offers Got it, and is nodded to on open, only where its agent addressed it to the reader; one addressed to nobody is only read", () => {
  const notice = item({
    id: "a1b2c3d4-0000-4000-8000-000000000011",
    needsReply: false,
    waitsOn: YOU,
    thread: [
      {
        ...message({ text: "The preview is up.", createdAt: 1_000 }),
        author: INBOX_MESSAGE_AUTHOR.AGENT,
      },
    ],
  });
  const addressed = { ...notice, addressed: true };

  assert.deepEqual(
    [asksNod(notice, READER, true), acknowledgedOnOpen(notice, READER, true)],
    [false, false],
  );
  assert.deepEqual(
    [asksNod(addressed, READER, true), acknowledgedOnOpen(addressed, READER, true)],
    [true, true],
  );
  assert.deepEqual(
    [
      asksNod({ ...addressed, waitsOn: CHARLES }, READER, true),
      acknowledgedOnOpen({ ...addressed, waitsOn: CHARLES }, READER, true),
    ],
    [false, false],
    "a notice addressed to a teammate is theirs to nod to",
  );
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
    words: "Changes requested",
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
  assert.equal(
    rowOf({
      type: INBOX_ASK.DECIDE,
      options,
      multiple: true,
      recommended: "7 days",
      recommendations: ["7 days", "30 days"],
    }),
    "7 days ★ / 14 days / 30 days ★",
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
    thread: [standing(asked, INBOX_ASK_STATUS.ANSWERED), answer],
  });
  assert.deepEqual(inboxMedia(threaded), [
    { kind: INBOX_MEDIA.PAGE, place: { taskId: task }, pageId: funnel },
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

test("a recording an agent posted stands with a comment's pictures, never its other files: one its words draw is not named again over them, one they do not draw is played among the pictures", () => {
  const itemId = "a1b2c3d4-0000-4000-8000-0000000000f1";
  const place = {
    kind: LINK_PLACE.INBOX_ITEM,
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    itemId,
  } as const;
  const address = (attachmentId: string) => `${linkOf(place, "acme")}/files/${attachmentId}`;
  const [drawn, loose] = [
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3ca0",
    "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3ca1",
  ];
  const webm = (attachmentId: string) => ({
    attachmentId,
    name: `${attachmentId.slice(-2)}.webm`,
    mediaType: "video/webm",
  });
  const read = inboxCommentFiles(
    [webm(drawn), webm(loose)],
    `The sign-up flow:\n\n![Signing up](${address(drawn)} "The flow")`,
    itemId,
  );
  assert.deepEqual(
    read.pictures.map((file) => file.attachmentId),
    [loose],
  );
  assert.deepEqual(read.others, [], "no recording is named as a file");
});

/** The message with its ask standing as `status` says; the very message where it asks nothing. */
function standing(
  message: InboxMessage,
  status: (typeof INBOX_ASK_STATUS)[keyof typeof INBOX_ASK_STATUS],
): InboxMessage {
  const { ask } = message;
  return ask === undefined ? message : { ...message, ask: { ...ask, status } };
}

test("a settled item's card says how it ended whatever its row's glyph: an answer even with words after it, an ask taken back and why, a member's close", () => {
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

test("a settled item's card names its ending in the word its line says it in: answered, resolved by a member, or withdrawn by its agent", () => {
  const asked = asking({
    type: INBOX_ASK.DECIDE,
    options: [{ label: "7 days" }, { label: "14 days" }],
  });
  const answered = item({ id: "w1", status: INBOX_STATUS.ANSWERED, thread: [asked] });
  assert.equal(inboxSettledStanding(answered), "Answered");

  const resolved = item({
    id: "w2",
    status: INBOX_STATUS.CLOSED,
    closedBy: CHARLES,
    thread: [asked],
  });
  assert.equal(inboxSettledWords(resolved, previewName), "Charles Pan: Resolved without an answer");
  assert.equal(inboxSettledStanding(resolved), "Resolved");

  // Note that the service's member close withdraws the ask it left open, saying no why.
  const resolvedAsked = item({
    id: "w5",
    status: INBOX_STATUS.CLOSED,
    closedBy: CHARLES,
    thread: [standing(asked, INBOX_ASK_STATUS.WITHDRAWN)],
  });
  assert.equal(
    inboxSettledWords(resolvedAsked, previewName),
    "Charles Pan: Resolved without an answer",
  );
  assert.equal(inboxSettledStanding(resolvedAsked), "Resolved");

  const takenBack = item({
    id: "w3",
    status: INBOX_STATUS.CLOSED,
    thread: [standing(asked, INBOX_ASK_STATUS.WITHDRAWN)],
  });
  assert.equal(inboxSettledWords(takenBack, previewName), "Withdrawn");
  assert.equal(inboxSettledStanding(takenBack), "Withdrawn");

  const before = item({ id: "w4", status: INBOX_STATUS.CLOSED, closedReason: "Merged already." });
  assert.equal(
    inboxSettledStanding(before),
    "Withdrawn",
    "an agent's close of a thread holding no ask says why",
  );
});

test("a thread a member started reads Sent until its agent writes on it, by a reply of its own as much as by a post", () => {
  const opener = {
    id: "e1b2c3d4-0000-4000-8000-0000000000f2",
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    member: DANA,
    text: "Draft the annual plan's line too.",
    createdAt: 1_000,
  };
  const started = item({
    id: "t1",
    needsReply: false,
    status: INBOX_STATUS.ANSWERED,
    thread: [opener],
  });
  assert.equal(inboxSettledStanding(started), "Sent");

  const replied = {
    ...started,
    thread: [
      opener,
      {
        id: "e1b2c3d4-0000-4000-8000-0000000000f3",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Two months free, billed yearly.",
        createdAt: 2_000,
      },
    ],
  };
  assert.equal(inboxSettledStanding(replied), "Answered", "the agent's reply leaves the revision");
});
