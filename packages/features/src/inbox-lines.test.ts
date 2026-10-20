import assert from "node:assert/strict";
import { test } from "vitest";
import {
  INBOX_REPLY,
  inboxAnswerMessage,
  inboxClosedMessage,
  inboxLineWords,
  inboxThreadMessage,
  inboxTodoTicks,
} from "./inbox-wire.js";

/**
 * inbox-lines.test.ts -- an inbox answer or thread message reads back to the
 * developer without the item's key, which names the item to the agent alone,
 * its title and every word after it kept; any other line reads as it is.
 * Synthetic items throughout.
 */

const ITEM = { key: "acting-for.v2", title: 'Ship "Billing agent for Dean"?' };

test("a member's close reads back to the developer as the item's title and that it was closed without an answer, without its key", () => {
  assert.equal(
    inboxLineWords(inboxClosedMessage(ITEM)),
    'Inbox closed on "Ship "Billing agent for Dean"?": Closed without an answer.',
  );
});

test("an inbox answer and a thread message read back without the item's key, their title and words kept, and any other line as it is", () => {
  const answer = inboxAnswerMessage(ITEM, {
    reply: INBOX_REPLY.DECLINED,
    note: "Too much for now.",
  });
  assert.equal(
    inboxLineWords(answer),
    'Inbox answer on "Ship "Billing agent for Dean"?": Declined.\n\nToo much for now.',
  );
  assert.equal(
    inboxLineWords(inboxThreadMessage(ITEM, "Which PRs first?")),
    'Inbox message on "Ship "Billing agent for Dean"?":\n\nWhich PRs first?',
  );
  const typed = 'I wrote (key notes) on "this" myself.';
  assert.equal(inboxLineWords(typed), typed);
});

test("an answer to a to-do tells the agent which steps were ticked, and steps ticked with neither press never say Not done", () => {
  const todo = { steps: ["Open **Settings**.", "Add the key.", "Redeploy."], ticked: [0, 2] };
  assert.equal(
    inboxAnswerMessage(ITEM, { reply: INBOX_REPLY.ANSWERED }, todo),
    'Inbox answer on "Ship "Billing agent for Dean"?" (key acting-for.v2): Ticked 2 of 3 steps.' +
      "\n\n- [x] Open **Settings**.\n- [ ] Add the key.\n- [x] Redeploy.",
  );
  assert.equal(
    inboxAnswerMessage(ITEM, { reply: INBOX_REPLY.NOT_DONE, note: "No access." }, todo),
    'Inbox answer on "Ship "Billing agent for Dean"?" (key acting-for.v2): Not done.' +
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
});
