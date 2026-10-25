// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import { TASK_ISSUE_PROVIDER, TASK_ISSUE_RELATION } from "@luke/features/task-issue-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { NewTaskLinks } from "./new-task-links.js";

/**
 * new-task-links.test.ts -- the issues New task links, as its owner meets them: a GitHub issue wears the live mark of where it stands, as the task page draws it, and each chip hangs its issue's card while the pointer rests on it. Synthetic issues.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const CLOSED_ISSUE = {
  provider: TASK_ISSUE_PROVIDER.GITHUB,
  relation: TASK_ISSUE_RELATION.PART_OF,
  issue: {
    nodeId: "I_kwDOweb312",
    repository: "acme/web",
    number: 312,
    title: "Login fails on Safari 18",
    url: "https://github.com/acme/web/issues/312",
    state: ISSUE_STATE.CLOSED,
    author: "priya",
    authorAssociation: "MEMBER",
    updatedAt: 0,
  },
} as const;

function mount(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(NewTaskLinks, {
          links: [CLOSED_ISSUE],
          disabled: false,
          onChange: () => undefined,
        }),
      ),
    ),
  );
  return container;
}

test("a chip hangs its issue's card while the pointer rests on it: its title, repository key, state, who opened it, and keyword", () => {
  const container = mount();

  restOn(container.querySelector("[data-issue-chip]") ?? assert.fail("the chip"));
  const card = document.querySelector("[data-issue-card]")?.textContent ?? "";

  assert.match(card, /Login fails on Safari 18/);
  assert.match(card, /acme\/web#312 · Closed/);
  assert.match(card, /Opened by.*priya/);
  assert.match(card, /Part of: Names the issue, leaves it open/);
});
