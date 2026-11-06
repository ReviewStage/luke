import assert from "node:assert/strict";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { test } from "vitest";
import { INBOX_CHANGE, INBOX_ITEM } from "./inbox-collections.js";

const ITEM: InboxItem = {
  id: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
  agentId: "0b7c2f4e-3a1d-4c5e-9f8a-6d7e8f9a0b1c",
  key: "push-access",
  revision: 2,
  version: INBOX_WIRE_VERSION,
  title: "Push to the release branch?",
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 2_000,
  unread: true,
};

/** The item as a reminder asked at `at` draws it over `item`. */
function reminded(item: InboxItem, until: number | null, at: number): InboxItem | undefined {
  const drawn = INBOX_ITEM.drawn({ kind: INBOX_CHANGE.REMINDED, itemId: item.id, until, at }, item);
  return typeof drawn === "object" ? drawn : undefined;
}

test("a reminder draws the item put away at once and leaves it unread, and canceling one brings the item back when it was asked rather than forgetting when", () => {
  const asleep = reminded(ITEM, 9_000, 3_000);
  assert.deepEqual(asleep, { ...ITEM, remindAt: 9_000 });
  assert.equal(asleep === undefined ? undefined : reminded(asleep, null, 4_000)?.remindAt, 4_000);
  assert.equal(reminded(ITEM, null, 4_000), undefined, "canceling no reminder changes nothing");
});
