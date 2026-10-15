// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { LinearIssuePicker } from "./linear-issue-picker";

/**
 * linear-issue-picker.test.ts -- New plan's Linear picker lists the
 * workspace's issues by title with their key and state, a pick starts the
 * plan from that issue with no dialog in between, a refused start says why
 * where the issues stood, and Blank task hands back to the dialog.
 */

const ISSUES: readonly LinearIssueSummary[] = [
  {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Start a plan from Linear",
    url: "https://linear.app/acme/issue/ENG-1",
    state: "In Progress",
  },
  {
    id: "issue-2",
    identifier: "OPS-7",
    title: "Rotate the deploy key",
    url: "https://linear.app/acme/issue/OPS-7",
  },
];

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets the picker's read and a start's answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The picker open over the issues, answering a start as `answer` says, with every hand-back recorded. */
async function mount(answer: string | undefined) {
  const started: string[] = [];
  const pressed = { blank: 0, closed: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(LinearIssuePicker, {
        open: true,
        read: () => Promise.resolve(ISSUES),
        start: (issue) => {
          started.push(issue.id);
          return Promise.resolve(answer);
        },
        onBlankPlan: () => {
          pressed.blank += 1;
        },
        onClose: () => {
          pressed.closed += 1;
        },
        onLeave: () => undefined,
      }),
    ),
  );
  await settle();
  return { container, started, pressed };
}

/** Every row's words, as the list draws them: the title, then the key and state. */
function rowWords(container: HTMLElement): string[][] {
  return [...container.querySelectorAll('[role="option"]')].map((row) => [
    row.querySelector(".plan-compose-menu-name")?.textContent ?? "",
    row.querySelector(".plan-compose-menu-detail")?.textContent ?? "",
  ]);
}

/** The row or pinned row whose name reads `name`, pressed. */
async function press(container: HTMLElement, name: string): Promise<void> {
  const row =
    [...container.querySelectorAll<HTMLElement>('[role="option"], button')].find(
      (each) => each.querySelector(".plan-compose-menu-name")?.textContent === name,
    ) ?? assert.fail(`no row named ${name}`);
  act(() => row.click());
  await settle();
}

test("the picker lists the workspace's issues by title, each with its key and the state it stands in", async () => {
  const { container } = await mount(undefined);

  assert.deepEqual(rowWords(container), [
    ["Start a plan from Linear", "ENG-1 · In Progress"],
    ["Rotate the deploy key", "OPS-7"],
  ]);
});

test("picking an issue starts its plan at once and closes the picker", async () => {
  const { container, started, pressed } = await mount(undefined);

  await press(container, "Rotate the deploy key");

  assert.deepEqual(started, ["issue-2"]);
  assert.equal(pressed.closed, 1);
});

test("a start that was refused says why where the issues stood, the picker stays open, and Retry lists the issues again", async () => {
  const refusal = "Linear is not connected to this workspace.";
  const { container, pressed } = await mount(refusal);

  await press(container, "Start a plan from Linear");
  const said = container.querySelector('[role="alert"]')?.textContent;

  const refused = rowWords(container);
  await press(container, "Retry");

  assert.equal(said, refusal);
  assert.equal(pressed.closed, 0);
  assert.deepEqual(refused, []);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.equal(rowWords(container).length, ISSUES.length);
});

test("Blank task hands back to the New plan dialog and starts nothing", async () => {
  const { container, started, pressed } = await mount(undefined);

  await press(container, "Blank task");

  assert.equal(pressed.blank, 1);
  assert.deepEqual(started, []);
});
