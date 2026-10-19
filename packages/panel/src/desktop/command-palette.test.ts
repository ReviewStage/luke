// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { ISSUE_PRIORITY, ISSUE_STATUS, type Issue } from "@luke/features/issue-wire";
import { TASK_TREE_ENTRY, type Task } from "@luke/features/task-wire";
import type { TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { EXPERIMENT, HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND, type AppCommand } from "@luke/settings/shortcuts";
import { experimentsOn, settingsView } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import {
  appCommandOffered,
  runAppCommand,
  useAppCommand,
  useMenuCommands,
} from "../app-commands.js";
import { PageWorkspaceProvider, useCopyLink, usePageWorkspace } from "../links-at-hand.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelControl } from "../tasks/use-side-panel.js";
import { useTaskLooks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, ISSUES_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { CommandPalette } from "./command-palette.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { ListedAutomations } from "./listed-automations.js";
import { panelEntries } from "./side-panel.js";

/** Where the palette sent the window: each tab and each Settings page it asked for, in order. */
interface Sent {
  tabs: PanelTab[];
  views: SettingsView[];
}

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** An agent's page, as far as it tells the window the workspace it read its agent into. */
function AgentPageTelling(props: { agentId: string; workspaceId: string }): null {
  usePageWorkspace(props.agentId, props.workspaceId);
  return null;
}

/** The palette as the window draws it, offering the links at hand through the window's own Copy link, beside an agent's page where one tells its workspace. */
function WindowPalette({
  page,
  ...props
}: Omit<Parameters<typeof CommandPalette>[0], "links"> & {
  page?: { agentId: string; workspaceId: string } | undefined;
}): React.JSX.Element {
  const links = useCopyLink(props.tasks, undefined, true);
  return createElement(
    PageWorkspaceProvider,
    { value: links.onPageWorkspace },
    createElement(CommandPalette, { ...props, links }),
    page === undefined ? null : createElement(AgentPageTelling, page),
  );
}

/** The palette over a window on its Tasks tab, opened by ⌘K's command, every page it opens recorded. */
function openPalette(
  tasks: TasksControl = tasksControl(),
  readFiles: (taskId: string) => Promise<TasksTreeAnswer> = () =>
    Promise.reject(new Error("no repository is open")),
  page?: { agentId: string; workspaceId: string },
  capabilities: readonly HostCapability[] = DESKTOP_CAPABILITIES,
): Sent {
  const sent: Sent = { tabs: [], views: [] };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(WindowPalette, {
        available: true,
        tab: PANEL_TAB.TASKS,
        onTabChange: (tab) => sent.tabs.push(tab),
        tasks,
        settings: {
          rows: {
            settings: settingsView(),
            voiceControlsDrawn: true,
            accountDrawn: true,
            capabilities,
          },
          capabilities,
          onViewChange: (view) => sent.views.push(view),
        },
        readFiles,
        page,
      }),
    ),
  );
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  return sent;
}

/** The window's look at `looked`, as its shell takes one while the plan is on screen, and none while it is covered. */
function Looker({ looked }: { looked: typeof DOCUMENT_TASK | undefined }): null {
  useTaskLooks(looked, undefined);
  return null;
}

/** The palette over `DOCUMENT_PLAN` drawn, looked at or covered as `looked` says, redrawn by the answer. */
function paletteOverTask(): (looked: typeof DOCUMENT_TASK | undefined) => void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const registry = AtomRegistry.make();
  const tasks = tasksControl({
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    activeTaskId: DOCUMENT_TASK.id,
  });
  return (looked) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(Looker, { looked }),
            createElement(WindowPalette, {
              available: true,
              tab: PANEL_TAB.TASKS,
              onTabChange: () => undefined,
              tasks: tasks,
              settings: {
                rows: {
                  settings: settingsView(),
                  voiceControlsDrawn: true,
                  accountDrawn: true,
                  capabilities: DESKTOP_CAPABILITIES,
                },
                capabilities: DESKTOP_CAPABILITIES,
                onViewChange: () => undefined,
              },
              readFiles: () => Promise.reject(new Error("no repository is open")),
            }),
          ),
        ),
      ),
    );
}

/** The rows ⌘K lists for "mark", the palette opened afresh. */
function markRows(): string[] {
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  type("mark");
  return rows().filter((row) => row.startsWith("Mark as"));
}

test("⌘K marks the task on screen unread and then read, and offers no mark for a task Settings or the Inbox covers", () => {
  const draw = paletteOverTask();
  draw(undefined);
  assert.deepEqual(markRows(), []);
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K closes");
  });

  draw(DOCUMENT_TASK);
  assert.deepEqual(markRows(), ["Mark as unread"]);
  press("Mark as unread");
  assert.deepEqual(markRows(), ["Mark as read"]);
  press("Mark as read");
  assert.deepEqual(markRows(), ["Mark as unread"]);
});

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".command-palette-search input");
  assert.ok(input, "the search field is drawn");
  return input;
}

/** The toggles in the group named Filter. */
function filterChips(): HTMLButtonElement[] {
  const group = document.querySelector('fieldset[aria-label="Filter"]');
  assert.ok(group, "the filters are drawn");
  return [...group.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
}

function chooseFilter(name: string): void {
  const chip = filterChips().find((each) => each.textContent === name);
  assert.ok(chip, `the ${name} filter is drawn`);
  act(() => chip.click());
}

function type(words: string): void {
  const input = field();
  // Note that the value goes in through the prototype's setter, because React
  // tracks the field's own and would read a change made there as none.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The words a reader hears in a part of a row: its text but for a mark hidden from a screen reader, a workspace's tile's letter among them. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

/** Each row the palette lists, as its name and the muted words after it. */
function rows(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((row) =>
    [
      row.querySelector(".luke-combobox-option-label"),
      row.querySelector(".luke-combobox-option-detail"),
    ]
      .filter((part) => part !== null)
      .map(heard)
      .join(" · "),
  );
}

/** Presses the row listed as exactly these words. */
function press(listed: string): void {
  const at = rows().indexOf(listed);
  const row = document.querySelectorAll<HTMLElement>('[role="option"]')[at];
  assert.ok(row, `${listed} is listed`);
  act(() => row.click());
}

/** The Settings pages by their names, in the order the palette lists them: Account's own page is Profile, and the Workspace page, whose head names the listed workspace, is Workspace here. */
const SETTINGS_PAGES = [
  "Profile",
  "Workspace",
  "Coding agents",
  "Integrations",
  "Plan template",
  "Voice",
  "Appearance",
  "Notifications",
  "This Mac",
  "Experimental",
  "About",
  "Keyboard shortcuts",
];

test("the Settings filter lists every Settings page by its name, ahead of the settings", () => {
  openPalette();
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, SETTINGS_PAGES.length), SETTINGS_PAGES);
});

test("on a platform without voice or Mac commands, the Settings filter lists neither page, and finds none of their rows", () => {
  const offered = DESKTOP_CAPABILITIES.filter(
    (each) => each !== HOST_CAPABILITY.VOICE && each !== HOST_CAPABILITY.MAC_COMMANDS,
  );
  const shown = SETTINGS_PAGES.filter((page) => page !== "Voice" && page !== "This Mac");
  openPalette(undefined, undefined, undefined, offered);
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, shown.length), shown);
  type("Talk to Luke");
  assert.equal(
    rows().some((row) => row.includes("Talk to Luke")),
    false,
  );
  type("Let agents run commands on this Mac");
  assert.equal(
    rows().some((row) => row.includes("Let agents run commands")),
    false,
  );
});

test("a page is found by its name, above every setting the query finds", () => {
  openPalette();
  chooseFilter("Settings");

  type("settings");

  // Note that the Settings shortcut's own row scores higher on the word than
  // any page does, and the pages still come first.
  assert.deepEqual(rows().slice(0, SETTINGS_PAGES.length + 1), [
    ...SETTINGS_PAGES,
    "Settings · Keyboard shortcuts",
  ]);
  type("coding");
  assert.equal(rows()[0], "Coding agents");
});

test("choosing a page opens Settings on that page", () => {
  const sent = openPalette();
  chooseFilter("Settings");

  press("Integrations");

  assert.deepEqual(sent, { tabs: [PANEL_TAB.SETTINGS], views: [SETTINGS_VIEW.INTEGRATIONS] });
  assert.equal(document.querySelector('[role="option"]'), null, "the palette closed");
});

/** The filter whose chip stands pressed. */
function chosenFilter(): string | null | undefined {
  return filterChips().find((each) => each.getAttribute("aria-pressed") === "true")?.textContent;
}

/** Presses a key in the search field, answering whether the field kept it for itself. */
function key(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    field().dispatchEvent(event);
  });
  return !event.defaultPrevented;
}

const LEFT = { key: "ArrowLeft", code: "ArrowLeft" } as const;
const RIGHT = { key: "ArrowRight", code: "ArrowRight" } as const;
const BACK = { key: "[", code: "BracketLeft", metaKey: true } as const;
const FORWARD = { key: "]", code: "BracketRight", metaKey: true } as const;

/** The footer's hints, each its keys and then its words. */
function footer(): (string | null)[] {
  return [...document.querySelectorAll(".command-palette-footer-hint")].map(
    (hint) => hint.textContent,
  );
}

test("with the field empty, ← and → step through the filters, wrapping at the ends", () => {
  openPalette();

  assert.equal(key(RIGHT), false, "the step is the palette's, not the caret's");
  assert.equal(chosenFilter(), "Tasks");
  key(RIGHT);
  assert.equal(chosenFilter(), "Agents");
  key(LEFT);
  key(LEFT);
  assert.equal(chosenFilter(), "All");
  key(LEFT);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(RIGHT);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
});

test("once anything is typed, ← and → only move the caret, even at the text's ends", () => {
  openPalette();
  type("invite");
  const input = field();

  for (const at of [0, 3, 6]) {
    input.setSelectionRange(at, at);
    assert.equal(key(LEFT), true, `← at ${at} is the caret's`);
    assert.equal(key(RIGHT), true, `→ at ${at} is the caret's`);
  }
  assert.equal(chosenFilter(), "All");
  assert.equal(input.value, "invite");
});

test("⌘[ and ⌘] step through the filters, wrapping at the ends, whether or not anything is typed", () => {
  openPalette();

  assert.equal(key(FORWARD), false, "the window's Forward is held off");
  assert.equal(chosenFilter(), "Tasks");
  type("invite");
  key(FORWARD);
  assert.equal(chosenFilter(), "Agents");
  assert.equal(key(BACK), false, "the window's Back is held off");
  key(BACK);
  key(BACK);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(FORWARD);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
  assert.equal(field().value, "invite", "the words stay as typed");
});

test("the footer names the keys that step the filters now: ← → while the field is empty, ⌘[ ⌘] once typed", () => {
  openPalette();
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);

  type("invite");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "⌘[⌘]Filter"]);

  type("");
  assert.deepEqual(footer(), ["↑↓Select", "⏎Open", "←→Filter"]);
});

/** The window behind the palette, running the menu bar's commands, its Back and Forward recorded. */
function MenuWindow({ moves }: { moves: string[] }): null {
  useMenuCommands(true);
  useAppCommand(APP_COMMAND.BACK, () => moves.push("back"));
  useAppCommand(APP_COMMAND.FORWARD, () => moves.push("forward"));
  return null;
}

test("the menu bar's Back and Forward, a mouse's side buttons among them, leave the window behind the palette alone", () => {
  let menuListener: ((command: AppCommand) => void) | undefined;
  fakeAppPlatform({
    onMenuCommand: (listener: (command: AppCommand) => void) => {
      menuListener = listener;
      return () => undefined;
    },
  });
  const moves: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(MenuWindow, { moves })));
  openPalette();

  act(() => menuListener?.(APP_COMMAND.BACK));
  act(() => menuListener?.(APP_COMMAND.FORWARD));
  assert.deepEqual(moves, []);
  assert.ok(field().isConnected, "the palette still stands");
  assert.equal(chosenFilter(), "All");
});

test("an agent's row hangs its tab's card beside it while the pointer rests on it, and choosing it opens the agent's tab", () => {
  const shown: [string, string][] = [];
  openPalette(
    tasksControl({
      activeTaskId: "plan-1",
      tasks: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
        },
      ],
      agents: codingAgentsControl({
        agents: [
          {
            id: "agent-7",
            planId: "plan-1",
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            title: "Invoice export",
            createdAt: 1,
            status: CODING_AGENT_STATUS.RUNNING,
            turnId: null,
          },
        ],
        agentIds: ["agent-7"],
      }),
      onShowAgent: (taskId, agentId) => shown.push([taskId, agentId]),
    }),
  );
  chooseFilter("Agents");
  assert.deepEqual(rows(), [
    "Inbox · Billing usage alerts",
    "Invoice export · Billing usage alerts",
  ]);
  const row = document.querySelectorAll<HTMLElement>('[role="option"]')[1];
  assert.ok(row, "the agent is listed");
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Invoice export");
  assert.equal(card?.querySelector(".luke-hover-card-corner")?.textContent, "Working…");
  press("Invoice export · Billing usage alerts");
  assert.deepEqual(shown, [["plan-1", "agent-7"]]);
});

test("an archived agent of the open task is still found, after the standing ones, saying it is archived, and choosing it opens its own page", () => {
  const shown: string[] = [];
  const agent = (id: string, title: string) => ({
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  });
  const base = tasksControl();
  openPalette(
    tasksControl({
      activeTaskId: "plan-1",
      tasks: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
        },
      ],
      agents: codingAgentsControl({
        agents: [agent("agent-7", "Invoice export")],
        archived: [{ ...agent("agent-8", "Refund export"), archivedAt: 3 }],
        agentIds: ["agent-7"],
      }),
      agentView: { ...base.agentView, onOpen: (agentId) => shown.push(agentId) },
    }),
  );
  chooseFilter("Agents");
  assert.deepEqual(rows(), [
    "Inbox · Billing usage alerts",
    "Invoice export · Billing usage alerts",
    "Refund export · Archived · Billing usage alerts",
  ]);

  type("refund");
  assert.deepEqual(rows(), ["Refund export · Archived · Billing usage alerts"]);
  press("Refund export · Archived · Billing usage alerts");
  assert.deepEqual(shown, ["agent-8"]);
});

test("an agent's card in ⌘K names the automation that started it, the listed workspace's automations read once around the window while the experiment is on, and none read while it is off", async () => {
  const automation = {
    id: "3f0e6f5c-7d1a-4f6e-9a55-000000000001",
    planId: null,
    planName: null,
    workspaceId: "workspace-acme",
    name: "Morning Sentry triage",
    enabled: true,
    pausedReason: null,
    trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage Sentry." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    lastRun: null,
    createdAt: 1,
  } as const;
  const listed: (string | undefined)[] = [];
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.AUTOMATIONS_LIST) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
      }
      listed.push(request.payload.workspaceId);
      const value = { automations: [automation] };
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value });
    },
  });
  const tasks = tasksControl({
    activeTaskId: "plan-1",
    workspace: {
      id: "workspace-acme",
      name: "Acme",
      slug: "acme",
      role: WORKSPACE_ROLE.MEMBER,
      github: null,
    },
    tasks: [
      {
        id: "plan-1",
        workspaceId: "workspace-acme",
        name: "Billing usage alerts",
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    agents: codingAgentsControl({
      agents: [
        {
          id: "agent-7",
          planId: "plan-1",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Invoice export",
          createdAt: 1,
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          automationId: automation.id,
        },
      ],
      agentIds: ["agent-7"],
    }),
  });
  /** The words "Started by" says on the agent's row's card in ⌘K, the experiment `on` or off. */
  const startedBy = async (on: boolean): Promise<string | null | undefined> => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    roots.push(root);
    const palette = createElement(WindowPalette, {
      available: true,
      tab: PANEL_TAB.TASKS,
      onTabChange: () => undefined,
      tasks,
      settings: {
        rows: {
          settings: settingsView(),
          voiceControlsDrawn: true,
          accountDrawn: true,
          capabilities: DESKTOP_CAPABILITIES,
        },
        capabilities: DESKTOP_CAPABILITIES,
        onViewChange: () => undefined,
      },
      readFiles: () => Promise.reject(new Error("no repository is open")),
    });
    act(() => root.render(createElement(ListedAutomations, { tasks, on, children: palette })));
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });
    act(() => {
      assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
    });
    chooseFilter("Agents");
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes("Invoice export"),
    );
    assert.ok(row, "the agent is listed");
    act(() => {
      row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const words = document.querySelector(
      ".luke-tooltip-card .actor-words [data-actor-ref]",
    )?.textContent;
    act(() => root.unmount());
    document.body.innerHTML = "";
    return words;
  };

  assert.equal(await startedBy(true), "Morning Sentry triage");
  assert.deepEqual(listed, ["workspace-acme"]);
  listed.length = 0;
  assert.equal(await startedBy(false), undefined);
  assert.deepEqual(listed, []);
});

test("an agent's Pull request row is named as its tab is, by its pull request's number and title, with the agent beside it, and is found by that number, that title, and the agent's name", () => {
  const agent = {
    id: "agent-7",
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invoice export",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  openPalette(
    tasksControl({
      activeTaskId: "plan-1",
      tasks: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
        },
      ],
      agents: codingAgentsControl({
        agents: [agent],
        agentIds: [agent.id],
        pullRequests: new Map([
          [
            agent.id,
            {
              number: 42,
              title: "Export invoices as CSV",
              url: "https://github.com/acme/billing/pull/42",
              state: PULL_REQUEST_STATE.OPEN,
              checks: CHECK_SUMMARY.PASSING,
              additions: 120,
              deletions: 8,
              changedFiles: 4,
            },
          ],
        ]),
      }),
    }),
  );
  const changes = "#42 Export invoices as CSV · Invoice export · Billing usage alerts";
  type("#42");
  assert.ok(rows().includes(changes), "found by its pull request's number");
  type("CSV");
  assert.ok(rows().includes(changes), "found by its pull request's title");
  type("Invoice export");
  assert.ok(rows().includes(changes), "found by its agent's name");
});

test("while an agent's page holds the side panel, ⌘K offers none of the open plan's panel tabs, workers, Changes, or files, which would open beside the agent", () => {
  const agent = {
    id: "agent-7",
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invoice export",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const control = tasksControl({});
  const read: string[] = [];
  openPalette(
    tasksControl({
      activeTaskId: DOCUMENT_TASK.id,
      tasks: [
        {
          id: DOCUMENT_TASK.id,
          workspaceId: DOCUMENT_TASK.workspaceId,
          name: DOCUMENT_TASK.name,
          createdAt: 1,
          updatedAt: 2,
          repository: "acme/relay",
        },
      ],
      region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, repository: "acme/relay" } },
      agentView: { ...control.agentView, agentId: "agent-page-1" },
      agents: codingAgentsControl({
        agents: [agent],
        agentIds: [agent.id],
        pullRequests: new Map([
          [
            agent.id,
            {
              number: 42,
              title: "Export invoices as CSV",
              url: "https://github.com/acme/billing/pull/42",
              state: PULL_REQUEST_STATE.OPEN,
              checks: CHECK_SUMMARY.PASSING,
              additions: 120,
              deletions: 8,
              changedFiles: 4,
            },
          ],
        ]),
      }),
    }),
    (taskId) => {
      read.push(taskId);
      return Promise.reject(new Error("not read here"));
    },
  );

  type("#42");
  const changes = rows().filter((row) => row.startsWith("Pull request"));
  type("Show board");
  const board = rows().filter((row) => row.startsWith("Show board"));
  chooseFilter("Files");
  type("index");
  const notice = document.querySelector(".command-palette-empty")?.textContent;

  assert.deepEqual([changes, board], [[], []]);
  assert.deepEqual(read, [], "the hidden task's files are not read");
  assert.equal(notice, "Open a task with a repository to search its files.");
});

test('a file found wears the look the side panel\'s "+" gives it, hangs its card with Luke\'s note, and opens through the panel\'s one door for a file, as the "+" row of a file whose tab stands does', async () => {
  const path = "src/invites/accept.ts";
  const note = "A used invite is refused here.";
  const showing: TaskCodeShowing = {
    callId: "c",
    turnId: "t",
    shownAt: 1_000,
    code: {
      ref: { path, startLine: 3, endLine: 5 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 9,
      lines: [],
      note,
    },
  };
  const opened: unknown[][] = [];
  const base = tasksControl();
  const sidePanel: SidePanelControl = {
    ...base.sidePanel,
    files: [{ path, range: { startLine: 3, endLine: 5 }, opened: 1 }],
    onOpenFile: (...asked) => opened.push(asked),
  };
  const tasks = tasksControl({
    activeTaskId: "plan-1",
    tasks: [
      {
        id: "plan-1",
        workspaceId: "workspace-personal",
        name: "Teammate invitations",
        createdAt: 1,
        updatedAt: 2,
        repository: "acme/relay",
      },
    ],
    sidePanel,
    shownCode: [showing],
  });
  openPalette(tasks, () =>
    Promise.resolve({
      folder: {
        path: "",
        repository: "acme/relay",
        branch: "main",
        entries: [{ name: path, kind: TASK_TREE_ENTRY.FILE }],
        truncated: false,
      },
    }),
  );
  chooseFilter("Files");
  await act(async () => undefined);
  assert.deepEqual(rows(), ["accept.ts · src/invites"]);

  const [plus] = panelEntries({
    panel: sidePanel,
    kinds: [],
    workers: [],
    files: shownFiles([showing]),
  });
  assert.ok(plus, 'the "+" offers the file');
  const row = document.querySelector<HTMLElement>('[role="option"]');
  assert.equal(
    row?.querySelector(".luke-combobox-option-glyph")?.innerHTML,
    renderToStaticMarkup(plus.row.icon),
    'the row wears the icon the "+" row does',
  );
  act(() => {
    row?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".luke-hover-card-name")?.textContent,
      card?.querySelector(".luke-hover-card-note")?.textContent,
    ],
    [path, note],
  );

  press("accept.ts · src/invites");
  act(() => plus.onPick());
  // Both name the file alone, so the tab it has is shown as it stands.
  assert.deepEqual(opened, [[{ path }], [{ path }]]);
});

test("Search lists the listed workspace's plans first, then every other workspace's, each naming its workspace by its tile and name and found by it", () => {
  const personal = {
    id: "workspace-personal",
    name: "Personal",
    role: WORKSPACE_ROLE.OWNER,
    github: null,
  };
  const northwind = {
    id: "workspace-northwind",
    name: "Northwind",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const task = (id: string, workspaceId: string, repository: string | null) => ({
    id,
    workspaceId,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository,
  });
  openPalette(
    tasksControl({
      workspaces: [personal, northwind],
      workspace: personal,
      tasks: [
        task("Checkout retries", northwind.id, "northwind/shop"),
        task("Dotfiles sync", personal.id, null),
      ],
    }),
  );
  chooseFilter("Tasks");
  const listed = rows();
  type("northwind");

  assert.deepEqual(listed, ["Dotfiles sync", "Checkout retries · Northwind · northwind/shop"]);
  assert.deepEqual(rows(), ["Checkout retries · Northwind · northwind/shop"]);
  assert.equal(
    document.querySelector(".luke-combobox-option-detail .workspace-ref .workspace-tile")
      ?.textContent,
    "N",
    "the other workspace is named by its tile and its name",
  );
});

test("a teammate's task wears its creator's face at its row's end, and is found by their name, which the row then says", () => {
  const charles = { userId: "user-charles", name: "Charles Pan" };
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const task = (id: string, by: typeof dean) => ({
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
    ownerId: by.userId,
    createdBy: by,
  });
  openPalette(
    tasksControl({
      me: dean.userId,
      tasks: [task("Retry budget", charles), task("Rate limits", dean)],
    }),
  );
  chooseFilter("Tasks");
  const faces = () =>
    [...document.querySelectorAll('[role="option"]')].map(
      (row) => row.querySelector(".luke-combobox-option-hint .actor-mark")?.textContent ?? null,
    );

  assert.deepEqual(rows(), ["Retry budget · acme/relay", "Rate limits · acme/relay"]);
  assert.deepEqual(faces(), ["C", null]);
  assert.match(
    document.querySelector(".luke-combobox-option-hint")?.textContent ?? "",
    /\(created by Charles Pan\)/u,
  );
  type("charles");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
  // A query the creator's name answers only loosely still shows the name it was found by,
  // and one the task's other words answer, however loosely, leaves the name unsaid.
  type("chrls");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
  type("rtry");
  assert.equal(rows()[0], "Retry budget · acme/relay");
  // A query running from the task's name into its creator's names them too.
  type("budgetch");
  assert.deepEqual(rows(), ["Retry budget · acme/relay · Charles Pan"]);
});

/** Offers ⌘K's own Show my tasks, as the sidebar does while it would change the list, and records each run. */
function OffersMyTasks({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.SHOW_MY_TASKS, () => ran.push("show my tasks"));
  return null;
}

test("a command ⌘K alone offers, the sidebar's Show my tasks, is listed by its name with no chord and runs from its row", () => {
  const ran: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(OffersMyTasks, { ran })));
  openPalette();
  type("my tasks");
  assert.ok(rows().includes("Show my tasks"), "Show my tasks is listed");
  const row = [...document.querySelectorAll('[role="option"]')][rows().indexOf("Show my tasks")];
  assert.equal(row?.querySelector(".luke-combobox-option-hint"), null, "no chord is printed");
  press("Show my tasks");
  assert.deepEqual(ran, ["show my tasks"]);
});

/** Main's clipboard, keeping each copy the window asks of it. */
function installClipboard(): string[] {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  return copied;
}

/** The toasts the window raises, drawn as the window draws them. */
function drawToasts(): void {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(createElement(ToastHost)));
}

const LINKED_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A task drawn in Acme, its agent's tab chosen in the work column and the agent named. */
const ON_AGENT_TAB: TasksControl = tasksControl({
  page: TASKS_PAGE.DOCUMENT,
  activeTaskId: DOCUMENT_TASK.id,
  region: {
    kind: DOCUMENT_REGION.READY,
    task: { ...DOCUMENT_TASK, workspaceId: "workspace-acme" },
  },
  workspaces: [
    { id: "workspace-acme", name: "Acme", slug: "acme", role: WORKSPACE_ROLE.MEMBER, github: null },
  ],
  mainTabs: { ...tasksControl().mainTabs, tab: { agent: LINKED_AGENT } },
  agents: codingAgentsControl({
    agents: [
      {
        id: LINKED_AGENT,
        planId: DOCUMENT_TASK.id,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Expire old invites",
        createdAt: 3,
        status: CODING_AGENT_STATUS.RUNNING,
        turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
      },
    ],
  }),
});

test("on a task's agent's tab, ⌘K offers Copy link to the agent, wearing ⌥⌘C, then to the task, and choosing one copies its link and says Link copied", async () => {
  const copied = installClipboard();
  drawToasts();
  openPalette(ON_AGENT_TAB);
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  const chord = document.querySelector('[role="option"] .luke-combobox-option-hint')?.textContent;

  press("Copy link to agent · Expire old invites");
  await act(async () => undefined);

  assert.deepEqual(listed, [
    "Copy link to agent · Expire old invites",
    `Copy link to task · ${DOCUMENT_TASK.name}`,
  ]);
  assert.equal(chord, "⌥⌘C");
  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}/agent/${LINKED_AGENT}`,
  ]);
  assert.equal(newestToastSays(), "Link copied");
});

test("⌥⌘C copies the link of what is open, the most specific first: the Inbox's item over the Inbox, an automation over the list, the task under its tabs", async () => {
  const copied = installClipboard();
  const automationId = "6e2f3a4b-5c6d-4e7f-8a91-92a3b4c5d6e7";
  const itemId = "5d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
  const listed = { workspaces: ON_AGENT_TAB.workspaces, workspace: ON_AGENT_TAB.workspaces[0] };
  for (const tasks of [
    ON_AGENT_TAB,
    tasksControl({
      ...listed,
      inboxView: {
        ...tasksControl().inboxView,
        open: true,
        chosen: { agentId: LINKED_AGENT, itemId },
      },
    }),
    tasksControl({
      ...listed,
      automationsView: {
        ...tasksControl().automationsView,
        open: true,
        place: { kind: AUTOMATIONS_PAGE.EDIT, automationId },
      },
    }),
    tasksControl({ ...listed, factoryView: { ...tasksControl().factoryView, open: true } }),
  ]) {
    openPalette(tasks);
    act(() => {
      runAppCommand(APP_COMMAND.COMMAND_PALETTE);
      runAppCommand(APP_COMMAND.COPY_LINK);
    });
    await act(async () => undefined);
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
  }

  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}/agent/${LINKED_AGENT}`,
    `https://tryluke.dev/acme/agent/${LINKED_AGENT}/inbox/${itemId}`,
    `https://tryluke.dev/acme/automation/${automationId}`,
    "https://tryluke.dev/acme/factory",
  ]);
});

test("on a person's page, over an open Inbox, ⌘K offers Copy link to profile and ⌥⌘C copies their page's link in the workspace it opened in", async () => {
  const copied = installClipboard();
  const [acme] = ON_AGENT_TAB.workspaces;
  openPalette(
    tasksControl({
      workspaces: ON_AGENT_TAB.workspaces,
      workspace: acme,
      inboxView: { ...tasksControl().inboxView, open: true },
      personView: {
        ...tasksControl().personView,
        userId: "user-charles",
        workspaceId: acme?.id,
      },
    }),
  );
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await act(async () => undefined);

  assert.deepEqual(listed, ["Copy link to profile"]);
  assert.deepEqual(copied, ["https://tryluke.dev/acme/person/user-charles"]);
});

test("on an issue's page ⌘K offers Copy link to issue and ⌥⌘C copies its link in the listed workspace", async () => {
  const copied = installClipboard();
  const issueId = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
  openPalette(
    tasksControl({
      workspaces: ON_AGENT_TAB.workspaces,
      workspace: ON_AGENT_TAB.workspaces[0],
      issuesView: {
        ...tasksControl().issuesView,
        open: true,
        place: { kind: ISSUES_PAGE.ISSUE, issueId },
      },
    }),
  );
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await act(async () => undefined);

  assert.deepEqual(listed, ["Copy link to issue"]);
  assert.deepEqual(copied, [`https://tryluke.dev/acme/issue/${issueId}`]);
});

test("on the Issues list over an open task nothing has a link, so ⌘K lists no Copy link and ⌥⌘C copies nothing", async () => {
  const copied = installClipboard();
  openPalette({
    ...ON_AGENT_TAB,
    issuesView: { ...ON_AGENT_TAB.issuesView, open: true, place: { kind: ISSUES_PAGE.LIST } },
  });
  type("copy link");
  const listed = rows().filter((row) => row.startsWith("Copy link to "));
  act(() => runAppCommand(APP_COMMAND.COPY_LINK));
  await act(async () => undefined);

  assert.deepEqual(listed, []);
  assert.deepEqual(copied, []);
});

test("on the home page nothing has a link, so ⌥⌘C is not offered and ⌘K lists no Copy link", () => {
  openPalette(tasksControl());
  type("copy link");

  assert.deepEqual(
    rows().filter((row) => row.startsWith("Copy link to ")),
    [],
  );
  assert.equal(appCommandOffered(APP_COMMAND.COPY_LINK), false);
});

test("with the side panel filling the window over an agent's tab, ⌥⌘C copies the panel's tab, which is what shows", async () => {
  const copied = installClipboard();
  openPalette(
    tasksControl({
      ...ON_AGENT_TAB,
      sidePanel: {
        ...ON_AGENT_TAB.sidePanel,
        open: true,
        fullScreen: true,
        tab: SIDE_PANEL_TAB.CALL,
      },
    }),
  );
  act(() => {
    runAppCommand(APP_COMMAND.COMMAND_PALETTE);
    runAppCommand(APP_COMMAND.COPY_LINK);
  });
  await act(async () => undefined);

  assert.deepEqual(copied, [`https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}/call`]);
});

test("⌘K pressed with the keyboard in the side panel offers its tab's link first, wearing ⌥⌘C, as ⌥⌘C there copies", () => {
  const panel = document.body.appendChild(document.createElement("div"));
  panel.className = "side-panel";
  const field = panel.appendChild(document.createElement("button"));
  field.focus();
  openPalette(
    tasksControl({
      ...ON_AGENT_TAB,
      sidePanel: { ...ON_AGENT_TAB.sidePanel, open: true, tab: SIDE_PANEL_TAB.CALL },
    }),
  );
  type("copy link");
  const chord = document.querySelector('[role="option"] .luke-combobox-option-hint')?.textContent;

  assert.deepEqual(
    rows().filter((row) => row.startsWith("Copy link to ")),
    [
      "Copy link to call",
      "Copy link to agent · Expire old invites",
      `Copy link to task · ${DOCUMENT_TASK.name}`,
    ],
  );
  assert.equal(chord, "⌥⌘C");
});

test("on an agent's page in another workspace than the one listed, ⌥⌘C names the agent's workspace, which the page read", async () => {
  const copied = installClipboard();
  openPalette(
    tasksControl({
      workspaces: [
        ...ON_AGENT_TAB.workspaces,
        {
          id: "workspace-beta",
          name: "Beta",
          slug: "beta",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
        },
      ],
      workspace: ON_AGENT_TAB.workspaces[0],
      agentView: { ...tasksControl().agentView, agentId: LINKED_AGENT },
    }),
    undefined,
    { agentId: LINKED_AGENT, workspaceId: "workspace-beta" },
  );
  act(() => {
    runAppCommand(APP_COMMAND.COPY_LINK);
  });
  await act(async () => undefined);

  assert.deepEqual(copied, [`https://tryluke.dev/beta/agent/${LINKED_AGENT}`]);
});

test("People lists the listed workspace's members by name and role, the reader as You, found by email too, and a choice opens their page", async () => {
  const members = [
    {
      userId: "user-dean",
      name: "Dean Stratakos",
      email: "dean@example.com",
      role: WORKSPACE_ROLE.OWNER,
    },
    {
      userId: "user-charles",
      name: "Charles Pan",
      email: "charles@example.com",
      role: WORKSPACE_ROLE.MEMBER,
    },
  ];
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? { status: ACT_OUTCOME_STATUS.DONE, value: members }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      ),
  });
  const opened: string[] = [];
  const base = tasksControl();
  const sent = openPalette(
    tasksControl({
      me: "user-dean",
      workspace: { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null },
      personView: { ...base.personView, onOpen: (userId) => opened.push(userId) },
    }),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  chooseFilter("People");

  assert.deepEqual(rows(), ["Dean Stratakos · You · Owner", "Charles Pan · Member"]);
  type("charles@");
  assert.deepEqual(rows(), ["Charles Pan · Member"]);
  act(() => document.querySelector<HTMLElement>('[role="option"]')?.click());
  assert.deepEqual(opened, ["user-charles"]);
  assert.deepEqual(sent.tabs, []);
});

/** What the list says where no row stands: its notice, or "Nothing matches.". */
function emptyLine(): string | undefined {
  return document.querySelector(".command-palette-empty")?.textContent ?? undefined;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** A window whose members read is answered by `members`, every other act refused. */
function membersAnswer(members: () => Promise<ActOutcome>): void {
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> =>
      request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
        ? members()
        : Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
}

const ACME = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };

test("under All, a query nothing else matches says the repository's files are still being read rather than that nothing matches, and the files found follow", async () => {
  let answer: (listed: TasksTreeAnswer) => void = () => undefined;
  const tasks = tasksControl({
    activeTaskId: "plan-1",
    tasks: [
      {
        id: "plan-1",
        workspaceId: "workspace-personal",
        name: "Teammate invitations",
        createdAt: 1,
        updatedAt: 2,
        repository: "acme/relay",
      },
    ],
  });
  membersAnswer(() => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }));
  openPalette(
    { ...tasks, workspace: ACME },
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  await settle();
  type("zqx");

  assert.deepEqual(rows(), []);
  assert.equal(emptyLine(), "Reading the repository's files…");
  assert.equal(document.querySelector(".command-palette-empty")?.getAttribute("role"), "status");

  await act(async () =>
    answer({
      folder: {
        path: "",
        repository: "acme/relay",
        branch: "main",
        entries: [{ name: "src/zqx.ts", kind: TASK_TREE_ENTRY.FILE }],
        truncated: false,
      },
    }),
  );
  assert.deepEqual(rows(), ["zqx.ts · src"]);

  type("nothing-at-all");
  assert.equal(emptyLine(), "Nothing matches.", "once every source answered, it says so");
});

test("People says the members are being read until they answer, and a refused read says so with a Retry that reads them again", async () => {
  const member = {
    userId: "user-charles",
    name: "Charles Pan",
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
  };
  let answers: ((outcome: ActOutcome) => void)[] = [];
  membersAnswer(
    () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
  );
  openPalette(tasksControl({ me: "user-dean", workspace: ACME }));
  chooseFilter("People");
  await settle();
  assert.equal(emptyLine(), "Reading the workspace's members…");

  await act(async () => answers.shift()?.({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "No." }));
  await settle();
  const alert = document.querySelector(".command-palette-empty [role=alert]");
  assert.match(alert?.textContent ?? "", /The workspace's members could not be read\./u);
  assert.doesNotMatch(document.body.textContent ?? "", /Nothing matches/u);

  answers = [];
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry, "Retry is offered");
  act(() => retry.click());
  await settle();
  assert.equal(emptyLine(), "Reading the workspace's members…");
  await act(async () => answers.shift()?.({ status: ACT_OUTCOME_STATUS.DONE, value: [member] }));
  await settle();
  assert.deepEqual(rows(), ["Charles Pan · Member"]);
});

test("Tasks says the account's tasks are being read before the list first answers", () => {
  membersAnswer(() => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }));
  openPalette(tasksControl({ workspace: ACME, listRead: false }));
  chooseFilter("Tasks");
  assert.equal(emptyLine(), "Reading your tasks…");
  assert.doesNotMatch(document.body.textContent ?? "", /Nothing matches/u);
});

test("Tasks says a refused list with a Retry that reads it again", () => {
  const retried: number[] = [];
  membersAnswer(() => Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: [] }));
  openPalette(
    tasksControl({
      workspace: ACME,
      listRead: false,
      listFailed: true,
      onRetryList: () => retried.push(1),
    }),
  );
  chooseFilter("Tasks");
  const alert = document.querySelector(".command-palette-empty [role=alert]");
  assert.match(alert?.textContent ?? "", /Your tasks could not be read\./u);
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Retry",
  );
  act(() => retry?.click());
  assert.deepEqual(retried, [1]);
});

test("on a one-off agent's page, ⌘K offers Pin agent, or Unpin agent once it is pinned, and nothing for an archived agent", () => {
  const asked: string[] = [];
  const agent = {
    id: "agent-9",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Triage overnight issues",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-1",
    repository: "acme/relay",
    activityAt: 2,
  };
  /** The rows ⌘K lists for "pin" over the agent's page, standing as given. */
  const pinRows = (standing: readonly (typeof agent & { pinnedAt?: number })[], archived = []) => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    openPalette(
      tasksControl({
        agentView: { agentId: agent.id, onOpen: () => undefined, onClose: () => undefined },
        listedAgents: { standing, archived },
        onPinAgent: (agentId, pinned) => asked.push(`${agentId}:${String(pinned)}`),
      }),
    );
    type("pin");
    return rows().filter((row) => /^(Pin|Unpin) agent$/u.test(row));
  };

  assert.deepEqual(pinRows([agent]), ["Pin agent"]);
  press("Pin agent");
  assert.deepEqual(pinRows([{ ...agent, pinnedAt: 3 }]), ["Unpin agent"]);
  press("Unpin agent");
  assert.deepEqual(pinRows([]), []);
  assert.deepEqual(asked, ["agent-9:true", "agent-9:false"]);
});

/** The task on screen, listed in the sidebar beside the palette, its pin landing where the row menu's would. */
function PinnableTask(): React.JSX.Element {
  const [listed, setListed] = useState<Task>(DOCUMENT_TASK);
  const tasks = tasksControl({
    tasks: [listed],
    region: { kind: DOCUMENT_REGION.READY, task: listed },
    activeTaskId: listed.id,
    onMarkTask: (taskId, mark) => {
      assert.equal(taskId, listed.id);
      setListed(mark === TASK_MARK.PIN ? { ...DOCUMENT_TASK, pinnedAt: 5 } : DOCUMENT_TASK);
    },
  });
  return createElement(
    Fragment,
    null,
    createElement(Looker, { looked: listed }),
    createElement(DesktopSidebar, sidebarProps(tasks)),
    createElement(WindowPalette, {
      available: true,
      tab: PANEL_TAB.TASKS,
      onTabChange: () => undefined,
      tasks: tasks,
      settings: {
        rows: {
          settings: settingsView(),
          voiceControlsDrawn: true,
          accountDrawn: true,
          capabilities: DESKTOP_CAPABILITIES,
        },
        capabilities: DESKTOP_CAPABILITIES,
        onViewChange: () => undefined,
      },
      readFiles: () => Promise.reject(new Error("no repository is open")),
    }),
  );
}

/** The names the sidebar's Pinned section lists, none while it stands nowhere. */
function pinnedNames(): (string | null)[] {
  const section = document.querySelector('nav[aria-label="Pinned"]');
  return [...(section?.querySelectorAll(".luke-list-row-title") ?? [])].map(
    (name) => name.firstChild?.textContent ?? null,
  );
}

/** The rows ⌘K lists for "pin", the palette opened afresh. */
function pinRows(): string[] {
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
  type("pin");
  return rows().filter((row) => /^(Pin|Unpin) /u.test(row));
}

test("with a task open, ⌘K offers Pin task, which pins it under Pinned and turns to Unpin task", () => {
  // The sidebar asks whether motion is reduced, which jsdom cannot answer.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(PinnableTask))));

  assert.deepEqual(pinRows(), ["Pin task"]);
  press("Pin task");
  assert.deepEqual(pinnedNames(), [DOCUMENT_TASK.name]);
  assert.deepEqual(pinRows(), ["Unpin task"]);
  press("Unpin task");
  assert.deepEqual(pinnedNames(), []);
  assert.deepEqual(pinRows(), ["Pin task"]);
});

/** The palette over the task given, under a registry of its own that reads the window's state as handed. */
async function paletteUnderState(tasks: TasksControl): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(WindowPalette, {
          available: true,
          tab: PANEL_TAB.TASKS,
          onTabChange: () => undefined,
          tasks,
          settings: {
            rows: {
              settings: settingsView(),
              voiceControlsDrawn: true,
              accountDrawn: true,
              capabilities: DESKTOP_CAPABILITIES,
            },
            capabilities: DESKTOP_CAPABILITIES,
            onViewChange: () => undefined,
          },
          readFiles: () => Promise.reject(new Error("no repository is open")),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
  });
}

test("⌘K offers the open task's Chat tab only while the account has Chat on", async () => {
  const tasks = tasksControl({
    activeTaskId: "plan-1",
    tasks: [
      {
        id: "plan-1",
        workspaceId: "workspace-personal",
        name: "Billing usage alerts",
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    chatView: { ...tasksControl().chatView, available: true },
  });
  handState(experimentsOn(EXPERIMENT.CHAT));
  await paletteUnderState(tasks);
  chooseFilter("Agents");
  assert.ok(rows().includes("Chat · Billing usage alerts"), "Chat on offers the task's Chat");
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  handState({});
  await paletteUnderState(tasks);
  chooseFilter("Agents");
  assert.ok(!rows().some((row) => row.startsWith("Chat")), "Chat off offers no Chat");
});

/** An issue of Acme's, numbered and titled, standing in the status given. */
function acmeIssue(number: number, title: string, status: Issue["status"]): Issue {
  return {
    id: `3f0e6f5c-7d1a-4f6e-9a55-${String(number).padStart(12, "0")}`,
    workspaceId: ACME.id,
    number,
    title,
    description: "",
    status,
    priority: ISSUE_PRIORITY.NONE,
    creator: null,
    archivedAt: null,
    createdAt: number,
    updatedAt: number,
  };
}

/** A window whose issues list answers `issues` for the workspace asked, every other act refused; the workspaces asked for, in order. */
function issuesAnswer(issues: () => Promise<ActOutcome>): string[] {
  const asked: string[] = [];
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.ISSUES_LIST) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
      }
      asked.push(request.payload.workspaceId);
      return issues();
    },
  });
  return asked;
}

test("with Issues on, ⌘K finds the listed workspace's issues by title or identifier under Issues, and Enter opens the issue's page", async () => {
  const fix = acmeIssue(12, "Fix the login redirect", ISSUE_STATUS.IN_PROGRESS);
  const asked = issuesAnswer(() =>
    Promise.resolve({
      status: ACT_OUTCOME_STATUS.DONE,
      value: { issues: [fix, acmeIssue(7, "Billing alerts", ISSUE_STATUS.TODO)] },
    }),
  );
  handState(experimentsOn(EXPERIMENT.ISSUES));
  const opened: unknown[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    workspace: ACME,
    issuesView: { ...base.issuesView, onOpen: (place) => opened.push(place) },
  });
  await paletteUnderState(tasks);
  await settle();

  type("login redir");
  assert.deepEqual(rows(), ["Fix the login redirect · ACME-12 · In progress"]);
  const group = document.querySelector('[role="option"]')?.closest("[cmdk-group]");
  assert.equal(group?.querySelector("[cmdk-group-heading]")?.textContent, "Issues");
  type("ACME-7");
  assert.equal(rows()[0], "Billing alerts · ACME-7 · Todo");
  key({ key: "Enter", code: "Enter" });
  await settle();

  assert.deepEqual(asked, [ACME.id]);
  assert.deepEqual(opened, [
    { kind: ISSUES_PAGE.ISSUE, issueId: acmeIssue(7, "", ISSUE_STATUS.TODO).id },
  ]);
});

test("with Issues off, ⌘K draws no Issues filter, lists no issue, and reads none", async () => {
  const asked = issuesAnswer(() =>
    Promise.resolve({
      status: ACT_OUTCOME_STATUS.DONE,
      value: { issues: [acmeIssue(12, "Fix the login redirect", ISSUE_STATUS.TODO)] },
    }),
  );
  handState({});
  await paletteUnderState(tasksControl({ workspace: ACME }));
  await settle();
  type("login redirect");

  assert.ok(!filterChips().some((chip) => chip.textContent === "Issues"));
  assert.deepEqual(rows(), []);
  assert.deepEqual(asked, []);
});

test("Issues says the issues are being read until they answer, and a refused read says so with a Retry that reads them again", async () => {
  let answer: (outcome: ActOutcome) => void = () => undefined;
  const asked = issuesAnswer(
    () =>
      new Promise<ActOutcome>((resolve) => {
        answer = resolve;
      }),
  );
  handState(experimentsOn(EXPERIMENT.ISSUES));
  await paletteUnderState(tasksControl({ workspace: ACME }));
  chooseFilter("Issues");
  assert.equal(emptyLine(), "Reading the workspace's issues…");

  answer({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
  await settle();
  assert.match(emptyLine() ?? "", /The workspace's issues could not be read\./u);
  const retry = [...document.querySelectorAll("button")].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry, "Retry is offered");
  act(() => retry.click());
  assert.equal(asked.length, 2, "Retry reads the issues again");
});
