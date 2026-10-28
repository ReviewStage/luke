// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { InboxCodeBlock } from "@luke/features/inbox-wire";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { InboxCodeCard } from "./inbox-code-card.js";

/**
 * file-ref.test.ts -- a file named in place, as the head of an Inbox item's
 * code card names it: its path and its lines, hanging the file's card naming
 * the repository the lines are read from, and a press opening the file on
 * those lines at the item's commit.
 */

const PATH = "src/invites/accept.ts";

/** Lines 3–5 of the file at a commit of another repository than the task's, as an Inbox item names them. */
const BLOCK: InboxCodeBlock = {
  type: "code",
  repo: "acme/relay",
  path: PATH,
  sha: "0123456789abcdef0123456789abcdef01234567",
  startLine: 3,
  endLine: 5,
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The item's code card, its lines still being read, each file opened recorded. */
function mount(opened: unknown[][]): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const card = createElement(InboxCodeCard, {
    block: BLOCK,
    code: {
      repository: BLOCK.repo,
      readFile: () => new Promise<TasksFileAnswer>(() => undefined),
      onOpenFile: (...asked) => opened.push(asked),
    },
  });
  act(() => root.render(onRegistry(AtomRegistry.make(), card)));
  return container;
}

test("a code card's head says its lines as Lines 3–5, hangs the file's card naming its repository, and a press on it opens the file on those lines at the item's commit", () => {
  const opened: unknown[][] = [];
  const head = mount(opened).querySelector<HTMLButtonElement>(
    ".luke-code-card button[data-file-ref]",
  );
  assert.ok(head, "the code card's head opens the file");
  assert.equal(head.textContent, `${PATH}Lines 3–5`);

  restOn(head);
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, PATH);
  assert.equal(card?.querySelector(".luke-hover-card-sub")?.textContent, BLOCK.repo);

  act(() => head.click());
  assert.deepEqual(opened, [[{ path: PATH, startLine: 3, endLine: 5 }, BLOCK.sha]]);
});
