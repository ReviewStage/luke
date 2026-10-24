import assert from "node:assert/strict";
import { test } from "vitest";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_STATUS,
  type InboxReadAsk,
  inboxStartTitle,
  standingAsk,
} from "./inbox-wire.js";

/**
 * inbox-wire.test.ts -- an ask kept open reads as the item stands: open
 * while the item holds it open, replaced where it holds another, and
 * answered or withdrawn, with the close's reason, once the item settled
 * on it; and a thread a member starts is titled by its words.
 */

const ASK_ID = "6f1c2a4e-1b9d-4c7e-9a52-3d8e0f4b7c11";

/** The decide ask kept open. */
const DECIDE: InboxReadAsk = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "Operating" }, { label: "Payroll" }],
  status: INBOX_ASK_STATUS.OPEN,
};

test("an ask kept open reads as the item holds it: open, replaced, answered, or withdrawn with why", () => {
  const open = { status: INBOX_STATUS.OPEN, openAskMessageId: ASK_ID, closedReason: null };
  assert.deepEqual(standingAsk(DECIDE, ASK_ID, open), DECIDE);
  assert.equal(
    standingAsk(DECIDE, ASK_ID, { ...open, openAskMessageId: null }).status,
    INBOX_ASK_STATUS.REPLACED,
  );
  assert.equal(
    standingAsk(DECIDE, ASK_ID, { ...open, status: INBOX_STATUS.ANSWERED }).status,
    INBOX_ASK_STATUS.ANSWERED,
  );
  assert.deepEqual(
    standingAsk(DECIDE, ASK_ID, {
      ...open,
      status: INBOX_STATUS.CLOSED,
      closedReason: "Found the key.",
    }),
    { ...DECIDE, status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: "Found the key." },
  );
});

test("a thread started with neither words nor a file is titled Untitled item", () => {
  assert.equal(inboxStartTitle({ text: "" }), "Untitled item");
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
    "see pricing.tsx",
  );
  assert.equal(
    inboxStartTitle({
      text: "Can you also draft the annual plan copy for the pricing table and the checkout page?",
    }),
    "Can you also draft the annual plan copy for the pricing…",
  );
  assert.equal(inboxStartTitle({ text: "", attachments: [PDF] }), "invoice.pdf");
  assert.equal(
    inboxStartTitle({
      text: "",
      attachments: [{ ...PDF, name: `${"q3 board report ".repeat(12)}.pdf` }],
    }).length <= 61,
    true,
    "a long file name is cut as a long line is",
  );
  assert.equal(
    inboxStartTitle({ text: "```typescript\nconst total = 1;\n```" }),
    "const total = 1;",
    "a code fence's language is no title",
  );
  assert.equal(
    inboxStartTitle({
      text: "Read [the guide](https://example.com/guide_(draft)) before merging",
    }),
    "Read the guide before merging",
  );
  for (const rule of ["---", "***", "_ _ _"]) {
    assert.equal(
      inboxStartTitle({ text: `${rule}\nPlease review the pricing change` }),
      "Please review the pricing change",
      `a ${rule} break is no title`,
    );
  }
  assert.equal(
    inboxStartTitle({ text: "_Why_ does get_user_id return null in __init__.py?" }),
    "Why does get_user_id return null in init.py?",
  );
  assert.equal(
    inboxStartTitle({ text: "[](".repeat(2_000) }).length <= 61,
    true,
    "a line of unclosed links is cut as any other",
  );
});
