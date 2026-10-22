import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ACCOUNT_CHAT_REASON, type AccountChatEntry } from "./account-inbox-wire.js";
import {
  type AccountInboxLiveRows,
  accountInboxOfLiveRows,
  FAILED_RUN_WINDOW_MILLIS,
} from "./live-wire.js";

const NOW = 1_800_000_100_000;

const ITEM = {
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  planId: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  agentId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  agentTitle: null,
  agentModel: "anthropic/claude-opus-5.5",
  startedBy: "user-1",
  title: "Require a review on main",
  revision: 1,
  postedAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  unread: true,
};

const RUN = {
  id: "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
  automationId: "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b",
  automationName: "Nightly flake sweep",
  workspaceId: "workspace-1",
  reason: null,
  failedAt: NOW - 1_000,
};

const DIRECT: AccountChatEntry = {
  messageId: "5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c",
  seq: 7,
  workspaceId: "workspace-1",
  reason: ACCOUNT_CHAT_REASON.DIRECT,
  from: "agent-1",
  planId: null,
  touchedSeq: 7,
  updatedAt: NOW - 2_000,
};

const ROWS: AccountInboxLiveRows = {
  items: [ITEM],
  planless: [],
  plans: [{ planId: ITEM.planId, items: 1, updatedAt: ITEM.updatedAt }],
  automations: [],
  failedRuns: [RUN],
  chatAsks: [],
  chatNotices: [],
};

const cursorOf = (rows: AccountInboxLiveRows, now = NOW) =>
  accountInboxOfLiveRows(rows, now).cursor;

describe("a live answer's cursor", () => {
  it("stands while nothing the reader announces or counts moved, whenever it is read", () => {
    assert.equal(cursorOf(ROWS), cursorOf({ ...ROWS }, NOW + 60_000));
    assert.equal(
      cursorOf(ROWS),
      cursorOf({ ...ROWS, plans: [{ planId: ITEM.planId, items: 2, updatedAt: NOW }] }),
      "the tasks holding items are compared apart",
    );
  });

  it("moves where the held read's would, though the items are as many as before", () => {
    const before = cursorOf(ROWS);
    for (const [why, rows] of [
      ["a direct message waits", { ...ROWS, chatNotices: [DIRECT] }],
      ["the item was read", { ...ROWS, items: [{ ...ITEM, unread: false }] }],
      ["the item was posted again", { ...ROWS, items: [{ ...ITEM, revision: 2, updatedAt: NOW }] }],
      [
        "another item took its place",
        { ...ROWS, items: [{ ...ITEM, id: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d" }] },
      ],
      ["a run failed", { ...ROWS, failedRuns: [RUN, { ...RUN, id: DIRECT.messageId }] }],
    ] as const) {
      assert.notEqual(cursorOf(rows), before, why);
    }
    assert.notEqual(
      cursorOf(ROWS, RUN.failedAt + FAILED_RUN_WINDOW_MILLIS + 1),
      before,
      "a failed run aged out of the last week",
    );
  });
});
