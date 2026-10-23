import assert from "node:assert/strict";
import { test } from "vitest";
import {
  askStillAsked,
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_RESPONSE,
  type InboxReadAsk,
  inboxStartTitle,
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

test("a thread started with no subject is titled by its message's first line that says anything, as plain words cut on a word, else by its first file's name", () => {
  const PDF = { name: "invoice.pdf", mediaType: "application/pdf", data: "JVBERi0=" } as const;
  assert.equal(inboxStartTitle({ title: "Pricing", text: "Anything." }), "Pricing");
  assert.equal(
    inboxStartTitle({ text: "\n## Annual plan **copy**\nDraft it too." }),
    "Annual plan copy",
  );
  assert.equal(
    inboxStartTitle({
      text: "- see [@pricing.tsx](https://github.com/acme/app/blob/HEAD/pricing.tsx)",
    }),
    "see @pricing.tsx",
  );
  assert.equal(
    inboxStartTitle({
      text: "Can you also draft the annual plan copy for the pricing table and the checkout page?",
    }),
    "Can you also draft the annual plan copy for the pricing…",
  );
  assert.equal(inboxStartTitle({ text: "", attachments: [PDF] }), "invoice.pdf");
  assert.equal(
    inboxStartTitle({ text: "[](".repeat(2_000) }).length <= 61,
    true,
    "a line of unclosed links is cut as any other",
  );
});
