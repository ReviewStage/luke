// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import type { Task } from "@luke/features/task-wire";
import { sameTab, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { useDraftsOwner } from "./composer-drafts.js";
import { DesktopSidebar } from "./desktop/desktop-sidebar.js";
import { DesktopTasks } from "./desktop/desktop-tasks.js";
import { SidebarTask } from "./desktop/task-actions.js";
import { DRAFT_WORD } from "./draft-mark.js";
import {
  type AgentComposerControl,
  type MessageSender,
  useAgentComposer,
} from "./tasks/use-agent-composer.js";
import { MAIN_TAB, type MainTab } from "./tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import { type TaskInboxControl, useTaskInbox } from "./tasks/use-task-inbox.js";
import { NO_LOOKS } from "./tasks/use-task-looks.js";
import type { TasksControl } from "./tasks/use-tasks-tab.js";
import { fakeAppBridge } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "./testing/composer.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { sidebarProps } from "./testing/desktop-sidebar.js";
import { installScrollIntoView } from "./testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "./testing/tasks-control.js";

/**
 * A draft as the developer meets it: words typed in one task's agent's box
 * wait there while another task is open and while the agent's tab is away,
 * which its task's sidebar row marks with the Draft pencil while another
 * task is open, and only then, no tab of the task open marking its own,
 * outlast a reload of the window, and go with the message that sends them;
 * and an inbox card's answer, kept the same way, until the agent changes
 * the item it answers.
 */

/** A task with one agent of its own, open on its agent's tab. */
function task(id: string, name: string, agentId: string) {
  const summary: Task = {
    id,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    document: { body: `# ${name}`, assumptions: [] },
  };
  const agent: CodingAgentSummary = {
    id: agentId,
    planId: id,
    model: "openai/gpt-5.6-sol",
    effort: "high",
    title: `${name} agent`,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  return { plan: summary, agent };
}

const INVITES = task(
  "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  "Teammate invitations",
  "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
);
const BILLING = task(
  "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c",
  "Billing export",
  "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32",
);

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** A signed-in identity: its id, where it was stored with one, and its address. */
interface Identity {
  readonly id?: string;
  readonly email: string;
}

/** The account signed in to the window, as the panel's root hands it the drafts. */
function SignedIn({ account }: { account: Identity | undefined }): null {
  useDraftsOwner(account);
  return null;
}

const DEAN = { id: "user-dean", email: "dean@example.com" } as const;
const SAM = { id: "user-sam", email: "sam@example.com" } as const;

/** Sends nothing anywhere: every message stays out, unanswered. */
const NEVER_ANSWERED: MessageSender = () => new Promise(() => undefined);

/**
 * The window on one registry, as one launch of it holds: the sidebar's row
 * of each task beside the plan's column, open on `open`'s agent's tab, or on
 * its plan's own where `onPlan`, its messages sent through `send`.
 */
function windowOn(registry: AtomRegistry.AtomRegistry) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const show = async (
    open: typeof INVITES,
    {
      onTask = false,
      send = NEVER_ANSWERED,
      account,
    }: { onTask?: boolean; send?: MessageSender; account?: Identity } = {},
  ) => {
    const agentTab = { agent: open.agent.id };
    const tasks = tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      tasks: [INVITES.plan, BILLING.plan],
      activeTaskId: open.plan.id,
      region: { kind: DOCUMENT_REGION.READY, task: open.plan },
      mainTabs: {
        ...tasksControl().mainTabs,
        tabs: [MAIN_TAB.CALL, agentTab],
        tab: onTask ? MAIN_TAB.CALL : agentTab,
        openAgents: [open.agent.id],
      },
      agents: codingAgentsControl({
        agents: [open.agent],
        agentIds: [open.agent.id],
        onMessage: (agentId, text, clientKey, attachments) =>
          send(agentId, text, clientKey, attachments),
      }),
    });
    const rows = [INVITES.plan, BILLING.plan].map((summary) =>
      createElement(SidebarTask, {
        key: summary.id,
        tasks: tasks,
        task: summary,
        current: summary.id === open.plan.id,
        unread: false,
        now: 3,
        onOpen: () => undefined,
      }),
    );
    await act(async () =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(SignedIn, { account }),
            createElement("ul", null, rows),
            createElement(DesktopTasks, {
              summary: UNPINNED_SUMMARY,
              looks: NO_LOOKS,
              tasks: tasks,
            }),
          ),
        ),
      ),
    );
    await settle();
  };
  /** The sidebar's row of a task. */
  const row = (name: string) =>
    [...container.querySelectorAll<HTMLElement>("ul > li")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`the sidebar lists ${name}`);
  return {
    container,
    show,
    /** The words the open agent's box shows. */
    box: () => composerEditor(container).textContent,
    /** Whether a task's sidebar row wears the Draft pencil. */
    rowDrafted: (name: string) =>
      row(name).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null,
    /** Whether an agent's tab in the plan's column wears the Draft pencil. */
    tabDrafted: (label: string) => {
      const tab =
        [...container.querySelectorAll<HTMLElement>(".tab")].find(
          (each) => each.querySelector(".tab-label")?.textContent === label,
        ) ?? assert.fail(`the column draws ${label}'s tab`);
      return tab.querySelector(`.tab-end-mark [aria-label="${DRAFT_WORD}"]`) !== null;
    },
  };
}

test("words typed in one task's agent's box wait there while another task is open, its row wearing the Draft pencil only meanwhile", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES);
  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "the open task's box shows its words");

  await app.show(BILLING);
  assert.equal(app.box(), "", "another task's agent starts from nothing of this one's");
  assert.equal(app.rowDrafted(INVITES.plan.name), true, "the draft is marked while away");
  assert.equal(app.rowDrafted(BILLING.plan.name), false, "only the task holding it is marked");

  await app.show(INVITES, { onTask: true });
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "nor while another of its tabs is chosen");

  await app.show(INVITES);
  assert.equal(app.box(), "Expire invites after a week");
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
});

test("an agent's tab wears no Draft pencil, whichever of its task's tabs is chosen", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES);
  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false, "its box shows its words");

  await app.show(INVITES, { onTask: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false, "its task is still the one open");
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
});

test("a draft outlasts a reload of the window, words and mark alike", async () => {
  const before = windowOn(AtomRegistry.make());
  await before.show(INVITES);
  typeInComposer(before.container, "Expire invites after a week");
  await settle();
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = windowOn(AtomRegistry.make());
  await after.show(BILLING);
  assert.equal(after.rowDrafted(INVITES.plan.name), true);
  await after.show(INVITES);
  assert.equal(after.box(), "Expire invites after a week");
});

test("a message sent takes its words out of the draft, so the box comes back empty and nothing is marked", async () => {
  const sent: string[] = [];
  const send: MessageSender = (_agentId, text) => {
    sent.push(text);
    return new Promise(() => undefined);
  };
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { send });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();
  pressInComposer(app.container, "Enter");
  await settle();
  assert.deepEqual(sent, ["Expire invites after a week"]);

  await app.show(BILLING);
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "the mark goes with the words");
  await app.show(INVITES, { onTask: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false);
  await app.show(INVITES);
  assert.equal(app.box(), "");
});

test("a box emptied by hand lets its draft go, and its mark with it", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES);
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  const editor = composerEditor(app.container).editor ?? assert.fail("the box's editor is running");
  act(() => editor.commands.clearContent(true));
  await settle();
  await app.show(BILLING);
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  await app.show(INVITES, { onTask: true });
  assert.equal(app.tabDrafted(INVITES.agent.title ?? ""), false);
});

test("a draft is its account's: another signing in on the same Mac meets none of it, and its writer finds it again", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: DEAN });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: SAM });
  assert.equal(app.box(), "");
  await app.show(BILLING, { account: SAM });
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const relaunched = windowOn(AtomRegistry.make());
  await relaunched.show(INVITES, { account: SAM });
  assert.equal(relaunched.box(), "", "nor after a relaunch");
  await relaunched.show(INVITES, { account: DEAN });
  assert.equal(relaunched.box(), "Expire invites after a week");
  await relaunched.show(BILLING, { account: DEAN });
  assert.equal(relaunched.rowDrafted(INVITES.plan.name), true);
});

test("accounts whose identity holds no id are told apart by their address, so neither reads the other's draft", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: { email: DEAN.email } });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: { email: SAM.email } });
  assert.equal(app.box(), "");
  await app.show(BILLING, { account: { email: SAM.email } });
  assert.equal(app.rowDrafted(INVITES.plan.name), false);
  await app.show(INVITES, { account: { email: DEAN.email } });
  assert.equal(app.box(), "Expire invites after a week");
});

test("the drafts an account kept under its address are its own still once its identity learns its id", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: { email: DEAN.email } });
  typeInComposer(app.container, "Expire invites after a week");
  await settle();

  await app.show(INVITES, { account: DEAN });
  assert.equal(app.box(), "Expire invites after a week");
  await app.show(BILLING, { account: DEAN });
  assert.equal(app.rowDrafted(INVITES.plan.name), true);
});

/** A draft as storage keeps it: an agent's words on a plan, by the account that wrote them. */
function keptEntry(accountId: string, taskId: string, agentId: string, text: string) {
  return { accountId, place: { kind: "agent", planId: taskId, agentId }, text };
}

test("past the most drafts kept, the oldest written goes, whosever it is, and the window lets go of it as storage does", async () => {
  // Dean's draft on Teammate invitations is the oldest; Sam's on Billing export the newest.
  const filler = Array.from({ length: 198 }, (_, at) =>
    keptEntry(DEAN.id, `plan-${at}`, `agent-${at}`, `Draft ${at}`),
  );
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire invites after a week"),
      ...filler,
      keptEntry(SAM.id, BILLING.plan.id, BILLING.agent.id, "Also the CSV"),
    ]),
  );
  const app = windowOn(AtomRegistry.make());
  await app.show(BILLING, { account: DEAN });
  assert.equal(app.rowDrafted(INVITES.plan.name), true);

  typeInComposer(app.container, "Monthly, not weekly");
  await settle();
  assert.equal(app.rowDrafted(INVITES.plan.name), false, "the oldest is let go at once");
  for (const root of roots.splice(0)) act(() => root.unmount());

  const sam = windowOn(AtomRegistry.make());
  await sam.show(BILLING, { account: SAM });
  assert.equal(sam.box(), "Also the CSV", "a newer draft of another account's stands");
});

test("where an account kept a draft for one place under its id and a later one under its address, the later stands once both are its id's", async () => {
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire after a month"),
      keptEntry(DEAN.email, INVITES.plan.id, INVITES.agent.id, "Expire invites after a week"),
    ]),
  );
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: DEAN });
  assert.equal(app.box(), "Expire invites after a week");
});

/** The window's motion as a Mac with none reduced answers it. */
function answerMotion(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/**
 * The sidebar itself, open on `open`'s agent's tab from the tab pinned to it
 * where `pinned`, which the sidebar then marks in place of the task's row.
 */
async function sidebarOn(open: typeof INVITES, pinned: boolean) {
  answerMotion();
  fakeAppBridge({});
  const pin = { task: open.plan.id, tab: { agent: open.agent.id }, label: "Agent", at: 5 };
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [INVITES.plan, BILLING.plan],
    activeTaskId: open.plan.id,
    chosenPin: pinned ? pin : undefined,
    sidePanel: { ...tasksControl().sidePanel, pins: pinned ? [pin] : [] },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.CALL, pin.tab],
      tab: pin.tab,
      openAgents: [open.agent.id],
    },
    agents: codingAgentsControl({ agents: [open.agent], agentIds: [open.agent.id] }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(tasks))),
    ),
  );
  await settle();
  return (name: string) =>
    (
      [...container.querySelectorAll<HTMLElement>("ul > li > button")].find(
        (row) => row.querySelector(".luke-list-row-title")?.firstChild?.textContent === name,
      ) ?? assert.fail(`the sidebar lists ${name}`)
    ).querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null;
}

test("a task opened from a tab pinned to the sidebar is open still, so its row wears no Draft pencil", async () => {
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      { ...keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire"), accountId: null },
    ]),
  );
  const fromPin = await sidebarOn(INVITES, true);
  assert.equal(fromPin(INVITES.plan.name), false);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const away = await sidebarOn(BILLING, false);
  assert.equal(away(INVITES.plan.name), true);
});

/** The workspace New task starts its tasks in. */
const WORKSPACE = "workspace-personal";

/** New task's words as storage keeps them, in `workspaceId`, and on one of its issues where `issueId` names one. */
function newTaskEntry(workspaceId: string, issueId?: string) {
  return {
    accountId: null,
    place: { kind: "newTask", workspaceId, ...(issueId === undefined ? undefined : { issueId }) },
    text: "Expire invites after a week",
  };
}

/** Whether the sidebar's New task row wears the Draft pencil, drawn over `tasks` with the drafts storage holds. */
async function newTaskDrafted(tasks: TasksControl): Promise<boolean> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(tasks))),
    ),
  );
  await settle();
  const row =
    [...container.querySelectorAll<HTMLElement>("button")].find((button) =>
      button.querySelector(".luke-nav-item-name")?.textContent?.startsWith("New task"),
    ) ?? assert.fail("the sidebar draws New task");
  const drafted = row.querySelector(`[role="img"][aria-label="${DRAFT_WORD}"]`) !== null;
  for (const each of roots.splice(0)) act(() => each.unmount());
  return drafted;
}

test("words left in New task's card mark its sidebar row with the Draft pencil while neither the card nor Home shows them", async () => {
  const inWorkspace = (overrides: Partial<TasksControl["newTask"]> = {}) =>
    tasksControl({
      page: TASKS_PAGE.DOCUMENT,
      tasks: [INVITES.plan],
      activeTaskId: INVITES.plan.id,
      newTask: { ...tasksControl().newTask, workspaceId: WORKSPACE, ...overrides },
    });
  assert.equal(await newTaskDrafted(inWorkspace()), false, "nothing is kept yet");

  window.localStorage.setItem("luke.composerDrafts", JSON.stringify([newTaskEntry(WORKSPACE)]));
  assert.equal(await newTaskDrafted(inWorkspace()), true, "the words wait while a task is open");
  assert.equal(
    await newTaskDrafted(inWorkspace({ open: true })),
    false,
    "the open card shows them",
  );
  assert.equal(
    await newTaskDrafted({ ...inWorkspace(), page: TASKS_PAGE.HOME }),
    false,
    "Home's composer shows them",
  );
  assert.equal(
    await newTaskDrafted({
      ...inWorkspace(),
      page: TASKS_PAGE.HOME,
      personView: { ...tasksControl().personView, userId: "user-sam", name: "Sam" },
    }),
    true,
    "a person's page opened from Home stands in its composer's place",
  );
  assert.equal(
    await newTaskDrafted(inWorkspace({ workspaceId: "workspace-team" })),
    false,
    "another workspace's New task starts from nothing of this one's",
  );

  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([newTaskEntry(WORKSPACE, "issue-invites")]),
  );
  assert.equal(
    await newTaskDrafted(inWorkspace()),
    false,
    "a card opened on an issue keeps its words for that issue alone",
  );
});

/** The key the Teammate invitations task's draft agent starts under. */
const DRAFT_KEY = "draft-invites";

/**
 * The window open on the Teammate invitations task with `tabs` beside its
 * plan's, `chosen` among them, its agent standing as `agent` says, the draft
 * agent's under `DRAFT_KEY`, and its sidebar row beside the column; the
 * drafts are what storage holds.
 */
/** The side panel shown on `tab`, its Plan and Inbox standing. */
function inboxPanel(tab: SidePanelTab): TasksControl["sidePanel"] {
  const tabs = [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX];
  return { ...tasksControl().sidePanel, open: true, tabs, strip: tabs, tab };
}

async function columnOn(
  tabs: readonly MainTab[],
  chosen: MainTab,
  agent = INVITES.agent,
  side: SidePanelTab | undefined = undefined,
) {
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [INVITES.plan],
    activeTaskId: INVITES.plan.id,
    region: { kind: DOCUMENT_REGION.READY, task: INVITES.plan },
    mainTabs: {
      ...tasksControl().mainTabs,
      tabs: [MAIN_TAB.CALL, ...tabs],
      tab: chosen,
      openAgents: tabs.some((tab) => sameTab(tab, { agent: INVITES.agent.id }))
        ? [INVITES.agent.id]
        : [],
    },
    ...(side === undefined ? undefined : { sidePanel: inboxPanel(side) }),
    agents: {
      ...codingAgentsControl({
        agents: [agent],
        agentIds: [agent.id],
        readInbox: () => new Promise(() => undefined),
      }),
      draft: {
        id: DRAFT_KEY,
        prompt: "",
        attachments: [],
        choice: undefined,
        disabledServers: [],
      },
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(
            "ul",
            null,
            createElement(SidebarTask, {
              tasks: tasks,
              task: INVITES.plan,
              current: true,
              unread: false,
              now: 3,
              onOpen: () => undefined,
            }),
          ),
          createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks: tasks }),
        ),
      ),
    ),
  );
  await settle();
  const pencil = `[role="img"][aria-label="${DRAFT_WORD}"]`;
  return {
    rowDrafted: () => container.querySelector(`ul > li > button ${pencil}`) !== null,
    tabDrafted: (label: string) =>
      (
        [...container.querySelectorAll<HTMLElement>(".tab")].find(
          (each) => each.querySelector(".tab-label")?.textContent === label,
        ) ?? assert.fail(`the column draws ${label}'s tab`)
      ).querySelector(`.tab-end-mark ${pencil}`) !== null,
    unmount: () => {
      for (const each of roots.splice(0)) act(() => each.unmount());
    },
  };
}

test("an inbox card's answer and a draft agent's first message mark neither their tabs nor their open task's row", async () => {
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      {
        accountId: null,
        place: {
          kind: "inbox",
          planId: INVITES.plan.id,
          agentId: INVITES.agent.id,
          itemId: "a1b2c3d4-0000-4000-8000-000000000001",
          revision: 1,
        },
        text: "Only for teammates",
      },
      {
        accountId: null,
        place: { kind: "newAgent", planId: INVITES.plan.id, draftId: DRAFT_KEY },
        text: "Write the expiry job",
      },
    ]),
  );
  const tabs = [{ draft: DRAFT_KEY }];
  for (const [chosen, side] of [
    [MAIN_TAB.CALL, SIDE_PANEL_TAB.PLAN],
    [MAIN_TAB.CALL, SIDE_PANEL_TAB.INBOX],
    [{ draft: DRAFT_KEY }, SIDE_PANEL_TAB.INBOX],
  ] as const) {
    const column = await columnOn(tabs, chosen, INVITES.agent, side);
    assert.equal(column.tabDrafted(TAB_WORDS.INBOX), false);
    assert.equal(column.tabDrafted(TAB_WORDS.NEW_AGENT), false);
    assert.equal(column.rowDrafted(), false);
    column.unmount();
  }
});

test("a draft behind no open tab of its task's, or behind a failed agent's, leaves the task's row unmarked while it is open", async () => {
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([
      { ...keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Expire"), accountId: null },
    ]),
  );
  const closed = await columnOn([], MAIN_TAB.CALL);
  assert.equal(closed.rowDrafted(), false, "the agent's tab is closed, but its task is open");
  closed.unmount();

  const failed = { ...INVITES.agent, status: CODING_AGENT_STATUS.FAILED };
  const marked = await columnOn([{ agent: INVITES.agent.id }], MAIN_TAB.CALL, failed);
  assert.equal(marked.tabDrafted(INVITES.agent.title ?? ""), false);
  assert.equal(marked.rowDrafted(), false);
});

/** An item of the Teammate invitations agent's, open and asking for an approval, at `revision`. */
function approval(revision: number): InboxItem {
  return {
    id: "a1b2c3d4-0000-4000-8000-000000000001",
    agentId: INVITES.agent.id,
    key: "0001",
    revision,
    version: INBOX_WIRE_VERSION,
    title: "Expire after 7 days?",
    blocks: [],
    response: { type: INBOX_RESPONSE.APPROVAL },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
  };
}

/**
 * The window on its own registry, open on the Teammate invitations task's
 * Inbox tab, whose read answers `item`. Its sidebar row is drawn as it is
 * while another task is open, the only time it wears the Draft pencil.
 */
async function inboxOn(item: InboxItem) {
  answerMotion();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [INVITES.plan],
    activeTaskId: INVITES.plan.id,
    region: { kind: DOCUMENT_REGION.READY, task: INVITES.plan },
    sidePanel: inboxPanel(SIDE_PANEL_TAB.INBOX),
    agents: codingAgentsControl({
      agents: [INVITES.agent],
      agentIds: [INVITES.agent.id],
      readInbox: ({ after }) =>
        after === INBOX_CURSOR_START
          ? Promise.resolve({ items: [item], cursor: "1" })
          : new Promise(() => undefined),
    }),
  });
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(
            "ul",
            null,
            createElement(SidebarTask, {
              tasks: tasks,
              task: INVITES.plan,
              current: false,
              unread: false,
              now: 3,
              onOpen: () => undefined,
            }),
          ),
          createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks: tasks }),
        ),
      ),
    ),
  );
  await settle();
  const box = () => container.querySelector(".inbox-view") ?? assert.fail("the card's answer box");
  return {
    /** The words the card's note shows. */
    note: () => composerEditor(box()).textContent,
    /** Types the words into the card's note, as the field's own input does. */
    type: async (words: string) => {
      typeInComposer(box(), words);
      await settle();
    },
    drafted: () =>
      container.querySelector(`ul > li > button [role="img"][aria-label="${DRAFT_WORD}"]`) !== null,
    reload: () => {
      for (const each of roots.splice(0)) act(() => each.unmount());
      container.remove();
    },
  };
}

test("an inbox card's note outlasts a reload, its task's row marked meanwhile, and is let go once the agent changes the item", async () => {
  const before = await inboxOn(approval(1));
  await before.type("Only for teammates, not guests");
  assert.equal(before.drafted(), true);
  before.reload();

  const after = await inboxOn(approval(1));
  assert.equal(after.note(), "Only for teammates, not guests");
  assert.equal(after.drafted(), true);
  after.reload();

  const changed = await inboxOn(approval(2));
  assert.equal(changed.note(), "", "the agent's change starts the card afresh");
  assert.equal(changed.drafted(), false, "and the draft it outdated is let go");
});

/** One item of an agent's with no plan, open and asking for an approval, at `revision`. */
function tasklessItem(agentId: string, id: string, revision: number): InboxItem {
  return { ...approval(revision), id, agentId };
}

/** An agent's own inbox with no plan, read through its reader as the Inbox page reads it, answering `items`. */
async function tasklessInbox(agentId: string, items: readonly InboxItem[]) {
  let control: TaskInboxControl | undefined;
  function Probe(): null {
    control = useTaskInbox({
      taskId: agentId,
      reader: (after) =>
        after === INBOX_CURSOR_START
          ? Promise.resolve({ items, cursor: "1" })
          : new Promise(() => undefined),
      shown: true,
      waiting: true,
      agents: {
        heldIds: [agentId],
        readInbox: () => new Promise(() => undefined),
        answerInbox: () => new Promise(() => undefined),
        closeInbox: () => new Promise(() => undefined),
        messageInbox: () => new Promise(() => undefined),
        readInboxImage: () => new Promise(() => undefined),
        onRetryList: () => undefined,
      },
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Probe))));
  await settle();
  return control ?? assert.fail("the inbox is held");
}

test("an agent with no plan lets go of its own outdated answers as its inbox is read, and never another agent's", async () => {
  const mine = tasklessItem(INVITES.agent.id, "b1b2c3d4-0000-4000-8000-000000000001", 1);
  const theirs = tasklessItem(BILLING.agent.id, "b1b2c3d4-0000-4000-8000-000000000002", 1);
  const first = await tasklessInbox(INVITES.agent.id, [mine]);
  act(() =>
    first.onDraft(mine, { choices: [], values: [], note: "Only teammates", attachments: [] }),
  );
  const other = await tasklessInbox(BILLING.agent.id, [theirs]);
  act(() => other.onDraft(theirs, { choices: [], values: [], note: "Weekly", attachments: [] }));

  await tasklessInbox(INVITES.agent.id, [{ ...mine, revision: 2 }]);
  const reread = await tasklessInbox(INVITES.agent.id, [mine]);
  assert.equal(reread.draftOf(mine).note, "", "the answer its agent outdated is let go");
  const kept = await tasklessInbox(BILLING.agent.id, [theirs]);
  assert.equal(kept.draftOf(theirs).note, "Weekly");
});

test("words another panel's window writes for a box reach this window's box as they are written", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: DEAN });
  typeInComposer(app.container, "Fix login");
  await settle();

  // The other window's write, as storage hands it to this one.
  window.localStorage.setItem(
    "luke.composerDrafts",
    JSON.stringify([keptEntry(DEAN.id, INVITES.plan.id, INVITES.agent.id, "Fix logout")]),
  );
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "luke.composerDrafts" }));
  });
  await settle();
  assert.equal(app.box(), "Fix logout");
});

test("an account's drafts moved from its address reach a window that read its id's before", async () => {
  const app = windowOn(AtomRegistry.make());
  await app.show(INVITES, { account: DEAN });
  await app.show(INVITES, { account: { email: DEAN.email } });
  typeInComposer(app.container, "Check the export");
  await settle();

  await app.show(INVITES, { account: DEAN });
  assert.equal(app.box(), "Check the export");
});

test("files attached in this window stay as its draft when another window lets the words beside them go", async () => {
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  let composer: AgentComposerControl | undefined;
  function Box(): null {
    useDraftsOwner(DEAN);
    composer = useAgentComposer({
      agentId: INVITES.agent.id,
      taskId: INVITES.plan.id,
      messages: [],
      send: NEVER_ANSWERED,
      onStatus: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Box))));
  const box = () => composer ?? assert.fail("the box is drawn");
  act(() => box().setDraft("Review this"));
  act(() => box().setAttachments((held) => [...held, notes]));

  // The other window let the words go, which is all of the draft storage holds.
  window.localStorage.setItem("luke.composerDrafts", JSON.stringify([]));
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "luke.composerDrafts" }));
  });
  await settle();
  assert.deepEqual([box().draft, box().attachments], ["", [notes]]);
});
