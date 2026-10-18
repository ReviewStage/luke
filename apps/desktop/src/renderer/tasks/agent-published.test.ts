// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { BranchChip, type PublishedDoors, PublishedRow } from "./agent-published";

/**
 * agent-published.test.ts -- the pull request's row pinned over an agent's
 * box opens the agent's Pull request tab where a side panel takes it, and
 * the pull request on GitHub where none does; where the press opened the
 * tab, its right-click offers GitHub's page instead, beside the branch's
 * copies. The box's foot wears the branch's chip only while no pull
 * request stands. Synthetic ids.
 */

const URL = "https://github.com/acme/relay/pull/42";

const PUBLISHED = {
  repository: "acme/relay",
  branch: "luke/expiry-job",
  pullRequest: {
    number: 42,
    title: "Expire invitations",
    url: URL,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 3,
    deletions: 1,
    changedFiles: 2,
  },
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The doors given to what is drawn, and what each door was asked. */
function doorsAsked(withPanel: boolean) {
  const asked: string[] = [];
  const doors: PublishedDoors = {
    openGitHub: (url) => asked.push(`github ${url}`),
    copy: (words) => asked.push(`copy ${words}`),
    openPullRequest: withPanel ? () => asked.push("tab") : undefined,
  };
  return { doors, asked };
}

/** Draws `element` and answers the button it stands as. */
function drawn(element: React.ReactElement): HTMLButtonElement | null {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(element));
  return container.querySelector<HTMLButtonElement>("button");
}

/** Draws the pinned row over the doors given. */
function drawRow(withPanel: boolean) {
  const { doors, asked } = doorsAsked(withPanel);
  const row =
    drawn(
      createElement(PublishedRow, {
        pullRequest: PUBLISHED.pullRequest,
        branch: PUBLISHED.branch,
        doors,
      }),
    ) ?? assert.fail("the pull request's row stands");
  return { row, asked };
}

/** The item of the right-click's menu named `name`. */
function menuItem(name: string): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === name,
    ) ?? assert.fail(`the right-click offers ${name}`)
  );
}

/** Right-clicks `target`. */
function rightClick(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
}

test("the pull request's row opens its Pull request tab where a panel takes it, and its right-click offers the page on GitHub and the branch's name", () => {
  const { row, asked } = drawRow(true);
  act(() => row.click());
  assert.deepEqual(asked, ["tab"]);

  rightClick(row);
  act(() => menuItem("Open on GitHub").click());
  rightClick(row);
  act(() => menuItem("Copy branch name").click());
  assert.deepEqual(asked, ["tab", `github ${URL}`, "copy luke/expiry-job"]);
});

test("where no panel takes the tab, the pull request's row opens it on GitHub", () => {
  const { row, asked } = drawRow(false);
  act(() => row.click());
  assert.deepEqual(asked, [`github ${URL}`]);
});

test("the box's foot wears the branch's chip, opening the branch compared on GitHub, only while no pull request stands", () => {
  const { doors, asked } = doorsAsked(true);
  const branchOnly = { ...PUBLISHED, pullRequest: null };
  const chip =
    drawn(createElement(BranchChip, { published: branchOnly, doors })) ??
    assert.fail("the branch's chip stands");
  act(() => chip.click());
  assert.deepEqual(asked, [
    "github https://github.com/acme/relay/compare/luke/expiry-job?expand=1",
  ]);
  act(() => root?.unmount());

  assert.equal(
    drawn(createElement(BranchChip, { published: PUBLISHED, doors })),
    null,
    "a pull request's row stands over the box instead",
  );
});
