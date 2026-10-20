import assert from "node:assert/strict";
import { test } from "vitest";
import {
  askStillAsked,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_RESPONSE,
  type InboxReadAsk,
} from "./inbox-wire.js";

/**
 * inbox-wire.test.ts -- an item's open ask is still the one its response
 * asks while the two say the same, though each is built apart, and is no
 * longer once the response says otherwise.
 */

const OPTIONS = [{ label: "Operating" }, { label: "Payroll" }];

/** The decide ask held open with those options. */
const DECIDE: InboxReadAsk = {
  type: INBOX_ASK.DECIDE,
  options: OPTIONS,
  status: INBOX_ASK_STATUS.OPEN,
};

test("a decide ask and an answer ask stand for the response that says the same, and a decide ask no longer once its options change", () => {
  assert.equal(
    askStillAsked(
      { type: INBOX_RESPONSE.CHOICE, options: OPTIONS.map((option) => ({ ...option })) },
      DECIDE,
    ),
    true,
  );
  assert.equal(
    askStillAsked(
      { type: INBOX_RESPONSE.TEXT },
      { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.OPEN },
    ),
    true,
  );
  assert.equal(
    askStillAsked({ type: INBOX_RESPONSE.CHOICE, options: [{ label: "Operating" }] }, DECIDE),
    false,
  );
});
