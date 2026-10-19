// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { pageFrameUrl } from "@luke/features/page-frame";
import type { PageLine } from "@luke/features/page-wire";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import { TASK_WORK_STATE } from "@luke/features/tasks-view";
import { MAIN_TAB } from "@luke/panel/tasks/use-main-tabs";
import { SIDE_PANEL_TAB } from "@luke/panel/tasks/use-side-panel";
import { NO_LOOKS } from "@luke/panel/tasks/use-task-looks";
import { DESKTOP_CAPABILITIES, handCapabilities } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { conversationOf, worker, workerCall, workTurn } from "@luke/panel/testing/task-work";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform } from "#testing/app-platform";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { DesktopTasks } from "./desktop-tasks";

/**
 * tab-look.test.ts -- a tab wears one look wherever it is offered: the
 * glyph and the name its tab wears in either strip are the ones its row in
 * that strip's "+" menu wears, the task's own tab hangs the task's card, and
 * a page's tab hangs a card previewing the page.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  document: { body: "", assumptions: [] },
};

const SUMMARY: TaskSummary = {
  id: TASK.id,
  workspaceId: TASK.workspaceId,
  name: TASK.name,
  createdAt: TASK.createdAt,
  updatedAt: TASK.updatedAt,
  repository: TASK.repository,
  agents: {
    total: 1,
    working: 1,
    agents: [
      {
        id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
        title: "Invite flow",
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        status: CODING_AGENT_STATUS.RUNNING,
      },
    ],
    pullRequestTotal: 0,
    pullRequests: [],
  },
};

/** An agent on the task, standing where `status` says. */
function agent(
  id: string,
  title: string,
  status: CodingAgentSummary["status"],
): CodingAgentSummary {
  return {
    id,
    planId: TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status,
    turnId: null,
  };
}

const WORKING = agent(
  "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  "Invite flow",
  CODING_AGENT_STATUS.RUNNING,
);
const DONE = agent(
  "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32",
  "Expiry job",
  CODING_AGENT_STATUS.COMPLETED,
);

const DRAFT = "draft-1";

/** A page an agent showed on the plan, at its third version. */
const FUNNEL: PageLine = {
  id: "5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f",
  title: "Invite funnel",
  version: 3,
  at: 1_800_000_000_000,
};

/** A brain's worker still at work, on a model whose harness Luke knows. */
const READER = worker("w", "Read the invite emails.", {
  state: TASK_WORK_STATE.RUNNING,
  model: "anthropic/claude-sonnet-5",
  title: "Invite emails",
});

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Waits out the few microtasks the window's document takes to arrive after the first draw. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * The task open on its own tab, a working agent's tab and a draft's beside
 * it, and the side panel open with a working subagent's tab, the done
 * agent's Changes tab, the working agent's Terminal tab, and a page's tab.
 */
async function mount(): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [SUMMARY],
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...base.mainTabs,
      tabs: [MAIN_TAB.PLAN, { agent: WORKING.id }, { draft: DRAFT }],
      tab: MAIN_TAB.PLAN,
      openAgents: [WORKING.id],
    },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      tab: SIDE_PANEL_TAB.CODE,
      subagents: [{ subagent: READER.callId }],
      changes: [{ changes: DONE.id }],
      terminals: [{ terminal: WORKING.id }],
      pages: [{ page: FUNNEL.id }],
    },
    pages: [FUNNEL],
    work: {
      ...base.work,
      conversation: conversationOf([
        workTurn(TASK_WORK_STATE.RUNNING, [workerCall(READER)], { workers: [READER] }),
      ]),
    },
    agents: codingAgentsControl({
      agents: [WORKING, DONE],
      agentIds: [WORKING.id, DONE.id],
      draft: { id: DRAFT, prompt: "", attachments: [], choice: undefined, disabledServers: [] },
      pullRequests: new Map([
        [
          DONE.id,
          {
            number: 42,
            title: "Expire invitations",
            url: "https://github.com/acme/relay/pull/42",
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.PASSING,
            additions: 210,
            deletions: 14,
            changedFiles: 6,
          },
        ],
      ]),
    }),
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  await settle();
  return container;
}

/** A tab or a menu row as a reader sees it: its glyph's markup and its name. */
interface Look {
  glyph: string | undefined;
  label: string | null | undefined;
}

/** Each tab of the strip in `column`, by its name. */
function tabLooks(column: Element): Map<string, Look> {
  return new Map(
    [...column.querySelectorAll('[role="tab"]')].map((tab) => {
      const label = tab.querySelector(".tab-label")?.textContent ?? "";
      return [label, { glyph: tab.querySelector(".tab-icon")?.innerHTML, label }];
    }),
  );
}

/** Each row of the "+" menu in `column`, opened, by its name. */
function rowLooks(column: Element): Map<string, Look> {
  const add = column.querySelector<HTMLButtonElement>('button[aria-label="Open a tab"]');
  assert.ok(add, "the strip's +");
  act(() => add.click());
  const rows = [...column.querySelectorAll('.tab-add-menu [role="option"]')].map((row) => {
    const label = row.querySelector(".luke-combobox-option-label")?.textContent ?? "";
    return [
      label,
      { glyph: row.querySelector(".luke-combobox-option-glyph")?.innerHTML, label },
    ] as const;
  });
  act(() => add.click());
  return new Map(rows);
}

test("the column's + offers a working agent and the draft in the look their tabs wear: the agent's mark wearing where it stands, and the draft named New coding agent", async () => {
  const column = (await mount()).querySelector(".main-tabs");
  assert.ok(column, "the plan's column's strip");
  const tabs = tabLooks(column);
  const rows = rowLooks(column);
  for (const name of [WORKING.title, "New coding agent"]) {
    assert.ok(tabs.has(name ?? ""), `the strip has a tab named ${name}`);
    assert.deepEqual(rows.get(name ?? ""), tabs.get(name ?? ""), `${name} looks the same in the +`);
  }
  assert.match(tabs.get(WORKING.title ?? "")?.glyph ?? "", /data-state="working"/u);
});

test("the plan's own tab closes beside the agents', and the column's + offers the plan to open it again in the look its tab wears", async () => {
  const column = (await mount()).querySelector(".main-tabs");
  assert.ok(column, "the plan's column's strip");
  const pill = column.querySelector('.tab[data-anchored="true"]');
  assert.equal(pill?.getAttribute("data-closable"), "true");
  const tabs = tabLooks(column);
  const rows = rowLooks(column);
  assert.ok(tabs.has(TASK.name), "the strip has the plan's tab");
  assert.deepEqual(rows.get(TASK.name), tabs.get(TASK.name));
});

test("the side panel's + offers a working subagent and an agent's Pull request in the look their tabs wear, the Pull request named by its number and title rather than its agent's name", async () => {
  const panel = (await mount()).querySelector(".side-panel-tabs");
  assert.ok(panel, "the side panel's strip");
  const tabs = tabLooks(panel);
  const rows = rowLooks(panel);
  for (const name of [READER.title, "#42 Expire invitations"]) {
    assert.ok(tabs.has(name ?? ""), `the strip has a tab named ${name}`);
    assert.deepEqual(rows.get(name ?? ""), tabs.get(name ?? ""), `${name} looks the same in the +`);
  }
  assert.match(tabs.get(READER.title ?? "")?.glyph ?? "", /data-state="working"/u);
  assert.match(
    tabs.get("#42 Expire invitations")?.glyph ?? "",
    /data-pull-request-state="open"/u,
    "the Pull request tab wears its pull request's mark for where it stands",
  );
});

test("the plan's own tab hangs the plan's card, as its sidebar row does, its agents among it, rather than a hint naming its repository", async () => {
  const column = (await mount()).querySelector(".main-tabs");
  const tab = column?.querySelector<HTMLElement>('[role="tab"]');
  assert.equal(tab?.textContent, TASK.name);
  act(() => {
    tab?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-task-card]");
  assert.ok(card, "the plan's card is hung");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, TASK.name);
  assert.match(card.textContent ?? "", /acme\/relay/u);
  // The card is the task as the list names it, its agents among it.
  assert.equal(card.querySelector("[data-task-card-agent]")?.textContent, "Invite flow");
});

test("a Terminal tab wears its agent's glyph, says Terminal with the agent's name beside it, and hangs the agent's card saying whose sandbox it is in", async () => {
  const panel = (await mount()).querySelector(".side-panel-tabs");
  const tab = [...(panel?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
    (each) => each.querySelector(".tab-label")?.firstChild?.textContent === "Terminal",
  );
  assert.ok(tab, "the strip has a Terminal tab");
  assert.equal(tab.querySelector(".tab-detail")?.textContent, WORKING.title);
  assert.match(tab.querySelector(".tab-icon")?.innerHTML ?? "", /data-state="working"/u);
  act(() => {
    tab.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "the agent's card is hung");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, WORKING.title);
  assert.ok(card.querySelector(".luke-hover-card-rule"));
  assert.equal(
    [...card.querySelectorAll(".luke-hover-card-note")].at(-1)?.textContent,
    "Terminal in this agent’s sandbox",
  );
});

test("a page's tab hangs the page's card: its title and version over its newest version drawn small, in a frame that runs its scripts alone, takes no pointer or focus, and is left out of the recording", async () => {
  fakeAppPlatform({ pageFrameUrl });
  const panel = (await mount()).querySelector(".side-panel-tabs");
  const tab = [...(panel?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
    (each) => each.querySelector(".tab-label")?.textContent === FUNNEL.title,
  );
  assert.ok(tab, "the strip has the page's tab");
  act(() => {
    tab.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-page-card]");
  assert.ok(card, "the page's card is hung");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, FUNNEL.title);
  assert.equal(card.querySelector(".luke-hover-card-sub")?.textContent, "Version 3");
  const frame = card.querySelector("iframe");
  assert.ok(frame, "the card previews the page");
  assert.equal(
    frame.getAttribute("src"),
    pageFrameUrl({ taskId: TASK.id, pageId: FUNNEL.id, version: FUNNEL.version }),
  );
  assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
  assert.equal(frame.tabIndex, -1);
  assert.equal(frame.getAttribute("aria-hidden"), "true");
  assert.ok(frame.closest(".ph-no-capture"), "the preview is left out of the recording");
});
