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
} from "@sidecar/hosted/inbox-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import {
  CODE_READ,
  codeNotice,
  codeReadOf,
  codeWindow,
  EMPTY_INBOX_DRAFT,
  inboxBoard,
  inboxReply,
  settledWords,
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
  const task = item({ id: "task", response: { type: INBOX_RESPONSE.TASK } });
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

test("a settled card says what was answered and the note, a form's values a line each, or that the agent took it back and why", () => {
  assert.deepEqual(
    settledWords(
      item({
        id: "a",
        status: INBOX_STATUS.ANSWERED,
        answer: { reply: INBOX_REPLY.CHOSE, choices: ["Redis", "Postgres"], note: "Fine." },
      }),
    ),
    { lead: "Chose Redis, Postgres", note: "Fine." },
  );
  assert.deepEqual(
    settledWords(
      item({
        id: "f",
        status: INBOX_STATUS.ANSWERED,
        answer: {
          reply: INBOX_REPLY.SUBMITTED,
          values: [
            { label: "Port", value: 587 },
            { label: "Verify certificate", value: true },
          ],
        },
      }),
    ),
    { lead: "Filled in", note: "Port: 587\nVerify certificate: yes" },
  );
  assert.deepEqual(
    settledWords(
      item({ id: "n", status: INBOX_STATUS.ANSWERED, answer: { reply: INBOX_REPLY.ACKNOWLEDGED } }),
    ),
    { lead: "Acknowledged" },
  );
  assert.deepEqual(
    settledWords(item({ id: "b", status: INBOX_STATUS.CLOSED, closedReason: "Found it." })),
    { lead: "Closed by the agent", note: "Found it." },
  );
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
  assert.deepEqual(codeReadOf(block, { failure: PLAN_CALL_FAILURE.UNANSWERED }), {
    kind: CODE_READ.NOTICE,
    line: "These lines could not be read.",
    again: true,
  });
  assert.equal(
    codeNotice(block, null),
    "These lines are in acme/relay, which this plan no longer reads.",
    "a plan that names no repository reads none",
  );
  assert.equal(codeNotice(block, "Acme/Relay"), undefined);
  assert.equal(
    codeNotice({ ...block, startLine: 9 }, "acme/relay"),
    "These lines cannot be read.",
    "lines running backwards are no window to read",
  );
});
