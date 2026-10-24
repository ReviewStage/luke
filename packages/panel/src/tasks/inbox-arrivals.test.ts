// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_STATUS, type InboxItem } from "@luke/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { useInboxArrivals } from "./inbox-arrivals.js";

/**
 * inbox-arrivals.test.ts -- the Inbox on screen says what lands in it once,
 * politely: items that landed together by their count, one by its title,
 * nothing of where it stood when first read, of a thread the reader opened
 * themselves, or of what landed while it was not on screen. Synthetic items
 * throughout.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function item(id: string, title: string, unread = true): InboxItem {
  return {
    id,
    agentId: "00000000-0000-4000-8000-000000000001",
    key: id,
    revision: 1,
    version: 5,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1,
    updatedAt: 1,
    unread,
  };
}

function Harness({
  taskId,
  items,
  onScreen,
}: {
  taskId: string;
  items: readonly InboxItem[];
  onScreen: boolean;
}): null {
  useInboxArrivals({ taskId, items, read: true }, onScreen);
  return null;
}

/** An Inbox drawn over `items`, and how to hand it its next push. */
function inbox(taskId: string, items: readonly InboxItem[], onScreen = true) {
  mountAnnouncer();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const push = (next: readonly InboxItem[], shown = onScreen) =>
    act(() => root?.render(createElement(Harness, { taskId, items: next, onScreen: shown })));
  push(items);
  return push;
}

const RELEASE = item("11111111-1111-4111-8111-111111111111", "Push to the release branch?");
const STAGING = item("22222222-2222-4222-8222-222222222222", "Rotate the staging key?");
const DEPLOY = item("33333333-3333-4333-8333-333333333333", "Hold the deploy?");

test("two items landing in one push are said once, with their count, and none of what was there first", () => {
  const push = inbox("plan-a", [RELEASE]);
  assert.equal(announcedPolitely(), "", "the Inbox as first read is no news");
  push([STAGING, DEPLOY, RELEASE]);
  assert.equal(announcedPolitely(), "2 new items in your inbox");
});

test("one item landing is said by its title", () => {
  const push = inbox("plan-b", []);
  push([RELEASE]);
  assert.equal(announcedPolitely(), "New in your inbox: Push to the release branch?");
});

test("a thread the reader opened with New thread lands read, and says nothing", () => {
  const push = inbox("plan-c", []);
  push([item("44444444-4444-4444-8444-444444444444", "Draft the changelog", false)]);
  assert.equal(announcedPolitely(), "");
});

test("an item that landed while the Inbox was not on screen is not said once it is", () => {
  // Note that the item is one no other test says, since an item said once is said by no Inbox again.
  const unseen = item("55555555-5555-4555-8555-555555555555", "Close the stale branch?");
  const push = inbox("plan-d", [], false);
  push([unseen], false);
  push([unseen], true);
  assert.equal(announcedPolitely(), "");
});

test("an item its agent posts again under the same key, at a newer revision, is said again", () => {
  const first = item("66666666-6666-4666-8666-666666666666", "Merge the release?");
  const push = inbox("plan-e", []);
  push([first]);
  assert.equal(announcedPolitely(), "New in your inbox: Merge the release?");
  // Answered, it leaves the list; posted again, it comes back at its next revision.
  push([]);
  push([{ ...first, revision: 2, title: "Merge the hotfix too?" }]);
  assert.equal(announcedPolitely(), "New in your inbox: Merge the hotfix too?");
});
