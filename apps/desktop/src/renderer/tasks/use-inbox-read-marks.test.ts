// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { useSettledItems } from "@luke/panel/tasks/inbox-settling";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { isUnread } from "./inbox-model";
import { type InboxReadMarks, useInboxReadMarks } from "./use-inbox-read-marks";

/**
 * use-inbox-read-marks.test.ts -- the Inbox's read marks flip a dot at once
 * and stand only until the reads hold the item as the mark left it, so a
 * later read, another window's mark among them, is what the row draws; the
 * marks reach the service one at a time in the order they were made, an
 * item's latest standing for its own still waiting; and every item marked
 * read asks the reads again once the service took it. Synthetic plan and
 * items.
 */

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-acme",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

/** An item of the plan's, open and asking words, read or unread as given. */
function item(id: string, unread: boolean): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: "Alert at 80%?",
    blocks: [],
    response: { type: INBOX_RESPONSE.TEXT },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    unread,
  };
}

const X = "a1b2c3d4-0000-4000-8000-000000000001";
const Y = "a1b2c3d4-0000-4000-8000-000000000002";

/** One write the hook sent, and how to answer it. */
interface Sent {
  readonly words: string;
  readonly answer: (failed?: boolean) => Promise<void>;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** The hook over the reads given, every write it sends held until the test answers it; and how to give it newer reads. */
function marks(first: readonly InboxItem[]) {
  const sent: Sent[] = [];
  let rereads = 0;
  fakeAppBridge({
    act: (request: Act) =>
      new Promise<ActOutcome>((resolve) => {
        const words =
          request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_ALL
            ? `all:${request.payload.workspaceId}`
            : request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
              ? `${request.payload.unread ? "unread" : "read"}:${request.payload.itemId}`
              : request.kind;
        sent.push({
          words,
          answer: async (failed = false) => {
            const value = failed
              ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
              : request.kind === ACT_KIND.CODING_AGENTS_INBOX_READ_STATE
                ? { id: request.payload.itemId, unread: request.payload.unread }
                : { marked: 1 };
            await act(async () => {
              resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
              for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
            });
          },
        });
      }),
  });
  let control: InboxReadMarks | undefined;
  let drawn: readonly InboxItem[] = [];
  // The plan's held read, as the task's own Inbox draws it, the window's marks laid over it.
  function Harness({ items }: { items: readonly InboxItem[] }) {
    const { act: send } = useAct();
    control = useInboxReadMarks({
      act: send,
      workspaceId: TASK.workspaceId,
      onMarkedAll: () => {
        rereads += 1;
      },
    });
    drawn = useSettledItems(items);
    return null;
  }
  root = createRoot(document.createElement("div"));
  const registry = AtomRegistry.make();
  const read = (items: readonly InboxItem[]) =>
    act(() => root?.render(onRegistry(registry, createElement(Harness, { items }))));
  read(first);
  const held = () => control ?? assert.fail("the hook stands");
  return {
    sent,
    read,
    rereads: () => rereads,
    /** Each item's dot as the hook draws it. */
    dots: () => drawn.map((each) => [each.id, isUnread(each)]),
    mark: (target: InboxItem, unread: boolean) => act(() => held().onMark(target, unread)),
    markAll: (items: readonly InboxItem[]) => act(() => held().onMarkAll(items)),
  };
}

/** Lets the writes queued so far reach the act. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("a mark flips the dot at once and stands over reads that have not caught up; once a read holds the item as it left it, a later read, another window's mark, is what is drawn", async () => {
  const hook = marks([item(X, false)]);
  hook.mark(item(X, false), true);
  await settle();
  assert.deepEqual(hook.dots(), [[X, true]]);
  // A read from before the mark landed still says read; the mark stands over it.
  hook.read([item(X, false)]);
  assert.deepEqual(hook.dots(), [[X, true]]);
  await hook.sent[0]?.answer();
  hook.read([item(X, true)]);
  assert.deepEqual(hook.dots(), [[X, true]]);
  // Another window marks it read; the reads say so, and the row follows.
  hook.read([item(X, false)]);
  assert.deepEqual(hook.dots(), [[X, false]]);
});

test("marks reach the service one at a time in the order they were made, an item's latest standing for its own still waiting, and Mark all as read waits its turn too", async () => {
  const hook = marks([item(X, false), item(Y, true)]);
  hook.mark(item(X, false), true);
  hook.mark(item(X, true), false);
  hook.mark(item(X, false), true);
  hook.markAll([item(X, true), item(Y, true)]);
  await settle();
  assert.deepEqual(
    hook.sent.map((each) => each.words),
    [`unread:${X}`],
    "one write is out at a time",
  );
  await hook.sent[0]?.answer();
  await settle();
  assert.deepEqual(
    hook.sent.map((each) => each.words),
    [`unread:${X}`, "all:workspace-acme"],
    "X's later marks stood for one another, the last already sent, so Mark all as read went next",
  );
  assert.equal(hook.rereads(), 0);
  await hook.sent[1]?.answer();
  assert.equal(hook.rereads(), 1, "every item marked read asks the reads again once taken");
});

test("a mark the service refused is let go, and Mark all as read refused asks nothing again", async () => {
  const hook = marks([item(X, false), item(Y, true)]);
  hook.mark(item(X, false), true);
  await settle();
  await hook.sent[0]?.answer(true);
  assert.deepEqual(hook.dots(), [
    [X, false],
    [Y, true],
  ]);
  hook.markAll([item(X, false), item(Y, true)]);
  await settle();
  assert.deepEqual(hook.dots(), [
    [X, false],
    [Y, false],
  ]);
  await hook.sent[1]?.answer(true);
  assert.deepEqual(hook.dots(), [
    [X, false],
    [Y, true],
  ]);
  assert.equal(hook.rereads(), 0);
});

test("two opposite marks out at once stand as the latest made, though the held read lands the earlier one's write before the later one goes", async () => {
  const hook = marks([item(X, false)]);
  hook.mark(item(X, false), true);
  await settle();
  hook.mark(item(X, true), false);
  // The held read lands as it stood before either write, then as the first write left it.
  hook.read([item(X, false)]);
  assert.deepEqual(hook.dots(), [[X, false]]);
  await hook.sent[0]?.answer();
  hook.read([item(X, true)]);
  assert.deepEqual(hook.dots(), [[X, false]], "the later mark stands over the earlier one's word");
  await settle();
  await hook.sent[1]?.answer();
  hook.read([item(X, false)]);
  assert.deepEqual(hook.dots(), [[X, false]]);
});
