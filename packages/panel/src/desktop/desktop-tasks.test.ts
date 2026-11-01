// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentInboxAnswerView, INBOX_SCOPE_KIND } from "@luke/features/agent-view";
import {
  AGENT_STATUS,
  type AgentSummary,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  type InboxMessage,
  type InboxReadAsk,
} from "@luke/features/inbox-wire";
import {
  PLAN_ACTOR,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskStanding,
} from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  type AppHolderInbox,
  type AppHolderInboxes,
  type AppHostRead,
  type AppInboxItems,
  UNREAD,
} from "@luke/host/app-state";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import {
  type FixedSidePanelTab,
  PULL_REQUEST_VIEW,
  SIDE_PANEL_TAB,
  type SidePanelTab,
} from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { relayout } from "../testing/resize-observer.js";
import { ToastHost } from "../toast.js";
import "../file-tree/index.js";
import { askKept } from "../act.js";
import { handHostReads } from "../testing/app-state.js";
import { agentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "", assumptions: [] },
};

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  vi.restoreAllMocks();
});

/** The side panel shown on the plan's comments beside it. */
const DOCUMENT_PANEL: TasksControl["sidePanel"] = {
  ...tasksControl().sidePanel,
  open: true,
  tab: SIDE_PANEL_TAB.COMMENTS,
};

test("a task the service will not hand the reader, as a link to another workspace's may name, is not found, its Close the one way on", () => {
  const left: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(DesktopTasks, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        tasks: tasksControl({
          page: TASKS_PAGE.DOCUMENT,
          activeTaskId: TASK.id,
          region: { kind: DOCUMENT_REGION.MISSING },
          onLeaveTask: () => left.push(TASK.id),
        }),
      }),
    ),
  );
  const close = [...container.querySelectorAll("button")].find(
    (each) => each.textContent === "Close task",
  );
  act(() => close?.click());

  assert.match(
    container.textContent ?? "",
    /Not foundThis task doesn't exist, or you don't have access to it\./u,
  );
  // The frame keeps the window's bar, which the words saying so stand under.
  const frame = container.querySelector("section[aria-label='Not found']");
  assert.equal(frame?.firstElementChild?.tagName, "HEADER");
  assert.deepEqual(left, [TASK.id]);
  act(() => root.unmount());
  container.remove();
});

test("a task with no agent tab draws a new agent's draft and no pane of start buttons", () => {
  const DRAFT_ID = "draft-1";
  const drawn = () => {
    const page = document.createElement("div");
    page.innerHTML = renderToStaticMarkup(
      createElement(DesktopTasks, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        tasks: tasksControl({
          page: TASKS_PAGE.DOCUMENT,
          activeTaskId: TASK.id,
          region: { kind: DOCUMENT_REGION.READY, task: TASK },
          mainTabs: {
            ...tasksControl().mainTabs,
            tabs: [{ draft: DRAFT_ID }],
            tab: { draft: DRAFT_ID },
          },
          agents: agentsControl({
            agentIds: [],
            draft: {
              id: DRAFT_ID,
              prompt: "",
              attachments: [],
              choice: undefined,
              disabledServers: [],
            },
          }),
        }),
      }),
    );
    return page;
  };
  const page = drawn();
  assert.ok(page.querySelector(".desktop-agent .agent-composer"), "the draft's composer is drawn");
  assert.equal(page.querySelector(".desktop-no-agent"), null);
});

/** The task's page with the side panel open on `tab`, as markup. */
function panelTab(tab: FixedSidePanelTab): HTMLElement {
  const markup = renderToStaticMarkup(
    createElement(DesktopTasks, {
      summary: UNPINNED_SUMMARY,
      looks: NO_LOOKS,
      tasks: tasksControl({
        page: TASKS_PAGE.DOCUMENT,
        activeTaskId: TASK.id,
        region: { kind: DOCUMENT_REGION.READY, task: TASK },
        sidePanel: { ...tasksControl().sidePanel, open: true, tab },
      }),
    }),
  );
  const page = document.createElement("div");
  page.innerHTML = markup;
  return page;
}

test("the panel's tab panel is labelled by its chosen tab, which controls it", () => {
  const side = panelTab(SIDE_PANEL_TAB.COMMENTS).querySelector("aside[aria-label='Panel']");
  const panel = side?.querySelector<HTMLElement>("[role=tabpanel]:not([hidden])");
  const chosen = side?.querySelector<HTMLElement>("[role=tab][aria-selected=true]");
  assert.ok(panel && chosen, "the panel shows its chosen tab");
  assert.equal(panel.getAttribute("aria-labelledby"), chosen.id);
  assert.equal(chosen.getAttribute("aria-controls"), panel.id);
  const others = side?.querySelectorAll("[role=tab][aria-selected=false][aria-controls]");
  assert.equal(others?.length, 0, "a tab with no panel standing names none");
});

/** The agent's message opening an item's thread, by the item's id, asking `ask` where it asks. */
function agentMessage(itemId: string, at: number, ask?: InboxMessage["ask"]): InboxMessage {
  return {
    id: askOf(itemId),
    author: INBOX_MESSAGE_AUTHOR.AGENT,
    text: "Invites expire after 24 hours today.",
    ...(ask === undefined ? undefined : { ask }),
    createdAt: at,
  };
}

/** The id of the agent's message opening an item's thread, by the item's id. */
function askOf(itemId: string): string {
  return `e${itemId.slice(1)}`;
}

/** An approval as an ask, Approve or Decline, standing as `status` says. */
function approvalAsk(status: InboxReadAsk["status"]): InboxMessage["ask"] {
  return {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Approve" }, { label: "Decline" }],
    status,
  };
}

/** An item of the plan's agent, open and asking for an approval, as the service answers one. */
function approvalItem(id: string, title: string, at: number): InboxItem {
  return {
    id,
    agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [agentMessage(id, at, approvalAsk(INBOX_ASK_STATUS.OPEN))],
    postedAt: at,
    updatedAt: at,
  };
}

/** The plan's Inbox tab over the items given, laid out 700px wide, too narrow for its list and the item side by side, or as wide as given. */
async function _narrowTaskInbox(
  items: readonly InboxItem[],
  width = 700,
  /** What is pushed after the first push, where a test settles it; else nothing is. */
  later: Promise<AgentInboxAnswerView> = new Promise(() => undefined),
  /** What the first push says, where a test holds it back until it settles; else the items given, once followed. */
  first?: Promise<AgentInboxAnswerView>,
  /** The account reading, none where a test does not say, and where its answers go. */
  reader: Pick<TasksControl, "me"> & Partial<Pick<TasksControl["agents"], "answerInbox">> = {
    me: undefined,
  },
  /** The account's feed, which the tab draws first where it holds the plan; one holding nothing yet unless given. */
  feed: AppHostRead<AppInboxItems> = UNREAD,
) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  // The plan's held read holds `items` from the start, or what `first` says once it settles, and
  // again what `later` says once it settles; one that fails after it answered keeps its rows, as the host keeps them.
  const heldOf = (read: AppHolderInbox): AppHolderInboxes => ({
    [INBOX_SCOPE_KIND.PLAN]: { [TASK.id]: read },
    [INBOX_SCOPE_KIND.AGENT]: {},
  });
  let standing: AppHolderInbox = first === undefined ? { rows: items } : UNREAD;
  // Note that the window is a fresh one, so nothing a test before handed it stands.
  fakeAppBridge({});
  const reads = handHostReads({ items: feed, holders: heldOf(standing) });
  const pushed = (answer: AgentInboxAnswerView) => {
    standing =
      "failure" in answer
        ? standing.rows === undefined
          ? { failed: true }
          : standing
        : { rows: answer.items };
    reads.deliverHolders(heldOf(standing));
  };
  void first?.then(pushed);
  void later.then(pushed);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: TASK.id,
            region: { kind: DOCUMENT_REGION.READY, task: TASK },
            sidePanel: {
              ...tasksControl().sidePanel,
              open: true,
              tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
              strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
              tab: SIDE_PANEL_TAB.INBOX,
            },
            me: reader.me,
            agents: agentsControl({
              agentIds: ["8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21"],
              ...(reader.answerInbox === undefined
                ? undefined
                : { answerInbox: reader.answerInbox }),
            }),
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const tab = container.querySelector<HTMLElement>('section.inbox-view[aria-label="Inbox"]');
  assert.ok(tab, "the plan's Inbox tab");
  vi.spyOn(tab, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width, height: 800 }));
  act(() => relayout());
  return {
    /** What a reader finds standing: the list or the item, and the item's title. */
    standing: () => [
      tab.querySelector(".inbox-tasks")?.hasAttribute("hidden") === false ? "list" : "",
      tab.querySelector(".inbox-view-items")?.hasAttribute("hidden") === false
        ? (tab.querySelector("[data-inbox-title]")?.textContent ?? "item")
        : "",
    ],
    title: () => tab.querySelector("[data-inbox-title]")?.textContent,
    /** The list's head as a reader meets it: its name, and whether it offers a view's menu. */
    head: () => [
      tab.querySelector(".inbox-tasks .luke-pane-bar-title")?.textContent,
      tab.querySelector('button[aria-label="View options"]') !== null,
    ],
    rows: () =>
      [...tab.querySelectorAll(".inbox-tasks .luke-list-row-title")].map((row) => row.textContent),
    pager: () => tab.querySelector(".luke-pager-count")?.textContent ?? null,
    /** What the list's foot says of a refresh that did not land, and whether it offers Retry. */
    refreshFailure: () => {
      const alert = tab.querySelector('.inbox-tasks [role="alert"]');
      const retry = [...tab.querySelectorAll(".inbox-tasks button")].some((button) =>
        button.textContent?.includes("Retry"),
      );
      return [alert?.firstElementChild?.nextElementSibling?.textContent ?? null, retry];
    },
    back: () =>
      [...tab.querySelectorAll<HTMLButtonElement>(".inbox-view-items > .luke-toolbar button")].find(
        (button) => button.textContent === "Inbox",
      ) ?? null,
    row: (title: string) =>
      [
        ...tab.querySelectorAll<HTMLButtonElement>(".inbox-tasks li button.luke-list-row-main"),
      ].find((each) => each.textContent?.includes(title)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** An item of the plan's agent the developer approved, settled. */
function _approvedItem(id: string, title: string, at: number): InboxItem {
  return {
    ...approvalItem(id, title, at),
    status: INBOX_STATUS.ANSWERED,
    thread: [
      agentMessage(id, at, approvalAsk(INBOX_ASK_STATUS.ANSWERED)),
      {
        id: `f${id.slice(1)}`,
        author: INBOX_MESSAGE_AUTHOR.MEMBER,
        text: "",
        answers: { ask: askOf(id), reply: INBOX_REPLY.CHOSE, choices: ["Approve"] },
        createdAt: at,
      },
    ],
  };
}

/** A read the test settles by hand: the promise the Inbox awaits, and what settles it. */
interface HeldAnswer {
  readonly promise: Promise<AgentInboxAnswerView>;
  readonly settle: (answer: AgentInboxAnswerView) => Promise<void>;
}

/** A read held open until the test settles it. */
function _heldAnswer(): HeldAnswer {
  let settle: (answer: AgentInboxAnswerView) => void = () => undefined;
  const promise = new Promise<AgentInboxAnswerView>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    settle: async (answer) => {
      settle(answer);
      await act(async () => {
        for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
      });
    },
  };
}

test("a plan's document opens on its path, its repository as plain words, then its title, with who created it and when it was last edited under the title", () => {
  const home = {
    id: TASK.workspaceId,
    name: "Personal",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const task: Task = {
    ...TASK,
    repository: "acme/web",
    lastEdit: {
      actor: PLAN_ACTOR.DEVELOPER,
      by: { userId: "user-lee", name: "Lee Park" },
      at: 2,
      duringCall: false,
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: task.id,
            region: { kind: DOCUMENT_REGION.READY, task },
            workspaces: [home],
            workspace: home,
            sidePanel: DOCUMENT_PANEL,
          }),
        }),
      ),
    ),
  );
  const body = container.querySelector(".desktop-document .plan-document-body .plan-body");
  // A task from before statuses draws no standing chip.
  const path = body?.firstElementChild;
  const first = path?.nextElementSibling;
  const byline = first?.nextElementSibling;

  assert.equal(body?.previousElementSibling === null, true, "nothing stands over the document");
  assert.equal(path?.classList.contains("plan-task-path"), true, "the path leads the document");
  assert.match(path?.textContent ?? "", /acme\/web/u, "the path names the repository");
  assert.equal(
    [...(path?.querySelectorAll("button") ?? [])].some((each) =>
      each.textContent?.includes("acme/web"),
    ),
    false,
    "the repository is words, not a press",
  );
  assert.equal(first?.querySelector("h1")?.textContent, task.name, "the title stands under it");
  assert.ok(byline?.classList.contains("plan-byline"), "the byline stands under the title");
  assert.match(byline?.textContent ?? "", /^Created by .*Edited /u);
  act(() => root.unmount());
  container.remove();
});

test("a chip in the plan naming a pull request one of the task's agents opened opens that agent's Pull request tab on its conversation as the panel's preview, another of the task's repository, an archived agent's among them, opens by its number, and another repository's opens on GitHub", () => {
  const agent: AgentSummary = {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Batch the invitations",
    createdAt: 3,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const url = "https://github.com/acme/relay/pull/42";
  const other = "https://github.com/acme/relay/pull/7";
  const archived: AgentSummary = {
    ...agent,
    id: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
    title: "An earlier try",
    archivedAt: 4,
  };
  const archivedUrl = "https://github.com/acme/relay/pull/9";
  const elsewhere = "https://github.com/acme/billing/pull/3";
  const opened: unknown[] = [];
  const onGitHub: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...DESKTOP_LINKS });
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.GITHUB_OPEN]: ({ url }) => {
      onGitHub.push(url);
      return Promise.resolve();
    },
  });
  const task: Task = {
    ...TASK,
    repository: "acme/relay",
    document: {
      body: `## Rollout\n\nShipped in [@relay#42](${url}/), after [@relay#7](${other}) and [@relay#9](${archivedUrl}), beside [@billing#3](${elsewhere}).\n`,
      assumptions: [],
    },
  };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks: tasksControl({
            page: TASKS_PAGE.DOCUMENT,
            activeTaskId: task.id,
            region: { kind: DOCUMENT_REGION.READY, task },
            sidePanel: {
              ...DOCUMENT_PANEL,
              onPullRequestView: (tab, view) => opened.push({ agentId: tab.changes, view }),
              onPreview: (tab) => opened.push(tab),
            },
            agents: agentsControl({
              agents: [agent],
              archived: [archived],
              agentIds: [agent.id],
              pullRequests: new Map([
                [
                  agent.id,
                  {
                    number: 42,
                    title: "Send invitations in batches",
                    url,
                    state: PULL_REQUEST_STATE.OPEN,
                    checks: CHECK_SUMMARY.PASSING,
                    additions: 12,
                    deletions: 3,
                    changedFiles: 2,
                  },
                ],
                [
                  archived.id,
                  {
                    number: 9,
                    title: "Send invitations at once",
                    url: archivedUrl,
                    state: PULL_REQUEST_STATE.CLOSED,
                    checks: CHECK_SUMMARY.NONE,
                    additions: 4,
                    deletions: 1,
                    changedFiles: 1,
                  },
                ],
              ]),
            }),
          }),
        }),
      ),
    ),
  );
  const chip = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>(".desktop-document [data-mention-ref]")].find(
      (each) => each.querySelector(".luke-inline-ref-label")?.textContent?.includes(name),
    );

  const own = chip("relay#42");
  assert.ok(own, "the agent's pull request is its chip");
  act(() => own.click());
  assert.deepEqual(opened, [
    { agentId: agent.id, view: PULL_REQUEST_VIEW.CONVERSATION },
    { changes: agent.id },
  ]);
  assert.deepEqual(onGitHub, [], "nothing opened on GitHub");

  // Another pull request of the task's repository opens in a Pull request tab of its own, by its number.
  act(() => chip("relay#7")?.click());
  // An archived agent's Pull request tab is not drawn on the task, so its pull request opens by its number too.
  act(() => chip("relay#9")?.click());
  assert.deepEqual(opened.slice(2), [
    { agentId: agent.id, view: PULL_REQUEST_VIEW.CONVERSATION },
    { changes: agent.id, number: 7 },
    { agentId: agent.id, view: PULL_REQUEST_VIEW.CONVERSATION },
    { changes: agent.id, number: 9 },
  ]);
  assert.deepEqual(onGitHub, [], "nothing opened on GitHub");

  act(() => chip("billing#3")?.click());
  assert.deepEqual(onGitHub, [elsewhere]);
  assert.equal(opened.length, 6, "no tab was asked for");
  act(() => root.unmount());
  container.remove();
});

/** The task's page with the side panel shown on `tab`, its plan among its tabs, drawn into a container of its own. */
function panelPage(tab: SidePanelTab, overrides: Partial<TasksControl> = {}) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const draw = (shown: SidePanelTab, more: Partial<TasksControl> = {}) =>
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            tasks: tasksControl({
              page: TASKS_PAGE.DOCUMENT,
              activeTaskId: TASK.id,
              region: { kind: DOCUMENT_REGION.READY, task: TASK },
              ...overrides,
              ...more,
              sidePanel: { ...DOCUMENT_PANEL, ...overrides.sidePanel, tab: shown },
            }),
          }),
        ),
      ),
    );
  draw(tab);
  return {
    container,
    draw,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("the plan stays drawn, hidden, while an agent's tab of the column is shown, so an edit not yet saved outlives the switch", () => {
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const column = (tab: MainTab): Partial<TasksControl> => ({
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.OVERVIEW, { agent: agentId }],
      tab,
      openAgents: [agentId],
    },
  });
  const page = panelPage(SIDE_PANEL_TAB.COMMENTS, column(MAIN_TAB.OVERVIEW));
  const document = page.container.querySelector(".desktop-document");
  assert.ok(document, "the plan is drawn on Overview");
  assert.equal(document.hasAttribute("hidden"), false);

  page.draw(SIDE_PANEL_TAB.COMMENTS, column({ agent: agentId }));
  assert.equal(page.container.querySelector(".desktop-document"), document, "the same plan stands");
  assert.equal(document.hasAttribute("hidden"), true);

  page.draw(SIDE_PANEL_TAB.COMMENTS, column(MAIN_TAB.OVERVIEW));
  assert.equal(page.container.querySelector(".desktop-document"), document);
  assert.equal(document.hasAttribute("hidden"), false);
  page.unmount();
});

test("a summary row that opens a tab of the side panel hands the panel the keys, so ⌘W closes the panel's tab rather than the column's", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 1200, height: 800 }),
  );
  const closed: string[] = [];
  const agentId = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
  const page = panelPage(SIDE_PANEL_TAB.COMMENTS, {
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.OVERVIEW, { agent: agentId }],
      tab: MAIN_TAB.OVERVIEW,
      onClose: () => closed.push("column"),
    },
    sidePanel: { ...DOCUMENT_PANEL, onClose: () => closed.push("panel") },
  });
  act(() => relayout());
  const row = [
    ...page.container.querySelectorAll<HTMLButtonElement>(".task-summary li button"),
  ].find((each) => each.getAttribute("aria-label") === "Comments");
  assert.ok(row, "the summary offers the Comments tab");
  act(() => row.click());
  act(() => runAppCommand(APP_COMMAND.CLOSE_TAB));

  assert.deepEqual(closed, ["panel"]);
  page.unmount();
});

/** The open task's page, standing In progress at High priority, whose changes of standing the service keeps or refuses as `keeps` says, and the changes it was sent. */
function standingPageMounted(keeps: boolean) {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  const task: Task = {
    ...TASK,
    number: 7,
    status: TASK_STATUS.IN_PROGRESS,
    priority: TASK_PRIORITY.HIGH,
  };
  const sent: TaskStanding[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            tasks: tasksControl({
              page: TASKS_PAGE.DOCUMENT,
              activeTaskId: task.id,
              region: { kind: DOCUMENT_REGION.READY, task },
              sidePanel: DOCUMENT_PANEL,
              onSetTaskStanding: (_taskId, standing) => {
                sent.push(standing);
                return askKept(Promise.resolve(keeps));
              },
            }),
          }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  /** The chip named `label`, which says its value after its name. */
  const chip = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find((each) =>
      each.getAttribute("aria-label")?.startsWith(`${label}:`),
    );
  /** Picks `words` from the menu the `label` chip drops, and lets the answer land. */
  const pick = async (label: string, words: string) => {
    act(() => chip(label)?.click());
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes(words),
    );
    assert.ok(row, `the ${label} menu offers ${words}`);
    act(() => row.click());
    await act(async () => undefined);
  };
  return {
    sent,
    chip,
    pick,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("a status or priority the service refuses raises the toast the rows raise, and the chip goes on showing the value that stands", async () => {
  const page = standingPageMounted(false);

  await page.pick("Status", "Done");
  assert.deepEqual(page.sent, [{ status: TASK_STATUS.DONE }]);
  assert.match(document.body.textContent ?? "", /The task could not be changed\. Try again\./u);
  assert.equal(page.chip("Status")?.getAttribute("aria-label"), "Status: In progress");

  await page.pick("Priority", "Low");
  assert.deepEqual(page.sent[1], { priority: TASK_PRIORITY.LOW });
  assert.equal(page.chip("Priority")?.getAttribute("aria-label"), "Priority: High");
  page.unmount();
});

test("a status the service keeps raises no toast", async () => {
  const page = standingPageMounted(true);

  await page.pick("Status", "Done");

  assert.deepEqual(page.sent, [{ status: TASK_STATUS.DONE }]);
  assert.doesNotMatch(document.body.textContent ?? "", /could not be changed/u);
  page.unmount();
});
