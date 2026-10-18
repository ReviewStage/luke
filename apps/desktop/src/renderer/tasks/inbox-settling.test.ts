// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { AppInboxTask } from "@luke/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import {
  type InboxSettler,
  useInboxSettler,
  useSettledItems,
  useSettledWaiting,
} from "./inbox-settling";

/**
 * inbox-settling.test.ts -- an answer the window sent stands over main's
 * read of what waits from the moment it is sent, so the sidebar's count
 * drops at once, until main no longer lists the item, and over every read
 * until one holds the item changed since; it comes back where the service
 * refused it.
 */

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

const ASKED: InboxItem = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  key: "0001",
  revision: 1,
  version: INBOX_WIRE_VERSION,
  title: "Alert at 80%?",
  blocks: [],
  response: { type: INBOX_RESPONSE.TEXT },
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_000,
  updatedAt: 1_000,
};

const OTHER: InboxItem = { ...ASKED, id: "a1b2c3d4-0000-4000-8000-000000000002", key: "0002" };

const waitingOn = (...items: readonly InboxItem[]): readonly AppInboxTask[] => [
  {
    taskId: "plan-billing",
    items: items.map(({ id, agentId, title, postedAt }) => ({ id, agentId, title, postedAt })),
  },
];

/** The count main's read says waits, settled, and one read's items as drawn, with the presses that answer. */
interface Probe {
  count: number;
  drawn: readonly InboxItem[];
  settler: InboxSettler | undefined;
}

/** The probe, and how the test draws it again over what main and the read say. */
interface Mounted {
  readonly probe: Probe;
  readonly render: (waiting: readonly AppInboxTask[], read: readonly InboxItem[]) => void;
}

function mount(): Mounted {
  const probe: Probe = { count: 0, drawn: [], settler: undefined };
  const registry = AtomRegistry.make();
  function Page({
    waiting,
    read,
  }: {
    waiting: readonly AppInboxTask[];
    read: readonly InboxItem[];
  }) {
    const settled = useSettledWaiting(waiting, []);
    probe.count = settled.waiting.reduce((sum, task) => sum + task.items.length, 0);
    probe.drawn = useSettledItems(read);
    probe.settler = useInboxSettler();
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = (waiting: readonly AppInboxTask[], read: readonly InboxItem[]) =>
    act(() => root?.render(onRegistry(registry, createElement(Page, { waiting, read }))));
  return { probe, render };
}

const NOTE = { reply: INBOX_REPLY.ANSWERED, note: "Use 90%" } as const;

test("an answer drops its item from main's count the moment it is sent, until main no longer lists it, and a read asked before it that lands after every read caught up never brings it back", () => {
  const { probe, render } = mount();
  render(waitingOn(ASKED, OTHER), [ASKED, OTHER]);
  assert.equal(probe.count, 2);

  let sent: symbol | undefined;
  act(() => {
    sent = probe.settler?.answer(ASKED, NOTE);
  });
  assert.equal(probe.count, 1);
  assert.equal(probe.drawn.find((each) => each.id === ASKED.id)?.status, INBOX_STATUS.ANSWERED);

  const answered = { ...ASKED, status: INBOX_STATUS.ANSWERED, answer: NOTE, updatedAt: 2_000 };
  act(() => {
    if (sent !== undefined) probe.settler?.take(sent, answered);
  });
  // The read holds the answer, while main still lists the item.
  render(waitingOn(ASKED, OTHER), [answered, OTHER]);
  assert.equal(probe.count, 1, "main has not caught up, and its word brings nothing back");

  // Main catches up, and every read holds the answer.
  render(waitingOn(OTHER), [answered, OTHER]);
  assert.equal(probe.count, 1);
  // A read asked before the answer lands last, holding the item open as it stood.
  render(waitingOn(OTHER), [ASKED, OTHER]);
  assert.equal(probe.drawn.find((each) => each.id === ASKED.id)?.status, INBOX_STATUS.ANSWERED);
  assert.equal(probe.count, 1);
  // Main, once seen without the item, is trusted again: an item it lists after is one asked again.
  render(waitingOn(ASKED, OTHER), [answered, OTHER]);
  assert.equal(probe.count, 2, "main's word stands once it caught up");
});

test("an answer the service refused brings its item back into main's count and the reads", () => {
  const { probe, render } = mount();
  render(waitingOn(ASKED), [ASKED]);
  let sent: symbol | undefined;
  act(() => {
    sent = probe.settler?.answer(ASKED, NOTE);
  });
  assert.equal(probe.count, 0);
  act(() => {
    if (sent !== undefined) probe.settler?.refuse(sent);
  });
  assert.equal(probe.count, 1);
  assert.equal(probe.drawn[0]?.status, INBOX_STATUS.OPEN);
});

test("a read holding the item at a newer revision, the agent having posted it again, wins over an answer laid over it, and main's count with it", () => {
  const { probe, render } = mount();
  render(waitingOn(ASKED), [ASKED]);
  act(() => {
    probe.settler?.answer(ASKED, NOTE);
  });
  assert.equal(probe.count, 0);
  const again = { ...ASKED, revision: 2, title: "Alert at 85%?", updatedAt: 3_000 };
  render(waitingOn(again), [again]);
  assert.equal(probe.drawn[0]?.title, "Alert at 85%?");
  assert.equal(probe.drawn[0]?.status, INBOX_STATUS.OPEN);
  assert.equal(probe.count, 1);
});

test("a message the service took stands over a read that lacks it, though the read changed in the same millisecond, until a read holds the message", () => {
  const { probe, render } = mount();
  const answered = { ...ASKED, status: INBOX_STATUS.ANSWERED, answer: NOTE };
  const message = {
    id: "c1b2c3d4-0000-4000-8000-000000000001",
    author: INBOX_MESSAGE_AUTHOR.MEMBER,
    text: "Page on-call at night too.",
    createdAt: answered.updatedAt,
  };
  const written = { ...answered, messages: [message] };
  render([], [answered]);
  act(() => probe.settler?.message(written));
  assert.deepEqual(probe.drawn[0]?.messages, [message]);
  render([], [{ ...written, unread: false }]);
  assert.equal(probe.drawn[0]?.unread, false, "a read holding the message is drawn as it holds it");
});

test("the window keeps only its latest answers: the oldest taken gives way once more were sent, and its read is drawn as it holds it", () => {
  const { probe, render } = mount();
  const items = Array.from({ length: 201 }, (_, at) => ({
    ...ASKED,
    id: `a1b2c3d4-0000-4000-8000-${String(at).padStart(12, "0")}`,
  }));
  render([], items);
  act(() => {
    for (const each of items) {
      const sent = probe.settler?.answer(each, NOTE);
      const taken = { ...each, status: INBOX_STATUS.ANSWERED, answer: NOTE, updatedAt: 2_000 };
      if (sent !== undefined) probe.settler?.take(sent, taken);
    }
  });
  render([], items);
  assert.equal(probe.drawn[0]?.status, INBOX_STATUS.OPEN, "the oldest answer was let go");
  assert.equal(probe.drawn[200]?.status, INBOX_STATUS.ANSWERED);
});
