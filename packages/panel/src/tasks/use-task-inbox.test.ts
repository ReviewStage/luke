// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type CodingAgentInboxChanged, INBOX_SCOPE_KIND } from "@luke/features/coding-agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { type TaskInboxControl, useTaskInbox } from "./use-task-inbox.js";

/**
 * use-task-inbox.test.ts -- a task's inbox taken up again, as the Inbox
 * does when a row of another task is pressed and then one of this task's,
 * starts from nothing until its follow pushes anew, rather than from the
 * push it held when it was let go, which lacks every item posted since.
 */

let root: Root | undefined;

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const INVITES = "0b7f6f1e-1111-4a6b-9c33-0d1e2f3a4b5c";
const BILLING = "0b7f6f1e-2222-4a6b-9c33-0d1e2f3a4b5c";

function item(id: string, title: string): InboxItem {
  return {
    id,
    agentId: AGENT,
    key: title,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    thread: [
      {
        id: `e${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Approve or decline.",
        ask: {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Approve" }, { label: "Decline" }],
          status: INBOX_ASK_STATUS.OPEN,
        },
        createdAt: 1_000,
      },
    ],
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
  };
}

const EXPIRY = item("a1b2c3d4-0000-4000-8000-000000000001", "Expire after 7 days?");
const RESEND = item("a1b2c3d4-0000-4000-8000-000000000002", "Resend on bounce?");

test("a task taken up again holds no read until its follow pushes anew, and then the items posted since", async () => {
  // What the host pushes as each task is followed; nothing at all where it holds no word yet.
  const inboxes = new Map<string, CodingAgentInboxChanged["inbox"]>([
    [INVITES, { items: [EXPIRY] }],
    [BILLING, { items: [] }],
  ]);
  const main = followedInboxes((scope) => inboxes.get(scope.id));
  let control: TaskInboxControl | undefined;
  function Probe({ taskId }: { taskId: string }): null {
    control = useTaskInbox({
      taskId,
      kind: INBOX_SCOPE_KIND.PLAN,
      shown: true,
      waiting: true,
      readerId: undefined,
      agents: {
        heldIds: [AGENT],
        inboxFollower: main.follower,
        answerInbox: () => new Promise(() => undefined),
        messageInbox: () => new Promise(() => undefined),
        readInboxImage: () => new Promise(() => undefined),
        onRetryList: () => undefined,
      },
    });
    return null;
  }
  const registry = AtomRegistry.make();
  const mounted = createRoot(document.body.appendChild(document.createElement("div")));
  root = mounted;
  const show = async (taskId: string) => {
    await act(async () => mounted.render(onRegistry(registry, createElement(Probe, { taskId }))));
    await settle();
    return control ?? assert.fail("the inbox is held");
  };

  const first = await show(INVITES);
  assert.equal(first.read, true);
  assert.deepEqual(
    first.board.open.map(({ id }) => id),
    [EXPIRY.id],
  );
  await show(BILLING);

  // The agent posts a second item while another task is open, which the host has not pushed yet.
  inboxes.delete(INVITES);
  const again = await show(INVITES);
  assert.equal(again.read, false, "the push held from before its follow is not its read");
  assert.equal(again.board.open.length, 0);

  act(() => main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: INVITES }, { items: [EXPIRY, RESEND] }));
  await settle();
  const pushed = control ?? assert.fail("the inbox is held");
  assert.equal(pushed.read, true);
  assert.deepEqual(
    pushed.board.open.map(({ id }) => id).toSorted(),
    [EXPIRY.id, RESEND.id].toSorted(),
  );
});
