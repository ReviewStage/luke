import assert from "node:assert/strict";
import { test } from "vitest";
import { INBOX_REPLY, inboxAnswerMessage, inboxTodoTicks } from "./inbox-wire.js";

/**
 * inbox-lines.test.ts -- an answer to a to-do tells the agent which of its
 * steps were ticked, read off the ask it answers. Synthetic items throughout.
 */

const ITEM = { key: "acting-for.v2", title: 'Ship "Billing agent for Dean"?' };

test("an answer to a to-do tells the agent which steps were ticked, and steps ticked with neither press never say Not done", () => {
  const todo = { steps: ["Open **Settings**.", "Add the key.", "Redeploy."], ticked: [0, 2] };
  assert.equal(
    inboxAnswerMessage(ITEM, { reply: INBOX_REPLY.ANSWERED }, todo),
    'Thread answer on "Ship "Billing agent for Dean"?" (key acting-for.v2): Ticked 2 of 3 steps.' +
      "\n\n- [x] Open **Settings**.\n- [ ] Add the key.\n- [x] Redeploy.",
  );
  assert.equal(
    inboxAnswerMessage(ITEM, { reply: INBOX_REPLY.NOT_DONE, note: "No access." }, todo),
    'Thread answer on "Ship "Billing agent for Dean"?" (key acting-for.v2): Not done.' +
      "\n\n- [x] Open **Settings**.\n- [ ] Add the key.\n- [x] Redeploy.\n\nNo access.",
  );
});

test("a to-do's ticks are read off the thread by the ask the answer names, and none for another ask", () => {
  const ask = "00000000-0000-4000-8000-000000000001";
  const thread = [
    {
      id: ask,
      author: "agent",
      text: "Add the key.",
      ask: { type: "do", steps: ["Open Settings.", "Add the key."], status: "answered" },
      createdAt: 1,
    },
  ] as const;
  const item = { thread } as unknown as Parameters<typeof inboxTodoTicks>[0];
  assert.deepEqual(inboxTodoTicks(item, { ask, reply: INBOX_REPLY.ANSWERED, steps: [1] }), {
    steps: ["Open Settings.", "Add the key."],
    ticked: [1],
  });
  assert.equal(
    inboxTodoTicks(item, { ask: "00000000-0000-4000-8000-000000000002", reply: INBOX_REPLY.DONE }),
    undefined,
  );
  const older = { type: "do", steps: ["Rotate the key."] } as const;
  assert.deepEqual(
    inboxTodoTicks(
      { thread: [] },
      { ask, reply: INBOX_REPLY.ANSWERED, steps: [0] },
      older as Parameters<typeof inboxTodoTicks>[2],
    ),
    { steps: ["Rotate the key."], ticked: [0] },
    "the ask answered, given, stands for one a long thread's read left out",
  );
});
