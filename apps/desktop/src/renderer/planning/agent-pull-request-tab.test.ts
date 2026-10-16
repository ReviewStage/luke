// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CHECK_STATE,
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  CONVERSATION_ENTRY,
  type CodingAgentOverview,
  type CodingAgentSummary,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  type PullRequestState,
  REVIEW_STATE,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "@luke/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl } from "#testing/plans-control";
import { MemberDirectory } from "../member-directory";
import { AgentPullRequestTab } from "./agent-pull-request-tab";
import type { CodingAgentsControl } from "./use-coding-agents";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel";

/**
 * agent-pull-request-tab.test.ts -- an agent's Pull request tab draws its
 * pull request as a page: where it stands and its branches on the bar,
 * whether it would merge, its checks with what failed first, its
 * description as markdown, and its comments and reviews in time order, a
 * long one sending the reader to GitHub for the rest; it opens the agent's
 * Changes from its bar, says so where there is no pull request yet, and
 * offers a retry where the read failed. Synthetic people throughout.
 */

const CHARLES: WorkspaceMember = {
  userId: "user-charles",
  name: "Charles Pan",
  email: "charles@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PAGE = "https://github.com/acme/relay/pull/42";
const CHARLES_ON_GITHUB = { login: "charlespan", bot: false, userId: CHARLES.userId };

/** A check as the overview lists one. */
function check(name: string, state: (typeof CHECK_STATE)[keyof typeof CHECK_STATE]) {
  return {
    name,
    app: "GitHub Actions",
    state,
    url: `https://github.com/acme/relay/runs/${name}`,
    startedAt: 1_000,
    completedAt: state === CHECK_STATE.PENDING ? null : 66_000,
  };
}

const OVERVIEW: CodingAgentOverview = {
  number: 42,
  title: "Expire invitations",
  url: PAGE,
  state: PULL_REQUEST_STATE.OPEN,
  body: "Expires invitations after **seven days**.",
  base: "main",
  head: "luke/expiry-job",
  createdAt: 1_000,
  mergedAt: null,
  merge: MERGE_STATE.CONFLICTS,
  checks: [
    check("test", CHECK_STATE.PASSED),
    check("lint", CHECK_STATE.FAILED),
    check("build", CHECK_STATE.PENDING),
  ],
  author: { login: "luke[bot]", bot: true, luke: true },
  reviewers: [{ by: CHARLES_ON_GITHUB, state: REVIEW_STATE.CHANGES_REQUESTED }],
  conversation: [
    {
      kind: CONVERSATION_ENTRY.REVIEW,
      by: CHARLES_ON_GITHUB,
      state: REVIEW_STATE.CHANGES_REQUESTED,
      body: "Rename the flag.",
      cut: false,
      at: 2_000,
      url: `${PAGE}#pullrequestreview-1`,
    },
    {
      kind: CONVERSATION_ENTRY.COMMENT,
      by: CHARLES_ON_GITHUB,
      body: "Also, a very long note",
      cut: true,
      at: 3_000,
      url: `${PAGE}#issuecomment-2`,
    },
  ],
};

let root: Root | undefined;
let opened: string[] = [];

beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  opened = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: (request: Act) => {
        if (request.kind === ACT_KIND.GITHUB_OPEN) opened.push(request.payload.url);
        return Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: [CHARLES] }
            : { status: ACT_OUTCOME_STATUS.DONE, value: undefined },
        );
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The pull request as what the agent published names it, which the tab's bar wears. */
function published(state: PullRequestState) {
  return {
    number: OVERVIEW.number,
    title: OVERVIEW.title,
    url: PAGE,
    state,
    checks: CHECK_SUMMARY.FAILING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
  };
}

/** The plan's agents, the one whose pull request it is among them, its reads answering as given. */
function controlAnswering(
  read: CodingAgentsControl["readOverview"],
  state: PullRequestState = PULL_REQUEST_STATE.OPEN,
  readChanges: CodingAgentsControl["readChanges"] = () =>
    Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } }),
): CodingAgentsControl {
  return codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, published(state)]]),
    readOverview: read,
    readChanges,
  });
}

/** The tab, holding the view its switch chooses as the side panel does. */
function Switching({ control }: { control: CodingAgentsControl }) {
  const [view, setView] = useState<PullRequestView>(PULL_REQUEST_VIEW.OVERVIEW);
  return createElement(AgentPullRequestTab, {
    agentId: AGENT.id,
    control,
    shown: true,
    repository: "acme/relay",
    tree: { open: false, onToggle: () => undefined },
    view,
    onView: setView,
  });
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Draws the agent's tab inside the workspace's member directory, its reads landed. */
async function draw(control: CodingAgentsControl) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(MemberDirectory, {
          workspace: { id: "workspace-acme", memberCount: 2 },
          readerId: "user-dana",
          children: createElement(Switching, { control }),
        }),
      ),
    ),
  );
  await settle();
  return container;
}

/** The switch's option of the words given. */
function option(tab: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...tab.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (each) => each.textContent === words,
    ) ?? assert.fail(`the switch offers ${words}`)
  );
}

/** The words of every element the selector names, in order. */
function words(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((each) => each.textContent ?? "");
}

test("the tab draws the pull request as a page: its standing and branches, whether it merges, its checks with failures first, its description, and its conversation in time order", async () => {
  const tab = await draw(controlAnswering(() => Promise.resolve({ pullRequest: OVERVIEW })));

  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Open");
  assert.equal(tab.querySelector(".pull-request-branches")?.textContent, "main ← luke/expiry-job");
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
  assert.equal(
    tab.querySelector(".pull-request-merge")?.textContent,
    "Conflicts with main",
    "an open pull request says whether it would merge",
  );
  assert.equal(
    tab.querySelector(".pull-request-merge")?.getAttribute("data-merge-tone"),
    "blocked",
  );

  const checks = tab.querySelector('[aria-label="Checks"]') ?? assert.fail("the checks stand");
  assert.equal(
    checks.querySelector(".pull-request-count")?.textContent,
    "1 failed, 1 running, 1 passed",
  );
  assert.deepEqual(words(tab, ".pull-request-check-name"), ["lint", "build", "test"]);
  assert.deepEqual(words(tab, ".pull-request-check-time"), ["1m 5s", "1m 5s"]);

  const description =
    tab.querySelector('[aria-label="Description"]') ?? assert.fail("the description stands");
  assert.equal(description.querySelector('[data-streamdown="strong"]')?.textContent, "seven days");

  const entries = [...tab.querySelectorAll(".pull-request-entry")];
  assert.equal(entries.length, 2);
  assert.match(entries[0]?.textContent ?? "", /Changes requested/u);
  assert.match(entries[0]?.textContent ?? "", /Rename the flag\./u);
  const more =
    entries[1]?.querySelector<HTMLButtonElement>(".pull-request-more") ??
    assert.fail("a cut comment sends the reader to GitHub");
  await act(async () => more.click());
  assert.deepEqual(opened, [`${PAGE}#issuecomment-2`]);
});

test("the switch shows the files, read only once shown, and back on the overview draws it as it was, reading neither again", async () => {
  let overviews = 0;
  let files = 0;
  const tab = await draw(
    controlAnswering(
      () => {
        overviews += 1;
        return Promise.resolve({ pullRequest: OVERVIEW });
      },
      PULL_REQUEST_STATE.OPEN,
      () => {
        files += 1;
        return Promise.resolve({ pullRequest: { url: PAGE, truncated: false, files: [] } });
      },
    ),
  );
  const [overview, changed] = [...tab.querySelectorAll<HTMLElement>(".pull-request-view")];
  assert.equal(option(tab, "Overview").getAttribute("aria-checked"), "true");
  assert.deepEqual([overviews, files], [1, 0], "the files are not read before they are shown");
  assert.equal(changed?.hidden, true);

  act(() => option(tab, "Files changed").click());
  await settle();
  assert.deepEqual([overviews, files], [1, 1]);
  assert.equal(overview?.hidden, true);
  assert.equal(changed?.hidden, false);
  assert.match(changed?.textContent ?? "", /This pull request changes no files\./u);

  act(() => option(tab, "Overview").click());
  await settle();
  assert.deepEqual([overviews, files], [1, 1], "switching back reads nothing again");
  assert.equal(overview?.hidden, false);
  assert.equal(tab.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
});

test("a merged pull request says nothing of merging, and one with no description, checks, or comments says so", async () => {
  const merged: CodingAgentOverview = {
    ...OVERVIEW,
    state: PULL_REQUEST_STATE.MERGED,
    mergedAt: 9_000,
    body: "",
    checks: [],
    conversation: [],
  };
  const tab = await draw(
    controlAnswering(() => Promise.resolve({ pullRequest: merged }), PULL_REQUEST_STATE.MERGED),
  );
  assert.equal(tab.querySelector(".pull-request-state")?.textContent, "Merged");
  assert.equal(tab.querySelector(".pull-request-merge"), null);
  assert.deepEqual(words(tab, ".pull-request-none"), [
    "No checks have run on this pull request.",
    "No description provided.",
    "Nobody has commented yet.",
  ]);
});

test("an agent with no pull request yet says so, and a read that failed offers a retry that reads again", async () => {
  const none = await draw(controlAnswering(() => Promise.resolve({ pullRequest: null })));
  assert.match(none.textContent ?? "", /No pull request yet\./u);
  act(() => root?.unmount());
  root = undefined;

  let reads = 0;
  const failing = await draw(
    controlAnswering(() => {
      reads += 1;
      return Promise.resolve(
        reads === 1
          ? { failure: CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED }
          : { pullRequest: OVERVIEW },
      );
    }),
  );
  assert.match(failing.textContent ?? "", /The pull request could not be read\./u);
  const retry =
    [...failing.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the failure offers a retry");
  await act(async () => {
    retry.click();
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.equal(reads, 2);
  assert.equal(failing.querySelector(".pull-request-title")?.textContent, "Expire invitations #42");
});
