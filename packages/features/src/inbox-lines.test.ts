import assert from "node:assert/strict";
import { test } from "vitest";
import {
  INBOX_REPLY,
  inboxAnswerMessage,
  inboxClosedMessage,
  inboxLineWords,
  inboxThreadMessage,
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
