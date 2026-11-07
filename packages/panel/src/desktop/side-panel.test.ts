// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { changesTab } from "@repo/ui/tab-strip-model";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { agentSubject, NOTHING_HELD } from "../tasks/agent-ref.js";
import { PullRequestCard } from "../tasks/pull-request-card.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import {
  PULL_REQUEST_VIEW,
  type SidePanelControl,
  type SidePanelTab,
} from "../tasks/use-side-panel.js";
import { withQueryClient } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import {
  ActivityList,
  changesOffers,
  changesTabOf,
  type DrawnTab,
  type SidePanelDrawing,
  showPullRequest,
  useSidePanelDrawing,
} from "./side-panel.js";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** An agent at rest on the task, named by its title. */
function agent(id: string, title: string, createdAt: number): AgentSummary {
  return {
    id,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
}

/** An open pull request, numbered. */
function pullRequest(number: number, title: string): AgentPullRequest {
  return {
    number,
    title,
    url: `https://github.com/acme/relay/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  };
}

const FIRST = agent("8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21", "Invite flow", 1);
const SECOND = agent("9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32", "Invite fixes", 2);
const THIRD = agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c", "Expiry job", 3);

/** The task's agents, the first two on one pull request and the third on its own. */
function agents(): AgentsControl {
  const shared = pullRequest(41, "Teammate invitations");
  return {
    ...tasksControl().agents,
    agents: [FIRST, SECOND, THIRD],
    agentIds: [FIRST.id, SECOND.id, THIRD.id],
    pullRequests: new Map([
      [FIRST.id, shared],
      [SECOND.id, shared],
      [THIRD.id, pullRequest(42, "Expire invitations")],
    ]),
  };
}

test('an agent\'s pull request chip opens the one tab the "+" offers for its pull request', () => {
  const control = agents();
  const offered = changesOffers(control).map((offer) => changesTab(offer.agentId));
  assert.deepEqual(offered, [changesTab(FIRST.id), changesTab(THIRD.id)]);
  // The second agent shares the first's pull request, so its chip opens the first's tab.
  assert.deepEqual(
    [FIRST, SECOND, THIRD].map((each) => changesTabOf(control, each.id, [])),
    [changesTab(FIRST.id), changesTab(FIRST.id), changesTab(THIRD.id)],
  );
  // An agent whose pull request is not held yet opens its own.
  assert.deepEqual(
    changesTabOf({ ...control, pullRequests: new Map() }, SECOND.id, []),
    changesTab(SECOND.id),
  );
});

test("an agent's pull request opens in the one Pull request tab of its pull request, on the overview or on the files", () => {
  const control = agents();
  const asked: unknown[] = [];
  const panel = {
    changes: [],
    onOpen: (tab: SidePanelTab) => asked.push(["open", tab]),
    onPullRequestView: (tab: SidePanelTab, view: string) => asked.push(["view", tab, view]),
  };
  showPullRequest(panel, control, SECOND.id, PULL_REQUEST_VIEW.CONVERSATION);
  showPullRequest(panel, control, THIRD.id, PULL_REQUEST_VIEW.FILES);
  assert.deepEqual(asked, [
    ["view", changesTab(FIRST.id), PULL_REQUEST_VIEW.CONVERSATION],
    ["open", changesTab(FIRST.id)],
    ["view", changesTab(THIRD.id), PULL_REQUEST_VIEW.FILES],
    ["open", changesTab(THIRD.id)],
  ]);
});

test("a pull request named by its number opens a Pull request tab of its own for it, unless it is the agent's own", () => {
  const control = agents();
  const asked: unknown[] = [];
  const panel = {
    changes: [],
    onOpen: (tab: SidePanelTab) => asked.push(["open", tab]),
    onPullRequestView: (tab: SidePanelTab, view: string) => asked.push(["view", tab, view]),
  };
  showPullRequest(panel, control, THIRD.id, PULL_REQUEST_VIEW.CONVERSATION, 40);
  showPullRequest(panel, control, THIRD.id, PULL_REQUEST_VIEW.CONVERSATION, 42);
  assert.deepEqual(asked, [
    ["view", changesTab(THIRD.id, 40), PULL_REQUEST_VIEW.CONVERSATION],
    ["open", changesTab(THIRD.id, 40)],
    ["view", changesTab(THIRD.id), PULL_REQUEST_VIEW.CONVERSATION],
    ["open", changesTab(THIRD.id)],
  ]);
  // A tab naming another pull request is not the agent's own, so the agent's own still opens its own.
  assert.deepEqual(
    changesTabOf(control, SECOND.id, [changesTab(SECOND.id, 40)]),
    changesTab(FIRST.id),
  );
});

test("an archived agent's merged pull request is offered as any other, in the order its agent started", () => {
  const read = agents();
  const merged = { ...pullRequest(40, "Invite emails"), state: PULL_REQUEST_STATE.MERGED };
  const gone = {
    ...agent("2f4d6b8c-0e3a-4c7f-9b2d-4f6a8c0e2b4d", "Invite emails", 0),
    archivedAt: 5,
  };
  const control = {
    ...read,
    archived: [gone],
    pullRequests: new Map([...read.pullRequests, [gone.id, merged]]),
  };
  assert.deepEqual(
    changesOffers(control).map((offer) => [offer.agentId, offer.pullRequest.state]),
    [
      [gone.id, PULL_REQUEST_STATE.MERGED],
      [FIRST.id, PULL_REQUEST_STATE.OPEN],
      [THIRD.id, PULL_REQUEST_STATE.OPEN],
    ],
  );
  assert.deepEqual(changesTabOf(control, gone.id, []), changesTab(gone.id));
});

test("a shared pull request whose later agent's tab opened before the earlier agent's read landed keeps that one tab", () => {
  // Read apart, the later agent's snapshot of the shared pull request is the newer one.
  const newer = { ...pullRequest(41, "Teammate invitations, with expiry"), changedFiles: 9 };
  const read = agents();
  const control = { ...read, pullRequests: new Map([...read.pullRequests, [SECOND.id, newer]]) };
  const open = [changesTab(SECOND.id)];
  assert.deepEqual(
    [FIRST, SECOND].map((each) => changesTabOf(control, each.id, open)),
    [changesTab(SECOND.id), changesTab(SECOND.id)],
  );
  assert.deepEqual(
    changesOffers(control, open).map((offer) => [
      offer.agentId,
      offer.label,
      offer.pullRequest.title,
    ]),
    [
      [SECOND.id, "Invite fixes", "Teammate invitations, with expiry"],
      [THIRD.id, "Expiry job", "Expire invitations"],
    ],
  );
});

test("a pull request's card names the coding agent whose it is on a row by its tile and name, which hang the agent's card and open its tab", async () => {
  const opened: string[] = [];
  const control = agents();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const published = pullRequest(42, "Expire invitations");
  act(() =>
    root.render(
      withQueryClient(
        createElement(PullRequestCard, {
          pullRequest: published,
          place: { taskId: null },
          lines: published,
          files: published.changedFiles,
          agent: {
            subject: agentSubject(control, THIRD.id, NOTHING_HELD, false),
            models: [],
            onOpen: () => opened.push(THIRD.id),
          },
        }),
      ),
    ),
  );
  assert.equal(container.querySelector(".ui-hover-card-name")?.textContent, "Expire invitations");
  assert.equal(
    container.querySelector(".ui-hover-card-note")?.textContent,
    "+210 −14 in 6 files · Checks passing",
  );
  const named = container.querySelector<HTMLButtonElement>(
    '.ui-hover-card-row button[data-actor-ref][data-kind="agent"]',
  );
  assert.ok(named, "the agent is named as an actor");
  assert.equal(named.textContent, "Expiry job");

  restOn(named);
  await act(async () => {
    await Promise.resolve();
  });
  const card = document.querySelector(".ui-tooltip-card [data-agent-card] .ui-hover-card-name");
  assert.equal(card?.textContent, "Expiry job", "the agent's own card hangs from its name");
  act(() => named.click());
  assert.deepEqual(opened, [THIRD.id]);
  act(() => root.unmount());
  container.remove();
});

test("the phone's Activity list hangs each tab's card on its row, as the tab hangs it in the strip", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const tab: SidePanelTab = changesTab(THIRD.id);
  const strip: DrawnTab[] = [
    {
      tab,
      look: {
        icon: createElement("svg"),
        label: "#42 Expire invitations",
        selected: false,
        card: createElement("div", { "data-pull-request-card": "" }, "Expire invitations"),
        onSelect: () => undefined,
      },
      close: () => undefined,
    },
  ];
  act(() =>
    root.render(
      withQueryClient(
        createElement(ActivityList, { strip, offers: [], onListed: () => undefined }),
      ),
    ),
  );
  const row =
    container.querySelector<HTMLElement>("button.ui-list-row-main") ??
    assert.fail("the tab's row is drawn");
  restOn(row);
  assert.equal(
    document.querySelector(".ui-tooltip-card [data-pull-request-card]")?.textContent,
    "Expire invitations",
  );
  act(() => root.unmount());
  container.remove();
});

test("a panel shut by going to another stop is drawn there no longer, rather than slid out over it", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const shut = tasksControl().sidePanel;
  let drawing: SidePanelDrawing | undefined;
  const Drawn = ({ panel }: { panel: SidePanelControl }) => {
    drawing = useSidePanelDrawing(panel);
    return null;
  };
  const draw = (panel: SidePanelControl) => act(() => root.render(createElement(Drawn, { panel })));
  draw({ ...shut, open: true, stop: TASK, tab: changesTab(FIRST.id) });
  draw({ ...shut, open: false, stop: "0e9c4b1d-6a2f-4e3b-9c7d-1f2a3b4c5d6e" });
  assert.equal(drawing?.panel, undefined);
  act(() => root.unmount());
  container.remove();
});
