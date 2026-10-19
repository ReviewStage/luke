// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type ReadLink } from "@luke/features/luke-link";
import type { TaskSummary } from "@luke/features/task-wire";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PullRequestLine } from "../desktop/task-card.js";
import { fakeAppPlatform } from "../testing/app-platform.js";
import {
  ListedPullRequestsProvider,
  OpenLinkProvider,
  PullRequestsOnGitHub,
} from "./use-open-link.js";

/**
 * use-open-link.test.ts -- a pull request one of a listed task's agents
 * opened opens in that agent's Pull request tab on its task wherever the
 * window draws it, outside any task as much as on another; one no listed
 * task names, and any inside a pull request's own tab, open on GitHub.
 * Synthetic ids, a task card's pull request row standing for every press.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const URL = "https://github.com/acme/relay/pull/42";

const LINE = {
  number: 42,
  title: "Expire invitations",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 3,
  deletions: 1,
  url: URL,
};

const LISTED: readonly TaskSummary[] = [
  {
    id: TASK,
    workspaceId: "workspace-acme",
    name: "Teammate invitations",
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [{ ...LINE, agentId: AGENT }],
    },
  },
];

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Presses the pull request's row drawn as `wrap` holds it under the window's opener, answering where it went. */
function press(url: string, wrap: (row: ReactNode) => ReactNode = (row) => row) {
  const links: ReadLink[] = [];
  const github: string[] = [];
  fakeAppPlatform({ openGitHub: (href) => github.push(href) });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const row = createElement(
    "ul",
    null,
    createElement(PullRequestLine, { pullRequest: { ...LINE, url } }),
  );
  act(() =>
    root?.render(
      createElement(
        OpenLinkProvider,
        { value: (link: ReadLink) => links.push(link) },
        createElement(ListedPullRequestsProvider, { value: LISTED }, wrap(row)),
      ),
    ),
  );
  const button =
    container.querySelector<HTMLElement>("[data-task-card-pull-request] button") ??
    assert.fail("the row is a press");
  act(() => button.click());
  return { places: links.map((link) => link.place), github };
}

test("a listed task's agent's pull request opens in that agent's Pull request tab on its task, however its address is spelled", () => {
  assert.deepEqual(press(`${URL}#issuecomment-1`), {
    places: [{ kind: LINK_PLACE.CHANGES, planId: TASK, agentId: AGENT }],
    github: [],
  });
});

test("a pull request no listed task names opens on GitHub", () => {
  const other = "https://github.com/acme/relay/pull/7";
  assert.deepEqual(press(other), { places: [], github: [other] });
});

test("inside a pull request's own tab, a link to it opens on GitHub", () => {
  assert.deepEqual(
    press(URL, (row) => createElement(PullRequestsOnGitHub, null, row)),
    { places: [], github: [URL] },
  );
});
