import assert from "node:assert/strict";
import { INBOX_KIND, INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@sidecar/hosted/inbox-wire";
import { test } from "vitest";
import { EMPTY_INBOX_DRAFT, inboxBoard, inboxReply, settledWords } from "./inbox-model";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const GONE = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";

/** An item of the agent's, open, as the service answers one. */
function item(overrides: Partial<InboxItem> & Pick<InboxItem, "id">): InboxItem {
  return {
    agentId: AGENT,
    key: overrides.id,
    revision: 1,
    kind: INBOX_KIND.QUESTION,
    title: "What should the email say?",
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const QUEUE = item({
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  kind: INBOX_KIND.CHOICE,
  options: [{ label: "Postgres" }, { label: "Redis" }],
});

test("the board holds only the plan's agents' items: what waits the oldest posted first, what is settled the latest changed first", () => {
  const board = inboxBoard(
    [
      item({ id: "late", postedAt: 30, updatedAt: 30 }),
      item({ id: "early", postedAt: 10, updatedAt: 40 }),
      item({ id: "answered", status: INBOX_STATUS.ANSWERED, updatedAt: 20 }),
      item({ id: "closed", status: INBOX_STATUS.CLOSED, updatedAt: 50 }),
      item({ id: "gone", agentId: GONE }),
    ],
    [AGENT],
  );
  assert.deepEqual(
    board.open.map((each) => each.id),
    ["early", "late"],
  );
  assert.deepEqual(
    board.settled.map((each) => each.id),
    ["closed", "answered"],
  );
});

test("a choice is answered by its option with the note beside it, or by the developer's own words, and holds no answer with neither", () => {
  assert.equal(inboxReply(QUEUE, EMPTY_INBOX_DRAFT), undefined);
  assert.deepEqual(inboxReply(QUEUE, { choice: "Redis", note: " Keep it simple. " }), {
    reply: INBOX_REPLY.CHOSE,
    choice: "Redis",
    note: "Keep it simple.",
  });
  assert.deepEqual(inboxReply(QUEUE, { choice: undefined, note: "Use SQS." }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Use SQS.",
  });
  assert.equal(inboxReply(QUEUE, { choice: "SQS", note: "" }), undefined, "no such option");
});

test("an approval and a task are answered by their presses alone, and an open question by words", () => {
  const task = item({ id: "task", kind: INBOX_KIND.TASK });
  assert.equal(inboxReply(task, { choice: undefined, note: "done it" }), undefined);
  assert.deepEqual(inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.DONE), {
    reply: INBOX_REPLY.DONE,
  });
  assert.equal(
    inboxReply(task, EMPTY_INBOX_DRAFT, INBOX_REPLY.APPROVED),
    undefined,
    "a task takes no approval",
  );
  const question = item({ id: "question" });
  assert.equal(inboxReply(question, { choice: undefined, note: "  " }), undefined);
  assert.deepEqual(inboxReply(question, { choice: undefined, note: "Hello" }), {
    reply: INBOX_REPLY.ANSWERED,
    note: "Hello",
  });
});

test("a settled card says what was answered and the note, or that the agent took it back and why", () => {
  assert.deepEqual(
    settledWords(
      item({
        id: "a",
        status: INBOX_STATUS.ANSWERED,
        answer: { reply: INBOX_REPLY.CHOSE, choice: "Redis", note: "Fine." },
      }),
    ),
    { lead: "Chose Redis", note: "Fine." },
  );
  assert.deepEqual(
    settledWords(item({ id: "b", status: INBOX_STATUS.CLOSED, closedReason: "Found it." })),
    { lead: "Closed by the agent", note: "Found it." },
  );
});
