// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAct } from "../act.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { type InboxReadMarks, type MarkSaying, useInboxReadMarks } from "./use-inbox-read-marks.js";

/**
 * use-inbox-read-marks.test.ts -- the Inbox's read marks say a refusal
 * once, unless the caller says it itself, and Mark all as read names the
 * unread items it marks, which the host draws read. Synthetic plan and
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
    needsReply: true,
    thread: [
      {
        id: `e${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Alert at 80%, or later?",
        ask: { type: INBOX_ASK.ANSWER, status: INBOX_ASK_STATUS.OPEN },
        createdAt: 1_000,
      },
    ],
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

/** The hook, every write it sends held until the test answers it. */
function marks() {
  const sent: Sent[] = [];
  /** One write held until the test answers it, with the value it answers when it does not fail. */
  const sending = <Value>(words: string, value: Value) =>
    new Promise<Value | { failure: typeof CODING_AGENT_CALL_FAILURE.NOT_FOUND }>((resolve) => {
      sent.push({
        words,
        answer: async (failed = false) => {
          await act(async () => {
            resolve(failed ? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND } : value);
            for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
          });
        },
      });
    });
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_INBOX_READ_ALL]: ({ workspaceId, itemIds }) =>
      sending(`all:${workspaceId}:${itemIds.join(",")}`, { marked: 1 }),
    [ACT_KIND.CODING_AGENTS_INBOX_READ_STATE]: ({ itemId, unread }) =>
      sending(`${unread ? "unread" : "read"}:${itemId}`, { id: itemId, unread }),
  });
  let control: InboxReadMarks | undefined;
  function Harness() {
    const { act: send } = useAct();
    control = useInboxReadMarks({
      act: send,
      workspaceId: TASK.workspaceId,
    });
    return createElement(Fragment, null, createElement(ToastHost));
  }
  root = createRoot(document.createElement("div"));
  const registry = AtomRegistry.make();
  act(() => root?.render(onRegistry(registry, createElement(Harness))));
  const held = () => control ?? assert.fail("the hook stands");
  return {
    sent,
    /** The hook's presses as it stands. */
    get marks() {
      return held();
    },
    mark: (target: InboxItem, unread: boolean, saying?: MarkSaying) =>
      act(() => {
        void held().onMark(target, unread, saying);
      }),
    /** What each toast standing says, leaving out those on their way out. */
    toasts: () =>
      [...document.querySelectorAll(".luke-toast:not([data-leaving]) .luke-toast-words")].map(
        (words) => words.textContent ?? "",
      ),
    markAll: (items: readonly InboxItem[]) => act(() => held().onMarkAll(items)),
  };
}

/** Lets the writes queued so far reach the act. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("a mark the service refused says so once, and Mark all as read names the unread items it marks and counts them refused", async () => {
  const hook = marks();
  hook.mark(item(X, false), true);
  await settle();
  await hook.sent[0]?.answer(true);
  assert.deepEqual(hook.toasts(), ["Could not mark 1 item unread"]);
  hook.markAll([item(X, false), item(Y, true)]);
  await settle();
  assert.deepEqual(
    hook.sent.map((each) => each.words),
    [`unread:${X}`, `all:${TASK.workspaceId}:${Y}`],
  );
  await hook.sent[1]?.answer(true);
  assert.deepEqual(hook.toasts(), ["Could not mark 1 item unread", "Could not mark 1 item read"]);
});

test("a refused mark from a caller that says the refusal itself toasts nothing, and still answers false", async () => {
  const hook = marks();
  let answered: boolean | undefined;
  act(() => {
    void hook.marks.onMark(item(X, false), true, { quiet: true }).then((kept) => {
      answered = kept;
    });
  });
  await settle();
  await hook.sent[0]?.answer(true);
  assert.equal(answered, false);
  assert.deepEqual(hook.toasts(), []);
});
