// @vitest-environment jsdom

import assert from "node:assert/strict";
import { INBOX_STATUS, INBOX_WIRE_VERSION, type InboxItem } from "@repo/features/inbox-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { ThreadsDock } from "./threads-dock.js";

/**
 * threads-dock.test.ts -- the line over an agent's box names the one thread
 * waiting on the developer, or how many wait and the next of them, and
 * opens the next one, the oldest posted. Synthetic items.
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

/** The dock drawn over the threads given, its words, and what its press opened. */
function dock(threads: readonly InboxItem[]) {
  const opened: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ThreadsDock, {
        threads: { waiting: threads, onOpen: (item) => opened.push(item.title) },
      }),
    ),
  );
  const row = container.querySelector<HTMLElement>('[role="button"], button');
  return { words: container.textContent, row, opened };
}

test("the dock names the one thread waiting, or how many and the next, and opens the oldest", () => {
  const one = dock([waiting(1, "Expire after 7 days?")]);
  assert.equal(one.words, "Expire after 7 days?Needs you");

  const many = dock([waiting(1, "Expire after 7 days?"), waiting(2, "Who can withdraw?")]);
  assert.equal(many.words, "2 threads need youExpire after 7 days?");
  const { row } = many;
  assert.ok(row, "the dock presses");
  act(() => row.click());
  assert.deepEqual(many.opened, ["Expire after 7 days?"]);

  assert.equal(dock([]).words, "", "nothing waits, so nothing is docked");
});
