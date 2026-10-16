// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PublishedChip, type PublishedDoors } from "./agent-published";

/**
 * agent-published.test.ts -- the pull request's chip at an agent box's foot
 * opens the agent's Pull request tab where a side panel takes it, and the
 * pull request on GitHub where none does; where the press opened the tab,
 * its right-click offers GitHub's page instead. Synthetic ids.
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

/** Draws the chip over the doors given, and what each door was asked. */
function drawChip(withPanel: boolean) {
  const asked: string[] = [];
  const doors: PublishedDoors = {
    openGitHub: (url) => asked.push(`github ${url}`),
    copy: () => undefined,
    openPullRequest: withPanel ? () => asked.push("tab") : undefined,
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(PublishedChip, { published: PUBLISHED, doors })));
  const chip =
    container.querySelector<HTMLButtonElement>(".agent-published-chip") ??
    assert.fail("the pull request's chip stands");
  return { chip, asked };
}

test("the pull request's chip opens its Pull request tab where a panel takes it, and its right-click offers the page on GitHub", () => {
  const { chip, asked } = drawChip(true);
  act(() => chip.click());
  assert.deepEqual(asked, ["tab"]);

  act(() => {
    chip.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const github =
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Open on GitHub",
    ) ?? assert.fail("the right-click offers GitHub's page");
  act(() => github.click());
  assert.deepEqual(asked, ["tab", `github ${URL}`]);
});

test("where no panel takes the tab, the pull request's chip opens it on GitHub", () => {
  const { chip, asked } = drawChip(false);
  act(() => chip.click());
  assert.deepEqual(asked, [`github ${URL}`]);
});
