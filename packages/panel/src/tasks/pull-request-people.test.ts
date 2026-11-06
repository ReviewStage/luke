// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentChangesAnswerView } from "@repo/features/agent-view";
import {
  AGENT_AUTHOR,
  AGENT_STATUS,
  type AgentChangesPeople,
  type AgentSummary,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
} from "@repo/features/agent-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@repo/features/workspace-wire";
import { Tooltip } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { tabCard } from "../desktop/tab-card.js";
import { TAB_KIND } from "../tasks/tab-look.js";
import { answeringChanges, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { handMembers } from "../testing/app-state.js";
import { ChangesTabReading } from "../testing/changes-tab.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { peopleRead, withPeopleRead } from "../testing/people-read.js";
import { agentsControl } from "../testing/tasks-control.js";
import { agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { useChangesPeople } from "./changes-people.js";
import { PullRequestCard, peopleOf } from "./pull-request-card.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * pull-request-people.test.ts -- an agent's pull request's card says who
 * its pull request names as every actor is drawn: a linked teammate as the
 * member, anyone else as themself on GitHub, a person's circle or an App's
 * bot's square, our own App's bot among them; each reviewer stands on a
 * row of its own with where they stand at its end and hangs their card,
 * every one of them listed, scrolling within the card. Its Files changed
 * view names nobody, since the Pull request tab's header above it does.
 * Synthetic people throughout.
 */

const CHARLES: WorkspaceMember = {
  userId: "user-charles",
  name: "Charles Pan",
  email: "charles@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};
const WORKSPACE = { id: "workspace-acme", memberCount: 2 };

const AGENT: AgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Expiry job",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
};

const APP_BOT = { login: "luke-agent[bot]", bot: true };
const CHARLES_ON_GITHUB = { login: "charlespan", bot: false, userId: CHARLES.userId };
const OCTOCAT = { login: "octocat", bot: false };
const DEVIN = { login: "devin-ai-integration[bot]", bot: true };

const PEOPLE: AgentChangesPeople = {
  author: APP_BOT,
  reviewers: [
    { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.APPROVED },
    { by: OCTOCAT, state: REVIEW_STATE.REQUESTED },
    { by: DEVIN, state: REVIEW_STATE.COMMENTED },
    { by: APP_BOT, state: REVIEW_STATE.COMMENTED },
  ],
  comments: [
    { by: DEVIN, state: REVIEW_STATE.COMMENTED, excerpt: "Found 1 potential issue.", at: 1_000 },
    { by: CHARLES_ON_GITHUB, state: REVIEW_STATE.APPROVED, excerpt: "Ship it.", at: 2_000 },
  ],
};

const PULL_REQUEST = {
  number: 42,
  title: "Expire invitations",
  url: "https://github.com/acme/relay/pull/42",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 4,
  deletions: 1,
  changedFiles: 1,
};

let root: Root | undefined;

beforeEach(() => {
  fakeAppBridge({});
  fakeActPort(answeringChanges(changesNaming(PEOPLE)));
  handMembers(() => ({ rows: { members: [CHARLES] } }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** Draws `element` inside the workspace's member directory, its reads landed. */
async function draw(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        withPeopleRead({ workspace: WORKSPACE, readerId: "user-dana" }, element),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  await peopleRead();
  return container;
}

/** The agent's changes as the service answers them, naming the people given. */
function changesNaming(people: AgentChangesPeople): () => Promise<AgentChangesAnswerView> {
  return () =>
    Promise.resolve({
      pullRequest: {
        url: PULL_REQUEST.url,
        truncated: false,
        files: [
          {
            path: "src/expiry.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 1,
            deletions: 0,
            omitted: null,
            patch: "@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n",
          },
        ],
        ...people,
      },
    });
}

/** The plan's agents, the one whose pull request it is among them. */
function controlNaming(): AgentsControl {
  return agentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    models: [],
    pullRequests: new Map([[AGENT.id, PULL_REQUEST]]),
  });
}

const control = controlNaming();

/** Rests the pointer on a control, which hangs its card. */
function hover(control: Element): void {
  restOn(control);
}

/** The pull request's card as its Pull request tab hangs it, with the people its tab read, or none before it has. */
function card(people: AgentChangesPeople | undefined): ReactElement {
  const hung = tabCard({
    kind: TAB_KIND.CHANGES,
    subject: agentSubject(control, AGENT.id, NOTHING_HELD, false),
    models: [],
    pullRequest: PULL_REQUEST,
    people,
    onOpenAgent: () => undefined,
  });
  assert.ok(hung, "the tab hangs its pull request's card");
  return hung;
}

/** Each row of the card's reviewers: the name said, the kind of actor named, whether a bot, and where they stand at the row's end. */
function reviewerRows(within: ParentNode): (string | null | undefined)[][] {
  return [...within.querySelectorAll('[aria-label="Reviewers"] > li')].map((row) => [
    row.querySelector(".ui-inline-ref-label")?.textContent,
    row.querySelector(".actor-mark")?.getAttribute("data-kind"),
    row.querySelector(".actor-mark")?.getAttribute("data-bot") ?? null,
    row.querySelector(".ui-hover-card-row-end")?.textContent,
  ]);
}

test("a pull request's card says who opened it and lists its reviewers by where each stands, each the actor they are to the reader", async () => {
  const strip = await draw(card(PEOPLE));

  const opener =
    strip.querySelector(".ui-hover-card-row [data-actor-ref]") ??
    assert.fail("who opened it is named");
  assert.deepEqual(
    [opener.querySelector(".ui-inline-ref-label")?.textContent, opener.getAttribute("data-kind")],
    ["luke-agent", "github"],
    "Vespin's own App's bot is an App's bot on GitHub, as any other is",
  );
  hover(opener);
  const opened = document.querySelector('.ui-tooltip-card [data-actor-card="github"]');
  assert.match(opened?.textContent ?? "", /luke-agent.*GitHub App/u);

  assert.deepEqual(reviewerRows(strip), [
    ["Charles Pan", "person", null, "Approved"],
    ["octocat", "github", null, "Review requested"],
    ["devin-ai-integration", "github", "true", "Commented"],
    ["luke-agent", "github", "true", "Commented"],
  ]);
  const [, octocat] = strip.querySelectorAll('[aria-label="Reviewers"] [data-actor-ref]');
  hover(octocat ?? assert.fail("octocat's name"));
  const hung = document.querySelector('.ui-tooltip-card [data-actor-card="github"]');
  assert.match(hung?.textContent ?? "", /@octocat.*GitHub user.*Not in this workspace/u);
});

test("who opened the pull request is named alone, whoever the agent wrote as", async () => {
  const opener = async (people: AgentChangesPeople) => {
    const drawn = await draw(card(people));
    const row = drawn.querySelector(".ui-hover-card-row");
    const named = [
      row?.querySelector(".ui-inline-ref-label")?.textContent,
      /as the GitHub App/u.test(row?.textContent ?? ""),
    ];
    act(() => root?.unmount());
    document.body.innerHTML = "";
    return named;
  };

  assert.deepEqual(
    [
      await opener({ author: CHARLES_ON_GITHUB, writtenAs: AGENT_AUTHOR.DEVELOPER }),
      await opener({ author: APP_BOT, writtenAs: AGENT_AUTHOR.APP_UNLINKED }),
      await opener({ author: APP_BOT, writtenAs: AGENT_AUTHOR.DEVELOPER }),
    ],
    [
      ["Charles Pan", false],
      ["luke-agent", false],
      ["luke-agent", false],
    ],
  );
});

test("a pull request's tab card says who opened it and its reviewers once its tab has read them, and neither before", async () => {
  const unread = await draw(card(undefined));
  assert.equal(unread.querySelector('[aria-label="Reviewers"]'), null);
  assert.doesNotMatch(unread.textContent ?? "", /Opened by/u);
  act(() => root?.unmount());
  document.body.innerHTML = "";

  const read = await draw(card(PEOPLE));
  assert.match(read.textContent ?? "", /Opened by luke-agent/u);
  assert.equal(read.querySelectorAll('[aria-label="Reviewers"] > li').length, 4);
});

test("Files changed names nobody, with files or without, since the Pull request tab's header does", async () => {
  const names = async (readChanges: () => Promise<AgentChangesAnswerView>) => {
    fakeActPort(answeringChanges(readChanges));
    const tab = await draw(
      createElement(ChangesTabReading, {
        agentId: AGENT.id,
        control,
        shown: true,
        repository: "acme/relay",
        tree: { open: false, onToggle: () => undefined },
      }),
    );
    const named =
      tab.querySelector("[data-actor-ref], .actor-stack") !== null ||
      /Opened by|Reviewers|Commits by/u.test(tab.textContent ?? "");
    act(() => root?.unmount());
    document.body.innerHTML = "";
    return named;
  };
  const noFiles = () =>
    Promise.resolve({
      pullRequest: { url: PULL_REQUEST.url, truncated: false, files: [], ...PEOPLE },
    });

  assert.deepEqual([await names(changesNaming(PEOPLE)), await names(noFiles)], [false, false]);
});

test("the people an agent's Changes tab read are named on its pull request's card wherever it hangs", async () => {
  /** The agent's pull request's card, hung apart from its tab, naming whom the tab read. */
  function HungCard(): ReactElement {
    return card(peopleOf(useChangesPeople(AGENT.id), PULL_REQUEST));
  }
  const strip = await draw(
    createElement(
      Fragment,
      null,
      createElement(ChangesTabReading, {
        agentId: AGENT.id,
        control,
        shown: true,
        repository: "acme/relay",
        tree: { open: false, onToggle: () => undefined },
      }),
      createElement(HungCard),
    ),
  );

  await vi.waitFor(() =>
    assert.equal(strip.querySelector('[aria-label="Reviewers"]') !== null, true),
  );
  assert.equal(reviewerRows(strip).length, 4);
});

test("a card says the people its tab read only for the pull request they were read for", () => {
  const held = { url: PULL_REQUEST.url, people: PEOPLE };
  assert.equal(peopleOf(held, PULL_REQUEST), PEOPLE);
  assert.equal(peopleOf(held, { url: "https://github.com/acme/relay/pull/43" }), undefined);
  assert.equal(peopleOf(undefined, PULL_REQUEST), undefined);
});

test("a pull request's card hung over its tab lists every reviewer, scrolling within itself and standing, and the window scrolling takes it down", async () => {
  const many = Array.from({ length: 50 }, (_, at) => ({
    by: { login: `reviewer${at}`, bot: false },
    state: REVIEW_STATE.APPROVED,
  }));
  const tab = await draw(
    createElement(Tooltip, {
      label: "Changes: Expiry job",
      card: createElement(PullRequestCard, {
        pullRequest: PULL_REQUEST,
        place: { taskId: null },
        reviewers: many,
      }),
      children: createElement(
        "button",
        { type: "button", "aria-describedby": undefined },
        "Changes: Expiry job",
      ),
    }),
  );
  hover(tab.querySelector("button") ?? assert.fail("the tab stands"));
  const list = document.querySelector('.ui-tooltip-card [aria-label="Reviewers"]');
  assert.equal(list?.children.length, 50, "every reviewer is listed, none counted");
  // Note that the list scrolls in the area it stands in.
  act(() => {
    list?.closest(".ui-scroll-area")?.dispatchEvent(new Event("scroll"));
  });
  assert.ok(
    document.querySelector(".ui-tooltip-card:not([data-leaving]) [data-pull-request-card]"),
    "scrolling the card's own list leaves it standing",
  );
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });
  assert.equal(
    document.querySelector(".ui-tooltip-card:not([data-leaving]) [data-pull-request-card]"),
    null,
    "the window scrolling takes it down",
  );
});
