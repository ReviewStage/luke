// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ThreadsDock } from "./threads-dock.js";

/**
 * threads-dock.test.ts -- the line over an agent's box counts the threads
 * waiting on the developer, and opens the next one, the oldest posted; once none waits it stays, quiet,
 * counting every thread, and opens the latest changed. Synthetic items.
 */

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A thread the agent posted that waits on the developer. */
function waiting(n: number, title: string): InboxItem {
  return {
    id: `6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4${n}`,
    agentId: AGENT,
    key: `000${n}`,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: n,
    updatedAt: n,
  };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The dock drawn over the threads given, those waiting and every one posted, the latest changed first; its words, and what its press opened. */
function dock(threads: readonly InboxItem[], posted: readonly InboxItem[] = threads) {
  const opened: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ThreadsDock, {
        threads: { waiting: threads, posted, onOpen: (item) => opened.push(item.title) },
      }),
    ),
  );
  const row = container.querySelector<HTMLElement>('[role="button"], button');
  const press = () => {
    assert.ok(row, "the dock presses");
    act(() => row.click());
  };
  return { words: container.textContent, press, opened };
}

test("the dock counts the threads waiting, and opens the oldest", () => {
  const one = dock([waiting(1, "Expire after 7 days?")]);
  assert.equal(one.words, "Inbox1 needs you");

  const many = dock([waiting(1, "Expire after 7 days?"), waiting(2, "Who can withdraw?")]);
  assert.equal(many.words, "Inbox2 need you");
  many.press();
  assert.deepEqual(many.opened, ["Expire after 7 days?"]);

  assert.equal(dock([]).words, "", "the agent posted nothing, so nothing is docked");
});

test("once none waits, the dock stays quiet, counting every thread the agent posted, and opens the latest changed", () => {
  const settled = dock([], [waiting(2, "Who can withdraw?"), waiting(1, "Expire after 7 days?")]);
  assert.equal(settled.words, "2 threads");
  settled.press();
  assert.deepEqual(settled.opened, ["Who can withdraw?"]);
});
