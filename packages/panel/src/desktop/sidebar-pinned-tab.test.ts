// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@repo/brand";
import {
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import type { TaskPullRequestLine, TaskSummary } from "@repo/features/task-wire";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { AGENT_ACT_KIND } from "@repo/host/contract";
import { agentTab, changesTab } from "@repo/ui/tab-strip-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, test, vi } from "vitest";
import { SIDE_PANEL_TAB, type SidebarPin } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  FAKE_ANSWER,
  type FakeActAnswer,
  fakeActPort,
  fakeActPortCalls,
  fakeActs,
  quietHold,
} from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { onRegistry, writeAppState } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { agentsControl, listedAgent, tasksControl } from "../testing/tasks-control.js";
import { SidebarPinnedTab } from "./sidebar-pinned-tab.js";

/**
 * sidebar-pinned-tab.test.ts -- an agent's pin in the sidebar shows the pull
 * request its agent opened as the task list holds it, so neither a pointer
 * crossing the row nor its card asks the service anything. A Changes pin on
 * the open task hangs the Changes tab's own card from the pull request the
 * tab reads, and keeps the pin's own card for a pin of another task. The
 * service is a script at the act boundary; synthetic ids throughout.
 */

const TASK: TaskSummary = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
};

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PIN: SidebarPin = {
  task: TASK.id,
  tab: agentTab(AGENT),
  label: "Expiry job",
  at: 1,
  model: "anthropic/claude-opus-5.5",
};

/** Each part of a pull request the window asked the host to hold, by agent. */
let reads: string[] = [];
let root: Root | undefined;

beforeEach(() => {
  reads = [];
  fakeActs({
    act: (): Promise<FakeActAnswer> =>
      Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not in this test." }),
  });
  fakeActPort({
    ...fakeActPortCalls(),
    [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: ({ agentId }) => {
      reads.push(agentId);
      return quietHold();
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** The pin's row drawn in the sidebar's list, answering its press. */
function drawPin(
  pin: SidebarPin = PIN,
  task: TaskSummary = TASK,
  control: TasksControl = tasksControl({ tasks: [task] }),
): HTMLElement {
  const list = document.body.appendChild(document.createElement("ul"));
  root = createRoot(list);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(SidebarPinnedTab, {
          tasks: control,
          pin,
          on: { task },
          current: false,
          inSight: true,
          onOpen: () => undefined,
          onOpenHolder: () => undefined,
          onUnpin: () => undefined,
        }),
      ),
    ),
  );
  return list.querySelector<HTMLElement>("button.ui-list-row-main") ?? assert.fail("the row");
}

/** Lays the task's pull requests on the window's document, as the list followed live holds them. */
function holdPullRequests(pullRequests: readonly TaskPullRequestLine[]): void {
  writeAppState(
    stateWith(
      {},
      { tasks: { ...IDLE_TASKS_VIEW, taskPullRequests: [{ taskId: TASK.id, pullRequests }] } },
    ),
  );
}

async function settled(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The pointer leaving the row for somewhere else, as a browser tells the row and the press. */
function leave(press: HTMLElement): void {
  const outside = document.body.appendChild(document.createElement("div"));
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: outside }));
    press.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: outside }));
    press.parentElement?.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: outside }));
    outside.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: press }));
  });
}

const card = () => document.querySelector(".ui-tooltip-card [data-pinned-tab-card]");

test("a pointer crossing a pinned agent's row asks the service nothing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const press = drawPin();
  act(() => {
    press.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT / 2);
  });
  leave(press);
  act(() => {
    vi.advanceTimersByTime(2 * MOTION_DELAY_MS.HINT);
  });
  await settled();
  assert.equal(card(), null);
  assert.deepEqual(reads, []);
});

test("a pinned Changes tab wears its pull request's mark and current label where its task's pull requests hold it, and the gray icon and pinned label where they do not", () => {
  const pin: SidebarPin = { task: TASK.id, tab: changesTab(AGENT), label: "#42 Old title", at: 1 };
  const held: TaskSummary = {
    ...TASK,
    agents: { total: 1, working: 0, pullRequestTotal: 1 },
  };
  holdPullRequests([
    {
      number: 42,
      title: "Expire invitations",
      state: PULL_REQUEST_STATE.MERGED,
      checks: CHECK_SUMMARY.PASSING,
      additions: 4,
      deletions: 1,
      agentId: AGENT,
    },
  ]);
  const live = drawPin(pin, held);
  assert.equal(live.textContent, "#42 Expire invitations");
  assert.equal(
    live.querySelector("[data-pull-request-mark]")?.getAttribute("data-pull-request-state"),
    PULL_REQUEST_STATE.MERGED,
  );

  act(() => root?.unmount());
  document.body.replaceChildren();
  holdPullRequests([]);
  const unknown = drawPin(pin, TASK);
  assert.equal(unknown.textContent, "#42 Old title");
  assert.equal(unknown.querySelector("[data-pull-request-mark]"), null);
});

test("a pinned agent's tab of a task not open says its agent's name as the list followed live says it now, and the label it was pinned under where it holds no such agent", () => {
  const renamed: TaskSummary = {
    ...TASK,
    agents: { total: 1, working: 0, pullRequestTotal: 0 },
  };
  const followed = listedAgent({
    id: AGENT,
    planId: TASK.id,
    title: "Expire stale invitations",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: AGENT_STATUS.COMPLETED,
    createdAt: 1,
    turnId: null,
  });
  const live = drawPin(PIN, renamed, tasksControl({ tasks: [renamed], liveAgents: [followed] }));
  assert.equal(live.textContent, "Expire stale invitations");

  act(() => root?.unmount());
  document.body.replaceChildren();
  const unnamed = drawPin(PIN, TASK);
  assert.equal(unnamed.textContent, "Expiry job");
});

test("a pinned Changes tab of an agent that shares its pull request with a newer one wears the open task's read of its own", () => {
  const pin: SidebarPin = { task: TASK.id, tab: changesTab(AGENT), label: "#42 Old title", at: 1 };
  const newer = "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const held: TaskSummary = {
    ...TASK,
    agents: { total: 2, working: 0, pullRequestTotal: 1 },
  };
  holdPullRequests([
    {
      number: 42,
      title: "Newer title",
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
      additions: 4,
      deletions: 1,
      agentId: newer,
    },
  ]);
  const base = tasksControl({ tasks: [held] });
  const control: TasksControl = {
    ...base,
    activeTaskId: TASK.id,
    agents: {
      ...base.agents,
      agents: undefined,
      pullRequests: new Map([
        [
          AGENT,
          {
            number: 42,
            title: "Newer title",
            url: "https://github.com/acme/relay/pull/42",
            state: PULL_REQUEST_STATE.MERGED,
            checks: CHECK_SUMMARY.PASSING,
            additions: 4,
            deletions: 1,
            changedFiles: 1,
          },
        ],
      ]),
    },
  };
  const row = drawPin(pin, held, control);
  assert.equal(row.textContent, "#42 Newer title");
  assert.equal(
    row.querySelector("[data-pull-request-mark]")?.getAttribute("data-pull-request-state"),
    PULL_REQUEST_STATE.MERGED,
  );
});

test("a pinned Changes tab naming a pull request by number keeps its pinned label where the task's pull requests stand in more than one repository, since a number names one only within its repository", () => {
  const pin: SidebarPin = {
    task: TASK.id,
    tab: changesTab(AGENT, 42),
    label: "#42 Old title",
    at: 1,
  };
  const line = (repository: string) => ({
    number: 42,
    title: `Title in ${repository}`,
    url: `https://github.com/acme/${repository}/pull/42`,
    state: PULL_REQUEST_STATE.MERGED,
    checks: CHECK_SUMMARY.PASSING,
    additions: 4,
    deletions: 1,
  });
  const held: TaskSummary = {
    ...TASK,
    agents: { total: 2, working: 0, pullRequestTotal: 2 },
  };
  holdPullRequests([line("old"), line("new")]);
  const row = drawPin(pin, held);
  assert.equal(row.textContent, "#42 Old title");
  assert.equal(row.querySelector("[data-pull-request-mark]"), null);
});

describe("a pinned Changes tab's card", () => {
  const pin: SidebarPin = { task: TASK.id, tab: changesTab(AGENT), label: "#42 Old title", at: 1 };
  const summary: AgentSummary = {
    id: AGENT,
    planId: TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Expiry job",
    createdAt: 1,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const read = {
    number: 42,
    title: "Newer title",
    url: "https://github.com/acme/relay/pull/42",
    state: PULL_REQUEST_STATE.MERGED,
    checks: CHECK_SUMMARY.PASSING,
    additions: 4,
    deletions: 1,
    changedFiles: 3,
  };
  /** The open task, which has read its agent's pull request. */
  const openTask = (agents: readonly AgentSummary[]): TasksControl => {
    const base = tasksControl({ tasks: [TASK] });
    return {
      ...base,
      activeTaskId: TASK.id,
      agents: agentsControl({ agents, pullRequests: new Map([[AGENT, read]]) }),
    };
  };

  test("is the Changes tab's own card where the open task holds its agent, read without asking the service", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    restOn(drawPin(pin, TASK, openTask([summary])));
    await settled();
    const tabCard = document.querySelector(".ui-tooltip-card [data-pull-request-card]");
    assert.match(tabCard?.textContent ?? "", /Newer title/u);
    assert.match(tabCard?.textContent ?? "", /3 files/u);
    assert.match(tabCard?.textContent ?? "", /Expiry job/u);
    assert.equal(card(), null, "no pin card stands beside it");
    assert.deepEqual(reads, []);
  });

  test("is the pin's own card, naming the pull request the task list holds without asking the service, where the task is not open", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const listed = {
      tasks: {
        ...IDLE_TASKS_VIEW,
        tasks: [TASK],
        agentPullRequests: [{ agentId: AGENT, taskId: TASK.id, pullRequest: read }],
      },
    };
    handState({}, listed);
    // Note that the test's Query client is handed the document at once, since its timers are held still.
    writeAppState(stateWith({}, listed));
    restOn(drawPin(pin));
    await settled();
    assert.match(card()?.textContent ?? "", /Newer title/u);
    assert.equal(document.querySelector(".ui-tooltip-card [data-pull-request-card]"), null);
    assert.deepEqual(reads, []);
  });

  test("is the pin's own card where the open task no longer holds the agent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    restOn(drawPin(pin, TASK, openTask([])));
    await settled();
    assert.match(card()?.textContent ?? "", /No longer on this task/u);
    assert.equal(document.querySelector(".ui-tooltip-card [data-pull-request-card]"), null);
  });
});

test("a pinned tab's ⋯ and its right-click open the same menu, the ⋯ a Tab stop after its press", () => {
  const press = drawPin({ task: TASK.id, tab: SIDE_PANEL_TAB.INBOX, label: "Inbox", at: 1 });
  const more = document.querySelector<HTMLButtonElement>('button[aria-label="Pinned tab actions"]');
  assert.ok(more, "the row draws a ⋯");
  assert.equal(more.tabIndex, 0);
  const offered = () =>
    [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
      (each) => each.textContent,
    );
  act(() => more.click());
  const fromMore = offered();
  assert.ok(fromMore.includes("Unpin"));
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.deepEqual(offered(), []);
  act(() => {
    press.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 4 }));
  });
  assert.deepEqual(offered(), fromMore);
});
