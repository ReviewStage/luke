// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxChanged,
  INBOX_SCOPE_KIND,
} from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_KIND,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_FIELD,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
} from "@luke/features/inbox-wire";
import { PLAN_ACTOR, TASK_TREE_ENTRY, type Task, type TaskSummary } from "@luke/features/task-wire";
import type { TaskCodeShowing, TasksTreeAnswer } from "@luke/features/tasks-view";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActResult } from "@luke/host/contract";
import { EXPERIMENT, HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { SETTINGS_VIEW, type SettingsView } from "@luke/settings/settings-views";
import { APP_COMMAND, type AppCommand } from "@luke/settings/shortcuts";
import { experimentsOn, settingsView } from "@luke/settings/testing";
import { DOCUMENT_REGION, TASK_MARK, TASKS_PAGE } from "@luke/ui/tasks-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  appCommandOffered,
  runAppCommand,
  useAppCommand,
  useMenuCommands,
} from "../app-commands.js";
import { PageWorkspaceProvider, useCopyLink, usePageWorkspace } from "../links-at-hand.js";
import { installPanelSpanRecorder, PANEL_SPAN, type PanelSpan } from "../panel-spans.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { SIDE_PANEL_TAB, type SidePanelControl } from "../tasks/use-side-panel.js";
import { NO_LOOKS, useTaskLooks } from "../tasks/use-task-looks.js";
import { AUTOMATIONS_PAGE, type InboxChoice, type TasksControl } from "../tasks/use-tasks-tab.js";
import {
  fakeActPort,
  fakeActPortAnswering,
  fakeActPortCalls,
  fakeAppBridge,
  refusedOnPort,
  type SentPortAct,
} from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handCapabilities, handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { keyPressed, reportEventTiming } from "../testing/event-timing.js";
import { followedInboxes } from "../testing/followed-inboxes.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { CommandPalette } from "./command-palette.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { DesktopTasks } from "./desktop-tasks.js";
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
  tab: PanelTab = PANEL_TAB.TASKS,
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
        tab,
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
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]');
  assert.ok(input, "the search field is drawn");
  return input;
}

/** The options of the radio group named Filter. */
function filterOptions(): HTMLButtonElement[] {
  const group = document.querySelector('[role="radiogroup"][aria-label="Filter"]');
  assert.ok(group, "the filters are drawn");
  return [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

function chooseFilter(name: string): void {
  const option = filterOptions().find((each) => each.textContent === name);
  assert.ok(option, `the ${name} filter is drawn`);
  act(() => option.click());
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

/** Each row the palette lists, as what leads it, its name, and the muted words after it. */
function rows(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((row) =>
    [
      row.querySelector(".luke-combobox-option-lead"),
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

/** The Settings pages by their names, in the order the palette lists them: Account's own page is Account, and the Workspace page, whose head names the listed workspace, is Workspace here. */
const SETTINGS_PAGES = [
  "Account",
  "Workspace",
  "Agents",
  "Integrations",
  "Skills",
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

test("the Settings filter lists Memory after Workspace only while the account has the Memory experiment on", async () => {
  handState(experimentsOn(EXPERIMENT.MEMORY));
  await paletteUnderState(tasksControl());
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, 3), ["Account", "Workspace", "Memory"]);
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  handState({});
  await paletteUnderState(tasksControl());
  chooseFilter("Settings");
  assert.ok(!rows().includes("Memory"), "Memory off lists no Memory page");
});

test("on a platform without voice or Mac commands, the Settings filter lists neither page, and finds none of their rows", () => {
  const offered = DESKTOP_CAPABILITIES.filter(
    (each) => each !== HOST_CAPABILITY.VOICE && each !== HOST_CAPABILITY.MAC_COMMANDS,
  );
  const shown = SETTINGS_PAGES.filter((page) => page !== "Voice" && page !== "This Mac");
  openPalette(undefined, undefined, undefined, offered);
  chooseFilter("Settings");

  assert.deepEqual(rows().slice(0, shown.length), shown);
  type("Quiet Music and Spotify");
  assert.equal(
    rows().some((row) => row.includes("Quiet Music and Spotify")),
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
  type("agents");
  assert.equal(rows()[0], "Agents");
});

test('"the" finds Theme, marking the words it begins, while "thm" finds no Theme, since only a file or a command is found by letters in order', () => {
  openPalette();

  type("the");
  const theme = [...document.querySelectorAll('[role="option"]')].find(
    (row) => row.querySelector(".luke-combobox-option-label")?.textContent === "Theme",
  );
  assert.ok(theme, '"the" finds Theme');
  assert.deepEqual(
    [...theme.querySelectorAll(".luke-combobox-option-label mark")].map((mark) => mark.textContent),
    ["The"],
  );
  type("thm");
  assert.equal(
    rows().some((row) => row.startsWith("Theme")),
    false,
  );
});

test("a key typed in ⌘K stands in its field at once, and the rows are ranked for it in a render of their own after", async () => {
  openPalette();
  chooseFilter("Settings");
  const before = rows();

  // Note that the key goes in outside `act`, which would draw the ranking's own render with it, so the paint the key gets is the one read.
  const input = field();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  flushSync(() => {
    setValue?.call(input, "agents");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const painted = { typed: field().value, rows: rows() };
  await act(() => Promise.resolve());

  assert.deepEqual(painted, { typed: "agents", rows: before });
  assert.equal(rows()[0], "Agents");
});

test("a Return pressed before the rows are ranked for the words typed chooses the row they rank first, never one the earlier words ranked or highlighted", async () => {
  const sent = openPalette();
  chooseFilter("Settings");
  key({ key: "ArrowDown" });
  key({ key: "ArrowDown" });

  // Note that the key and the Return go in outside `act`, which would draw the ranking's own render between them.
  const input = field();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  flushSync(() => {
    setValue?.call(input, "integrations");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  flushSync(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  const before = { tabs: [...sent.tabs], views: [...sent.views] };
  await act(() => Promise.resolve());

  assert.deepEqual(before, { tabs: [], views: [] }, "nothing chosen from the earlier rows");
  assert.deepEqual(sent, { tabs: [PANEL_TAB.SETTINGS], views: [SETTINGS_VIEW.INTEGRATIONS] });
});

test("a Return held for its words is let go once other words are typed before they are ranked, choosing nothing", async () => {
  const sent = openPalette();
  chooseFilter("Settings");

  // Note that the keys and the Return go in outside `act`, which would draw the ranking's own render between them.
  const input = field();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const typeNow = (words: string) =>
    flushSync(() => {
      setValue?.call(input, words);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  typeNow("integrations");
  flushSync(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  typeNow("agents");
  await act(() => Promise.resolve());

  assert.deepEqual(sent, { tabs: [], views: [] });
  assert.equal(rows()[0], "Agents", "the palette stands, ranked for the words now typed");
});

test("choosing a page opens Settings on that page", () => {
  const sent = openPalette();
  chooseFilter("Settings");

  press("Integrations");

  assert.deepEqual(sent, { tabs: [PANEL_TAB.SETTINGS], views: [SETTINGS_VIEW.INTEGRATIONS] });
  assert.equal(document.querySelector('[role="option"]'), null, "the palette closed");
});

/** The filter standing checked. */
function chosenFilter(): string | null | undefined {
  return filterOptions().find((each) => each.getAttribute("aria-checked") === "true")?.textContent;
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

/** The footer's hints, each its keys and then its words: the hints along the foot, the last thing the palette draws. */
function footer(): (string | null)[] {
  return [...(document.querySelector("[cmdk-root]")?.lastElementChild?.children ?? [])].map(
    (hint) => hint.textContent,
  );
}

test("with the field empty, ← and → step through the filters, wrapping at the ends", () => {
  openPalette();

  assert.equal(key(RIGHT), false, "the step is the palette's, not the caret's");
  assert.equal(chosenFilter(), "Tasks");
  key(RIGHT);
  assert.equal(chosenFilter(), "This task");
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
  assert.equal(chosenFilter(), "This task");
  assert.equal(key(BACK), false, "the window's Back is held off");
  key(BACK);
  key(BACK);
  assert.equal(chosenFilter(), "Settings", "stepping back from All wraps to the last filter");
  key(FORWARD);
  assert.equal(chosenFilter(), "All", "stepping on from the last filter wraps to All");
  assert.equal(field().value, "invite", "the words stay as typed");
});

test("a press on a filter chooses it and leaves the caret in the field, no filter taking the keyboard", () => {
  openPalette();
  type("invite");
  act(() => field().focus());
  assert.deepEqual(
    filterOptions().filter((each) => each.tabIndex >= 0),
    [],
    "no filter is a tab stop",
  );
  const agents = filterOptions().find((each) => each.textContent === "This task");
  assert.ok(agents);
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    agents.dispatchEvent(down);
  });
  assert.equal(down.defaultPrevented, true, "the press does not move the keyboard");
  act(() => agents.click());
  assert.equal(chosenFilter(), "This task");
  assert.equal(document.activeElement, field(), "the caret stays in the field");
  assert.equal(field().value, "invite");
});

test("in a row too narrow for every filter, the filter a key chooses is scrolled into view along the row alone", () => {
  openPalette();
  const bar = document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Filter"]');
  assert.ok(bar);
  // Note that the test lays the row out itself, a hundred pixels wide with each filter fifty, because jsdom lays nothing out.
  Object.defineProperty(bar, "clientWidth", { configurable: true, value: 100 });
  filterOptions().forEach((option, at) => {
    Object.defineProperty(option, "offsetLeft", { configurable: true, value: at * 50 });
    Object.defineProperty(option, "offsetWidth", { configurable: true, value: 50 });
  });
  key(FORWARD);
  assert.equal(bar.scrollLeft, 0, "Tasks already stands in view");
  key(FORWARD);
  assert.equal(chosenFilter(), "This task");
  assert.equal(bar.scrollLeft, 50);
  key(BACK);
  key(BACK);
  key(BACK);
  assert.equal(chosenFilter(), "Settings");
  assert.equal(bar.scrollLeft, 300);
  key(FORWARD);
  assert.equal(chosenFilter(), "All");
  assert.equal(bar.scrollLeft, 0);
  assert.equal(document.activeElement, field(), "the caret stays in the field");
});

test("the footer names the keys that step the filters now: ← → while the field is empty, ⌘[ ⌘] once typed", () => {
  openPalette();
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Open", "←→ Filter"]);

  type("invite");
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Open", "⌘[⌘] Filter"]);

  type("");
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Open", "←→ Filter"]);
});

/** Offers the Inbox and Tasks, which open places, and Show my tasks, which no menu offers and so wears no glyph of its own. */
function OffersPlaces(): null {
  useAppCommand(APP_COMMAND.INBOX, () => undefined);
  useAppCommand(APP_COMMAND.TASKS, () => undefined);
  useAppCommand(APP_COMMAND.SHOW_MY_TASKS, () => undefined);
  return null;
}

/** The palette over a window offering `OffersPlaces`'s commands. */
function openPaletteOverPlaces(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(OffersPlaces)));
  openPalette();
}

test("the footer says Return runs a command chosen and opens anything else", () => {
  openPaletteOverPlaces();

  type("go to inbox");
  assert.equal(rows()[0], "Go to inbox");
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Run", "⌘[⌘] Filter"]);

  type("theme");
  assert.equal(rows()[0], "Theme · Appearance");
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Open", "⌘[⌘] Filter"]);
});

test("⌘K says a place it opens as Go to the place, and the menus' own words stand for the rest", () => {
  openPaletteOverPlaces();
  chooseFilter("Commands");

  assert.ok(rows().includes("Go to inbox"));
  assert.ok(rows().includes("Go to tasks"));
  assert.ok(rows().includes("Show my tasks"));
  assert.ok(!rows().includes("Inbox"), "the place is never said bare, as a verb would be");
});

test("every row in Commands keeps a glyph's room, so a command no menu marks names itself at the edge the others do", () => {
  openPaletteOverPlaces();
  chooseFilter("Commands");

  const options = [...document.querySelectorAll('[role="group"] [role="option"]')];
  assert.ok(options.length > 0, "commands are listed");
  for (const option of options) {
    assert.ok(
      option.querySelector(".luke-combobox-option-glyph"),
      `${option.textContent} keeps the glyph's room`,
    );
  }
});

test("the field asks to search Luke under All, and the kind under its filter", () => {
  openPalette();
  assert.equal(field().placeholder, "Search Luke");

  chooseFilter("This task");
  assert.equal(field().placeholder, "Search this task");
  chooseFilter("Commands");
  assert.equal(field().placeholder, "Search commands");
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
  chooseFilter("This task");
  assert.deepEqual(rows(), [
    "Inbox · Billing usage alerts",
    "Invoice export · Billing usage alerts",
  ]);
  const row = document.querySelectorAll<HTMLElement>('[role="option"]')[1];
  assert.ok(row, "the agent is listed");
  restOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Invoice export");
  assert.equal(card?.querySelector(".luke-hover-card-corner")?.textContent, undefined);
  assert.ok(
    card?.querySelector('.actor-card-head .state-glyph[data-state="working"]'),
    "the card's tile wears the working mark in its harness's place",
  );
  press("Invoice export · Billing usage alerts");
  assert.deepEqual(shown, [["plan-1", "agent-7"]]);
});

test("an agent with no task hangs its card beside its row and is named as its tab is, by the model catalog", () => {
  const agent = {
    id: "agent-5",
    planId: null,
    title: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-1",
    repository: null,
    activityAt: 2,
  };
  openPalette(
    tasksControl({
      agents: codingAgentsControl({
        models: [
          {
            id: "anthropic/claude-opus-5.5",
            name: "Cataloged Opus",
            provider: "anthropic",
            efforts: ["high"],
          },
        ],
      }),
      listedAgents: { standing: [agent], archived: [] },
    }),
  );
  chooseFilter("Tasks");
  assert.ok(rows().includes("Cataloged Opus"), "named by the catalog, as its tab is");
  const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
    option.textContent?.includes("Cataloged Opus"),
  );
  assert.ok(row, "the agent is listed");
  restOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Cataloged Opus");
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
  chooseFilter("This task");
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

test("an agent's card in ⌘K names the automation that started it, the listed workspace's automations read once around the window", async () => {
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
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.AUTOMATIONS_LIST]: (payload) => {
      listed.push(payload.workspaceId);
      return Promise.resolve({ automations: [automation] });
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
  /** The words "Started by" says on the agent's row's card in ⌘K. */
  const startedBy = async (): Promise<string | null | undefined> => {
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
    act(() => root.render(createElement(ListedAutomations, { tasks, children: palette })));
    await act(async () => {
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    });
    act(() => {
      assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
    });
    chooseFilter("This task");
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
      each.textContent?.includes("Invoice export"),
    );
    assert.ok(row, "the agent is listed");
    restOn(row);
    const words = document.querySelector(
      ".luke-tooltip-card .actor-words [data-actor-ref]",
    )?.textContent;
    act(() => root.unmount());
    document.body.innerHTML = "";
    return words;
  };

  assert.equal(await startedBy(), "Morning Sentry triage");
  assert.deepEqual(listed, ["workspace-acme"]);
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
  const notice = document.querySelector(".luke-note-line")?.textContent;

  assert.deepEqual([changes, board], [[], []]);
  assert.deepEqual(read, [], "the hidden task's files are not read");
  assert.equal(notice, "Open a task with a repository to search its files.");
});

/** The palette over the plan with a repository, or over the Inbox in front of it with `chosen` chosen there, each file it opens recorded. */
async function paletteOverPanel(inbox: { chosen: InboxChoice | undefined } | undefined): Promise<{
  opened: string[];
  boards: string[];
  pulls: string[];
}> {
  const agent = {
    id: "agent-7",
    planId: DOCUMENT_TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invoice export",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const opened: string[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
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
    inboxView: { ...base.inboxView, open: inbox !== undefined, chosen: inbox?.chosen },
    sidePanel: { ...base.sidePanel, onOpenFile: (ref) => opened.push(ref.path) },
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
  });
  openPalette(tasks, () =>
    Promise.resolve({
      folder: {
        path: "",
        repository: "acme/relay",
        branch: "main",
        entries: [{ name: "accept.ts", kind: TASK_TREE_ENTRY.FILE }],
        truncated: false,
      },
    }),
  );
  type("#42");
  const pulls = rows().filter((row) => row.startsWith("#42"));
  type("Show board");
  const boards = rows().filter((row) => row.startsWith("Show board"));
  chooseFilter("Files");
  type("accept");
  await act(async () => undefined);
  if (rows().includes("accept.ts")) press("accept.ts");
  return { opened, boards, pulls };
}

/** The Pull request row of the plan's agent, as `paletteOverPanel` finds it by its number. */
const PULL = `#42 Export invoices as CSV · Invoice export · ${DOCUMENT_TASK.name}`;

test("over the Inbox with nothing chosen, whose side panel has no task, ⌘K offers none of the plan's files or panel tabs behind it; on the plan, or over an item of it, a file or a pull request found opens, and its panel tabs are offered on the plan alone, since the Inbox's panel draws none", async () => {
  assert.deepEqual(await paletteOverPanel(undefined), {
    opened: ["accept.ts"],
    boards: ["Show board"],
    pulls: [PULL],
  });
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual(
    await paletteOverPanel({ chosen: { taskId: DOCUMENT_TASK.id, itemId: "item-1" } }),
    { opened: ["accept.ts"], boards: [], pulls: [PULL] },
  );
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual(await paletteOverPanel({ chosen: undefined }), {
    opened: [],
    boards: [],
    pulls: [],
  });
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
    files: shownFiles([showing]),
  });
  assert.ok(plus, 'the "+" offers the file');
  const row = document.querySelector<HTMLElement>('[role="option"]');
  assert.equal(
    row?.querySelector(".luke-combobox-option-glyph")?.innerHTML,
    renderToStaticMarkup(plus.row.icon),
    'the row wears the icon the "+" row does',
  );
  restOn(row ?? assert.fail("the row is drawn"));
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

test("a task's row hangs the task's card beside it while the pointer rests on it, as its sidebar row does", () => {
  openPalette(
    tasksControl({
      tasks: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: "acme/billing",
        },
      ],
    }),
  );
  chooseFilter("Tasks");
  const row = document.querySelector<HTMLElement>('[role="option"]');
  assert.ok(row, "the task is listed");
  restOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-task-card]");
  assert.ok(card, "the task's card is hung");
  assert.equal(card.querySelector(".luke-hover-card-name")?.textContent, "Billing usage alerts");
});

test("a task's row ends as its sidebar row does, who is on it then an agent at work, and is found by its key", () => {
  const acme = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };
  const listed = (number: number, name: string): TaskSummary => ({
    id: `plan-${number}`,
    workspaceId: acme.id,
    name,
    number,
    createdAt: 1,
    updatedAt: number,
    repository: "acme/billing",
  });
  const worked: TaskSummary = {
    ...listed(12, "Billing usage alerts"),
    agents: {
      total: 1,
      working: 1,
      agents: [
        {
          id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
          title: "Alerts",
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          status: CODING_AGENT_STATUS.RUNNING,
        },
      ],
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
  openPalette(
    tasksControl({
      workspace: acme,
      workspaces: [acme],
      tasks: [worked, listed(7, "Invoice export")],
    }),
  );
  chooseFilter("Tasks");
  /** Each row's end, its marks in order: the face's kind, then the working mark. */
  const ends = () =>
    [...document.querySelectorAll('[role="option"] .luke-combobox-option-hint')].map((hint) =>
      [...hint.querySelectorAll(".actor-mark, .state-glyph")].map(
        (mark) => mark.getAttribute("data-kind") ?? mark.getAttribute("data-state"),
      ),
    );

  assert.deepEqual(ends(), [["unassigned", "working"], ["unassigned"]]);
  type("ACME-12");
  assert.deepEqual(rows(), ["ACME-12 · Billing usage alerts · billing"]);
});

test("an agent pressed on a task's card in ⌘K over Settings leaves the palette for the tasks and opens the agent's tab, as a row does", () => {
  const shown: [string, string][] = [];
  const sent = openPalette(
    tasksControl({
      tasks: [
        {
          id: "plan-1",
          workspaceId: "workspace-personal",
          name: "Billing usage alerts",
          createdAt: 1,
          updatedAt: 2,
          repository: null,
          agents: {
            total: 1,
            working: 1,
            agents: [
              {
                id: "agent-7",
                title: "Invoice export",
                model: "anthropic/claude-opus-5.5",
                effort: "high",
                status: CODING_AGENT_STATUS.RUNNING,
              },
            ],
            pullRequestTotal: 0,
            pullRequests: [],
          },
        },
      ],
      onShowAgent: (taskId, agentId) => shown.push([taskId, agentId]),
    }),
    undefined,
    undefined,
    DESKTOP_CAPABILITIES,
    PANEL_TAB.SETTINGS,
  );
  chooseFilter("Tasks");
  const row = document.querySelector<HTMLElement>('[role="option"]');
  assert.ok(row, "the task is listed");
  restOn(row);
  const agent = document.querySelector<HTMLElement>(
    ".luke-tooltip-card [data-task-card-agent] button",
  );
  assert.ok(agent, "the task's card names its agent");
  act(() => agent.click());
  assert.deepEqual(shown, [["plan-1", "agent-7"]]);
  assert.deepEqual(sent.tabs, [PANEL_TAB.TASKS], "the window leaves Settings for the tasks");
  assert.equal(document.querySelector('[role="dialog"]'), null, "the palette is put away");
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

  assert.deepEqual(listed, ["Dotfiles sync", "Checkout retries · Northwind · shop"]);
  assert.deepEqual(rows(), ["Checkout retries · Northwind · shop"]);
  assert.equal(
    document.querySelector(
      ".luke-combobox-option-detail .workspace-ref .luke-avatar[data-shape='tile']",
    )?.textContent,
    "N",
    "the other workspace is named by its tile and its name",
  );
});

test("a task's row says its repository by its name, as the Tasks list's row does, both owner and name where two listed repositories share the name", () => {
  const acme = { id: "workspace-acme", name: "Acme", role: WORKSPACE_ROLE.OWNER, github: null };
  const task = (number: number, name: string, repository: string) => ({
    id: `task-${number}`,
    workspaceId: acme.id,
    number,
    name,
    createdAt: 1,
    updatedAt: 10 - number,
    repository,
  });
  openPalette(
    tasksControl({
      workspaces: [acme],
      workspace: acme,
      tasks: [
        task(1, "Invoice export", "acme/billing"),
        task(2, "Login page", "acme/web"),
        task(3, "Docs site", "oss/web"),
      ],
    }),
  );
  chooseFilter("Tasks");

  assert.deepEqual(rows(), [
    "ACME-1 · Invoice export · billing",
    "ACME-2 · Login page · acme/web",
    "ACME-3 · Docs site · oss/web",
  ]);
});

test("a task's row leads with its key, which marks what the query typed, a key typed whole in any case lists its task first, ahead of a longer key it begins, and choosing it opens the task", () => {
  const stage = { id: "workspace-stage", name: "Stage", role: WORKSPACE_ROLE.OWNER, github: null };
  const task = (number: number, name: string) => ({
    id: `task-${number}`,
    workspaceId: stage.id,
    number,
    name,
    createdAt: 1,
    updatedAt: 1,
    repository: "stage/luke",
  });
  const sent: string[] = [];
  openPalette(
    tasksControl({
      workspaces: [stage],
      workspace: stage,
      tasks: [task(421, "Cut the release"), task(42, "Billing usage alerts from the meter")],
      onSelect: (taskId) => {
        sent.push(taskId);
      },
    }),
  );
  chooseFilter("Tasks");
  type("stag-42");

  assert.deepEqual(rows(), [
    "STAG-42 · Billing usage alerts from the meter · luke",
    "STAG-421 · Cut the release · luke",
  ]);
  type("STAG-421");
  assert.deepEqual(rows()[0], "STAG-421 · Cut the release · luke");
  assert.equal(
    document.querySelector('[role="option"] [data-task-key] .search-match')?.textContent,
    "STAG-421",
    "the key the query typed is marked in the row, so it says why the task was found",
  );
  press("STAG-421 · Cut the release · luke");
  assert.deepEqual(sent, ["task-421"]);
});

test("a task wears who is on it at its row's end, a teammate by face, no one on the dashed mark, the reader nothing, and is found by its assignee's name or its creator's, which the row then says", () => {
  const charles = { userId: "user-charles", name: "Charles Pan" };
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const priya = { userId: "user-priya", name: "Priya Raman" };
  const task = (id: string, by: typeof dean, assignee?: typeof dean) => ({
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
    ownerId: by.userId,
    createdBy: by,
    ...(assignee === undefined ? undefined : { assignee }),
  });
  openPalette(
    tasksControl({
      me: dean.userId,
      tasks: [
        task("Retry budget", dean, charles),
        task("Rate limits", charles, dean),
        task("Cache keys", priya),
      ],
    }),
  );
  chooseFilter("Tasks");
  const marks = () =>
    [...document.querySelectorAll('[role="option"]')].map((row) => {
      const mark = row.querySelector(".luke-combobox-option-hint .actor-mark");
      return mark === null ? null : [mark.getAttribute("data-kind"), mark.textContent];
    });

  assert.deepEqual(rows(), ["Retry budget · relay", "Rate limits · relay", "Cache keys · relay"]);
  // Charles is on Retry budget, Dean, the reader, on Rate limits, though Charles made it, and no one on Cache keys.
  assert.deepEqual(marks(), [["person", "C"], null, ["unassigned", ""]]);
  const hints = [...document.querySelectorAll('[role="option"]')].map(
    (row) => row.querySelector(".luke-combobox-option-hint")?.textContent ?? "",
  );
  assert.match(hints[0] ?? "", /\(assigned to Charles Pan\)/u);
  assert.match(hints[2] ?? "", /\(unassigned\)/u);
  type("charles");
  assert.deepEqual(rows(), [
    "Retry budget · relay · Charles Pan",
    "Rate limits · relay · Charles Pan",
  ]);
  type("priya");
  assert.deepEqual(rows(), ["Cache keys · relay · Priya Raman"]);
  // A query the task's own words answer leaves the name unsaid, and letters in order find no task.
  type("retry");
  assert.deepEqual(rows(), ["Retry budget · relay"]);
  type("chrls");
  assert.deepEqual(rows(), []);
});

test("a task whose assignee and creator share a first name says the one the whole query names", () => {
  const pan = { userId: "user-charles", name: "Charles Pan" };
  const ward = { userId: "user-ward", name: "Charles Ward" };
  openPalette(
    tasksControl({
      me: "user-dean",
      tasks: [
        {
          id: "Audit trail",
          workspaceId: "workspace-personal",
          name: "Audit trail",
          createdAt: 1,
          updatedAt: 1,
          repository: "acme/relay",
          ownerId: pan.userId,
          createdBy: pan,
          assignee: ward,
        },
      ],
    }),
  );
  chooseFilter("Tasks");

  type("charles pan");
  assert.deepEqual(rows(), ["Audit trail · relay · Charles Pan"]);
  type("charles");
  assert.deepEqual(rows(), ["Audit trail · relay · Charles Ward"]);
});

test("a task Luke or a coding agent made says who in its detail and is found by it, but wears who is on it rather than its maker", () => {
  const dean = { userId: "user-dean", name: "Dean Stratakos" };
  const task = (id: string, origin?: TaskSummary["origin"]) => ({
    id,
    workspaceId: "workspace-personal",
    name: id,
    createdAt: 1,
    updatedAt: 1,
    repository: "acme/relay",
    ownerId: dean.userId,
    createdBy: dean,
    assignee: dean,
    ...(origin === undefined ? undefined : { origin }),
  });
  openPalette(
    tasksControl({
      me: dean.userId,
      tasks: [
        task("Invite emails", { actor: PLAN_ACTOR.AGENT, agentId: "agent-gone" }),
        task("Audit log export", { actor: PLAN_ACTOR.NOTETAKER }),
        task("Rate limits"),
      ],
    }),
  );
  chooseFilter("Tasks");
  const marks = () =>
    [...document.querySelectorAll('[role="option"]')].map(
      (row) =>
        row.querySelector(".luke-combobox-option-hint .actor-mark")?.getAttribute("data-kind") ??
        null,
    );

  assert.deepEqual(rows(), [
    "Invite emails · relay · by Coding agent",
    "Audit log export · relay · by Luke",
    "Rate limits · relay",
  ]);
  assert.deepEqual(marks(), [null, null, null]);
  type("coding agent");
  assert.deepEqual(rows(), ["Invite emails · relay · by Coding agent"]);
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

/** Offers two commands whose only key is Esc, as Settings and the Inbox's item do while they stand, and records each run. */
function OffersEscapes({ ran }: { ran: string[] }): null {
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, () => ran.push("exit settings"));
  useAppCommand(APP_COMMAND.INBOX_LIST, () => ran.push("back to inbox list"));
  return null;
}

test("a command whose only key is Esc is no row in ⌘K, though it is still offered", () => {
  const ran: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(OffersEscapes, { ran })));
  openPalette();
  chooseFilter("Commands");
  type("exit settings");
  assert.equal(rows().includes("Exit settings"), false);
  type("back to inbox list");
  assert.equal(rows().includes("Back to inbox list"), false);
  assert.ok(appCommandOffered(APP_COMMAND.EXIT_SETTINGS), "Exit settings is still offered");
});

/** The chord's glyphs at the end of the palette's row listed as exactly these words, or nothing where it prints none. */
function rowChord(listed: string): string | null {
  const row = document.querySelectorAll('[role="option"]')[rows().indexOf(listed)];
  assert.ok(row, `${listed} is listed`);
  return row.querySelector(".luke-shortcut")?.textContent ?? null;
}

/** The chord's glyphs at the end of the open menu's item that says exactly these words, or nothing where it prints none. */
function itemChord(label: string): string | null {
  const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === label,
  );
  assert.ok(item, `the menu offers ${label}`);
  return item.querySelector(".luke-shortcut")?.textContent ?? null;
}

test("a task's command wears the same chord in ⌘K as in the open task's ⋯, ⌘K naming the task where the ⋯ says the verb alone", () => {
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks })),
  );
  openPalette(tasks);
  type("permanently delete");
  const deleteKeys = rowChord("Permanently delete task");
  type("mark done");
  const doneKeys = rowChord("Mark done");
  type("copy plan");
  const copyKeys = rowChord("Copy plan");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K closes");
  });

  const more = host.querySelector<HTMLButtonElement>('[aria-label="Task actions"]');
  assert.ok(more, "the task's ⋯ is drawn");
  act(() => more.click());
  assert.equal(deleteKeys, "⌘⌫");
  assert.equal(itemChord("Permanently delete"), deleteKeys);
  assert.equal(doneKeys, "⇧⌘A");
  assert.equal(itemChord("Mark done"), doneKeys);
  assert.equal(copyKeys, "⇧⌘C");
  assert.equal(itemChord("Copy plan"), copyKeys);
});

test("an agent tab's right-click words and keys Close and Show terminal as ⌘K does, ⌘K naming the tab where the menu says the verb alone", async () => {
  fakeAppBridge({});
  fakeActPort({});
  handCapabilities(DESKTOP_CAPABILITIES);
  const tasks = tasksControl({
    ...ON_AGENT_TAB,
    mainTabs: {
      ...ON_AGENT_TAB.mainTabs,
      tabs: [{ agent: LINKED_AGENT }],
      openAgents: [LINKED_AGENT],
    },
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  // The document arrives a few microtasks after the window first draws.
  await settle();
  openPalette(tasks);
  type("close tab");
  const closeKeys = rowChord("Close tab");
  type("show terminal");
  const terminalKeys = rowChord("Show terminal");
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K closes");
  });

  const tab = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  assert.ok(tab, "the agent's tab is chosen");
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }),
    );
  });
  assert.equal(closeKeys, "⌘W");
  assert.equal(itemChord("Close"), closeKeys);
  assert.equal(terminalKeys, "⌘J");
  assert.equal(itemChord("Show terminal"), terminalKeys);
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
  ]);
});

test("on an agent's page with a page it showed open in the panel, ⌥⌘C copies the page's link under the agent's while the panel fills the window, and the agent's own otherwise", async () => {
  const copied = installClipboard();
  const pageId = "4c5d6e7f-8a9b-4c0d-9e1f-2a3b4c5d6e7f";
  const listed = { workspaces: ON_AGENT_TAB.workspaces, workspace: ON_AGENT_TAB.workspaces[0] };
  const onPage = (fullScreen: boolean) => {
    const base = tasksControl(listed);
    return tasksControl({
      ...listed,
      agentView: { ...base.agentView, agentId: LINKED_AGENT },
      sidePanel: { ...base.sidePanel, open: true, fullScreen, tab: { page: pageId } },
    });
  };
  for (const tasks of [onPage(true), onPage(false)]) {
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
    `https://tryluke.dev/acme/agent/${LINKED_AGENT}/page/${pageId}`,
    `https://tryluke.dev/acme/agent/${LINKED_AGENT}`,
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

test("on Chat over an open task nothing has a link, so ⌘K lists no Copy link and ⌥⌘C copies nothing", async () => {
  const copied = installClipboard();
  openPalette({ ...ON_AGENT_TAB, chatView: { ...ON_AGENT_TAB.chatView, open: true } });
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
        tab: { changes: LINKED_AGENT },
      },
    }),
  );
  act(() => {
    runAppCommand(APP_COMMAND.COMMAND_PALETTE);
    runAppCommand(APP_COMMAND.COPY_LINK);
  });
  await act(async () => undefined);

  assert.deepEqual(copied, [
    `https://tryluke.dev/acme/plan/${DOCUMENT_TASK.id}/agent/${LINKED_AGENT}/changes`,
  ]);
});

test("⌘K pressed with the keyboard in the side panel offers its tab's link first, wearing ⌥⌘C, as ⌥⌘C there copies", () => {
  const panel = document.body.appendChild(document.createElement("div"));
  panel.className = "side-panel";
  const field = panel.appendChild(document.createElement("button"));
  field.focus();
  openPalette(
    tasksControl({
      ...ON_AGENT_TAB,
      sidePanel: { ...ON_AGENT_TAB.sidePanel, open: true, tab: { changes: LINKED_AGENT } },
    }),
  );
  type("copy link");
  const chord = document.querySelector('[role="option"] .luke-combobox-option-hint')?.textContent;

  assert.deepEqual(
    rows().filter((row) => row.startsWith("Copy link to ")),
    [
      "Copy link to pull request",
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

test("People lists the listed workspace's members as every people menu does, the reader first as You and the rest by name with their email, found by email too, each hanging their card, and a choice opens their page", async () => {
  const members = [
    {
      userId: "user-maya",
      name: "Maya Chen",
      email: "maya@example.com",
      role: WORKSPACE_ROLE.ADMIN,
    },
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
  membersAnswer(() => Promise.resolve(members));
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

  assert.deepEqual(rows(), [
    "Dean Stratakos · You",
    "Charles Pan · charles@example.com",
    "Maya Chen · maya@example.com",
  ]);
  type("charles@");
  assert.deepEqual(rows(), ["Charles Pan · charles@example.com"]);
  const row = document.querySelector<HTMLElement>('[role="option"]');
  assert.ok(row, "Charles is listed");
  restOn(row);
  const card = document.querySelector('.luke-tooltip-card [data-actor-card="person"]');
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Charles Pan");
  act(() => row.click());
  assert.deepEqual(opened, ["user-charles"]);
  assert.deepEqual(sent.tabs, []);
});

/** What the list says where no row stands: its notice, or "No results match". */
function emptyLine(): string | undefined {
  return (
    document.querySelector(".luke-note-line, [cmdk-list] [role=alert]")?.textContent ?? undefined
  );
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** A window whose members read is answered on its act port by `members`, every other act refused. */
function membersAnswer(
  members: () => Promise<PortActResult<typeof ACT_KIND.WORKSPACE_MEMBERS_READ>>,
): void {
  fakeAppBridge({});
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: members });
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
  membersAnswer(() => Promise.resolve([]));
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
  assert.equal(emptyLine(), "Reading the repository's files");
  assert.equal(document.querySelector(".luke-note-line")?.getAttribute("role"), "status");

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
  assert.equal(emptyLine(), "No results match", "once every source answered, it says so");
});

test("People says the members are being read until they answer, and a refused read says so with a Retry that reads them again", async () => {
  const member = {
    userId: "user-charles",
    name: "Charles Pan",
    email: "charles@example.com",
    role: WORKSPACE_ROLE.MEMBER,
  };
  let answers: { resolve: (members: readonly WorkspaceMember[]) => void; refuse: () => void }[] =
    [];
  membersAnswer(
    () =>
      new Promise((resolve, reject) => {
        answers.push({ resolve, refuse: () => reject(refusedOnPort("No.")) });
      }),
  );
  openPalette(tasksControl({ me: "user-dean", workspace: ACME }));
  chooseFilter("People");
  await settle();
  assert.equal(emptyLine(), "Reading the workspace's members");

  await act(async () => answers.shift()?.refuse());
  await settle();
  const alert = document.querySelector("[cmdk-list] [role=alert]");
  assert.match(alert?.textContent ?? "", /The workspace's members could not be read\./u);
  assert.doesNotMatch(document.body.textContent ?? "", /No results match/u);

  answers = [];
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Retry",
  );
  assert.ok(retry, "Retry is offered");
  act(() => retry.click());
  await settle();
  assert.equal(emptyLine(), "Reading the workspace's members");
  await act(async () => answers.shift()?.resolve([member]));
  await settle();
  assert.deepEqual(rows(), ["Charles Pan · charles@example.com"]);
});

test("Tasks says the account's tasks are being read before the list first answers", () => {
  membersAnswer(() => Promise.resolve([]));
  openPalette(tasksControl({ workspace: ACME, listRead: false }));
  chooseFilter("Tasks");
  assert.equal(emptyLine(), "Reading your tasks");
  assert.doesNotMatch(document.body.textContent ?? "", /No results match/u);
});

test("Tasks says a refused list with a Retry that reads it again", () => {
  const retried: number[] = [];
  membersAnswer(() => Promise.resolve([]));
  openPalette(
    tasksControl({
      workspace: ACME,
      listRead: false,
      listFailed: true,
      onRetryList: () => retried.push(1),
    }),
  );
  chooseFilter("Tasks");
  const alert = document.querySelector("[cmdk-list] [role=alert]");
  assert.match(alert?.textContent ?? "", /Your tasks could not be read\./u);
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Retry",
  );
  act(() => retry?.click());
  assert.deepEqual(retried, [1]);
});

test("⌘K's Tasks lists the agents with no task among the tasks by their last activity, as the sidebar does, the archived after them, and opens one on its own page", () => {
  const opened: string[] = [];
  const oneOff = (id: string, title: string, activityAt: number) => ({
    id,
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-1",
    repository: "acme/relay",
    activityAt,
  });
  const task = (id: string, name: string, updatedAt: number) => ({
    id,
    workspaceId: "workspace-1",
    name,
    createdAt: 1,
    updatedAt,
    repository: null,
  });
  const control = tasksControl({
    tasks: [task("t-1", "Rate limits", 30), task("t-2", "Retry budget", 10)],
    listedAgents: {
      standing: [oneOff("a-1", "Triage overnight issues", 20)],
      archived: [{ ...oneOff("a-2", "Remove stale copy", 40), archivedAt: 41 }],
    },
    agentView: { agentId: undefined, onOpen: (id) => opened.push(id), onClose: () => undefined },
  });
  openPalette(control);
  chooseFilter("Tasks");

  assert.deepEqual(rows(), [
    "Rate limits",
    "Triage overnight issues · acme/relay",
    "Retry budget",
    "Remove stale copy · acme/relay · Archived",
  ]);
  press("Triage overnight issues · acme/relay");
  assert.deepEqual(opened, ["a-1"]);
  // An archived one-off agent is listed nowhere in the sidebar, so ⌘K is its way to its page, whose Unarchive brings it back.
  openPalette(control);
  chooseFilter("Tasks");
  press("Remove stale copy · acme/relay · Archived");
  assert.deepEqual(opened, ["a-1", "a-2"]);
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

test("on a one-off agent's page, ⌘K marks the agent unread and then read, and offers no mark while no agent's page stands", () => {
  const agent = {
    id: "agent-8",
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
  const seen: string[] = [];
  fakeActPort({
    [ACT_KIND.CODING_AGENTS_SEEN]: ({ agentId }) => {
      seen.push(agentId);
      return Promise.resolve(undefined);
    },
  });
  const draw = (agentId: string | undefined) => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    openPalette(
      tasksControl({
        agentView: { agentId, onOpen: () => undefined, onClose: () => undefined },
        listedAgents: { standing: [agent], archived: [] },
      }),
    );
    type("mark");
    return rows().filter((row) => row.startsWith("Mark as"));
  };

  assert.deepEqual(draw(undefined), []);
  assert.deepEqual(draw(agent.id), ["Mark as unread"]);
  press("Mark as unread");
  assert.deepEqual(draw(agent.id), ["Mark as read"]);
  press("Mark as read");
  assert.deepEqual(draw(agent.id), ["Mark as unread"]);
  assert.deepEqual(seen, [agent.id]);
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
  chooseFilter("This task");
  assert.ok(rows().includes("Chat · Billing usage alerts"), "Chat on offers the task's Chat");
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  handState({});
  await paletteUnderState(tasks);
  chooseFilter("This task");
  assert.ok(!rows().some((row) => row.startsWith("Chat")), "Chat off offers no Chat");
});

test("⌘K's Show chat is offered only while the account has Chat on, as the side panel's \"+\" offers the tab, since a Chat tab with no Chat drawn opens blank", async () => {
  const tasks = tasksControl({
    activeTaskId: DOCUMENT_TASK.id,
    tasks: [
      {
        id: DOCUMENT_TASK.id,
        workspaceId: DOCUMENT_TASK.workspaceId,
        name: DOCUMENT_TASK.name,
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    chatView: { ...tasksControl().chatView, available: true },
  });
  handState(experimentsOn(EXPERIMENT.CHAT));
  await paletteUnderState(tasks);
  chooseFilter("Commands");
  assert.ok(rows().includes("Show chat"), "Chat on offers Show chat");
  assert.ok(rows().includes("Show board"));
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";

  handState({});
  await paletteUnderState(tasks);
  chooseFilter("Commands");
  assert.ok(!rows().includes("Show chat"), "Chat off offers no Show chat");
  assert.ok(rows().includes("Show board"), "the tabs that exist are still offered");
});

test('with a task open, ⌘K\'s "This task" lists its pages and a terminal for each agent, as the side panel\'s "+" offers them, and each opens as the "+" opens it', async () => {
  const agent = {
    id: "agent-7",
    planId: DOCUMENT_TASK.id,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Invoice export",
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  };
  const chosen: unknown[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    activeTaskId: DOCUMENT_TASK.id,
    tasks: [
      {
        id: DOCUMENT_TASK.id,
        workspaceId: DOCUMENT_TASK.workspaceId,
        name: DOCUMENT_TASK.name,
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    pages: [{ id: "page-1", title: "Invite funnel", version: 1, at: 1 }],
    sidePanel: { ...base.sidePanel, onChoose: (tab) => chosen.push(tab) },
    agents: codingAgentsControl({ agents: [agent], agentIds: [agent.id] }),
  });
  handCapabilities(DESKTOP_CAPABILITIES);
  await paletteUnderState(tasks);
  chooseFilter("This task");
  const listed = rows();
  assert.ok(listed.includes(`Invite funnel · ${DOCUMENT_TASK.name}`), "the page is listed");
  assert.ok(
    listed.includes(`Invoice export · Terminal · ${DOCUMENT_TASK.name}`),
    "the agent's terminal is listed",
  );

  press(`Invite funnel · ${DOCUMENT_TASK.name}`);
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K opens again");
  });
  chooseFilter("This task");
  press(`Invoice export · Terminal · ${DOCUMENT_TASK.name}`);
  assert.deepEqual(chosen, [{ page: "page-1" }, { terminal: agent.id }]);
});

test('over an Inbox item of the open task, ⌘K\'s "This task" lists the pages the Inbox\'s panel read, as that panel\'s "+" offers them, and no file shown on the task, which that panel draws none of', async () => {
  const showing: TaskCodeShowing = {
    callId: "c",
    turnId: "t",
    shownAt: 1_000,
    code: {
      ref: { path: "src/invites/accept.ts", startLine: 3, endLine: 5 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 9,
      lines: [],
      note: "A used invite is refused here.",
    },
  };
  const base = tasksControl();
  const tasks = tasksControl({
    activeTaskId: DOCUMENT_TASK.id,
    tasks: [
      {
        id: DOCUMENT_TASK.id,
        workspaceId: DOCUMENT_TASK.workspaceId,
        name: DOCUMENT_TASK.name,
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    shownCode: [showing],
    pages: [],
    inboxView: {
      ...base.inboxView,
      open: true,
      chosen: { taskId: DOCUMENT_TASK.id, itemId: "item-1" },
      pages: [{ id: "page-2", title: "Review notes", version: 1, at: 1 }],
    },
  });
  await paletteUnderState(tasks);
  chooseFilter("This task");
  const listed = rows();
  assert.ok(listed.includes(`Review notes · ${DOCUMENT_TASK.name}`), "the Inbox's page is listed");
  assert.ok(!listed.some((row) => row.startsWith("accept.ts")), "no shown file is listed");
});

test("with a task on screen, ⌘K offers its Version history, Cancel task, Change repository, and Open on GitHub, each running on it what its ⋯ item runs", () => {
  const task = { ...DOCUMENT_TASK, repository: "acme/relay" };
  const ran: string[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    tasks: [task],
    region: { kind: DOCUMENT_REGION.READY, task },
    activeTaskId: task.id,
    history: { ...base.history, onOpen: (taskId) => ran.push(`history:${taskId}`) },
    onSettleTasks: (taskIds, status) => ran.push(`settle:${taskIds.join()}:${status}`),
    onChangeRepository: (taskId) => ran.push(`repository:${taskId}`),
    onOpenOnGitHub: (taskId) => ran.push(`github:${taskId}`),
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(Looker, { looked: task }),
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
    ),
  );
  for (const command of ["Version history", "Cancel task", "Change repository", "Open on GitHub"]) {
    act(() => {
      assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K opens");
    });
    chooseFilter("Commands");
    press(command);
  }
  assert.deepEqual(ran, [
    `history:${task.id}`,
    `settle:${task.id}:canceled`,
    `repository:${task.id}`,
    `github:${task.id}`,
  ]);
});

/** The open task's page in `room`, its panel on the plan, beside the palette, the plan looked at as the window's shell looks at it. */
function paletteBesideTask(room: ShellRoom): HTMLElement {
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      fullScreen: room === SHELL_ROOM.NARROW,
      fullScreenOnly: room === SHELL_ROOM.NARROW,
      tabs: [SIDE_PANEL_TAB.PLAN],
      strip: [SIDE_PANEL_TAB.PLAN],
      tab: SIDE_PANEL_TAB.PLAN,
    },
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          ShellRoomContext.Provider,
          { value: room },
          createElement(Looker, { looked: DOCUMENT_TASK }),
          createElement(DesktopTasks, {
            summary: UNPINNED_SUMMARY,
            looks: NO_LOOKS,
            room,
            away: { label: "Tasks", onPress: () => undefined },
            tasks,
          }),
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
    ),
  );
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K opens");
  });
  chooseFilter("Commands");
  press("Rename task");
  return host;
}

test("on a wide window ⌘K's Rename task puts the caret in the plan's own title", () => {
  const host = paletteBesideTask(SHELL_ROOM.WIDE);

  const title = host.querySelector('[role="textbox"][aria-label="Task name"]');
  assert.ok(title, "the plan's title is drawn");
  assert.ok(document.activeElement === title, "the caret is in the plan's title");
});

test("on a phone ⌘K's Rename task opens the task's name in the head's field", () => {
  const host = paletteBesideTask(SHELL_ROOM.NARROW);

  const field = host.querySelector('.task-head input[aria-label="Task name"]');
  assert.ok(field, "the head's title is the name's field");
  assert.ok(document.activeElement === field, "the caret is in the head's field");
});

test("on a one-off agent's page, ⌘K's Archive agent archives it, and an archived agent's page offers Unarchive agent, which brings it back", async () => {
  const agent = {
    id: "agent-6",
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
  const asked: string[] = [];
  const draw = (listedAgents: TasksControl["listedAgents"]) => {
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
    document.body.innerHTML = "";
    openPalette(
      tasksControl({
        agentView: { agentId: agent.id, onOpen: () => undefined, onClose: () => undefined },
        listedAgents,
        agents: codingAgentsControl({
          onArchive: (agentId, archived) => {
            asked.push(`${agentId}:${String(archived)}`);
            return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
          },
        }),
      }),
    );
    type("archive");
    return rows().filter((row) => /^(Archive|Unarchive) agent$/u.test(row));
  };

  assert.deepEqual(draw({ standing: [agent], archived: [] }), ["Archive agent"]);
  press("Archive agent");
  await act(async () => undefined);
  assert.deepEqual(draw({ standing: [], archived: [{ ...agent, archivedAt: 3 }] }), [
    "Unarchive agent",
  ]);
  press("Unarchive agent");
  await act(async () => undefined);
  assert.deepEqual(asked, [`${agent.id}:true`, `${agent.id}:false`]);
});

test("⌘K still offers Show inbox for a task an item waits on while its agents are unread and its Inbox tab is closed", async () => {
  const base = tasksControl();
  const tasks = tasksControl({
    activeTaskId: DOCUMENT_TASK.id,
    tasks: [
      {
        id: DOCUMENT_TASK.id,
        workspaceId: DOCUMENT_TASK.workspaceId,
        name: DOCUMENT_TASK.name,
        createdAt: 1,
        updatedAt: 2,
        repository: null,
      },
    ],
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    sidePanel: { ...base.sidePanel, tabs: [] },
    inbox: [{ taskId: DOCUMENT_TASK.id, items: [] }],
  });
  await paletteUnderState(tasks);
  chooseFilter("Commands");
  assert.ok(rows().includes("Show inbox"), "a waiting item holds the Inbox");
});

/** Answers Luke's ensure with his id, every other act with nothing, and keeps every act sent. */
function servingLuke(agentId: string): SentPortAct[] {
  const sent: SentPortAct[] = [];
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(
      request.kind === ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR ? { agentId } : undefined,
    );
  });
  return sent;
}

test("⌘K's first entry is Ask Luke while the account has the operator on, which opens his page, and he is not listed again, nor a Luke a Reset retired", async () => {
  const lukeId = "6a1f0c2e-0000-4000-8000-0000000000a1";
  servingLuke(lukeId);
  const opened: string[] = [];
  const tasks = tasksControl({
    workspace: ACME,
    workspaces: [ACME],
    listedAgents: {
      standing: [
        {
          id: lukeId,
          planId: null,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Orla",
          createdAt: 1,
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          automationId: null,
          workspaceId: ACME.id,
          repository: null,
          activityAt: 2,
        },
      ],
      archived: [
        {
          id: "6a1f0c2e-0000-4000-8000-0000000000a0",
          planId: null,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: "Ines",
          kind: CODING_AGENT_KIND.OPERATOR,
          createdAt: 0,
          status: CODING_AGENT_STATUS.COMPLETED,
          turnId: null,
          archivedAt: 1,
          automationId: null,
          workspaceId: ACME.id,
          repository: null,
          activityAt: 1,
        },
      ],
    },
  });
  handState(experimentsOn(EXPERIMENT.OPERATOR));
  await paletteUnderState({
    ...tasks,
    agentView: { ...tasks.agentView, onOpen: (agentId) => void opened.push(agentId) },
  });
  await settle();

  assert.equal(rows()[0], "Ask Luke");
  assert.deepEqual(
    footer(),
    ["↑↓ Select", "⏎ Run", "←→ Filter"],
    "Ask Luke is a command, which runs",
  );
  chooseFilter("Commands");
  assert.equal(rows()[0], "Ask Luke");
  assert.deepEqual(footer(), ["↑↓ Select", "⏎ Run", "←→ Filter"]);
  chooseFilter("All");
  assert.ok(
    !rows().some((row) => row.startsWith("Orla")),
    "Luke is not listed again by his agent's name",
  );
  type("Ines");
  assert.ok(!rows().some((row) => row.startsWith("Ines")), "a Luke a Reset retired is not listed");
  type("");
  press("Ask Luke");
  await settle();
  assert.deepEqual(opened, [lukeId]);
});

test("⌘K offers no Ask Luke and ensures nothing while the account has the operator off", async () => {
  const sent = servingLuke("6a1f0c2e-0000-4000-8000-0000000000a1");
  handState({});
  await paletteUnderState(tasksControl({ workspace: ACME, workspaces: [ACME] }));
  await settle();

  assert.ok(!rows().includes("Ask Luke"));
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.CODING_AGENTS_ENSURE_OPERATOR),
    [],
  );
});

test("⌘K draws no Issues filter, with every experiment on, since Luke keeps no issues of its own", async () => {
  handState(experimentsOn(...Object.values(EXPERIMENT)));
  await paletteUnderState(tasksControl({ workspace: ACME }));
  await settle();

  assert.deepEqual(
    filterOptions().map((option) => option.textContent),
    ["All", "Tasks", "This task", "Inbox", "People", "Files", "Commands", "Settings"],
  );
});

/** The agent asking the Inbox's questions below, as its task's list sums it up. */
const ASKER = {
  id: "5b0e1d2c-0000-4000-8000-0000000000a1",
  title: "Rotate secrets",
  model: "anthropic/claude-opus-4.5",
  effort: "high",
  status: CODING_AGENT_STATUS.RUNNING,
} as const;

/** A task holding Inbox items, its agent summed up so each item's tile names it. */
const ROTATION: TaskSummary = {
  id: "7e4f0a9b-0000-4000-8000-0000000000b2",
  workspaceId: "workspace-personal",
  name: "Billing usage alerts",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  agents: { total: 1, working: 1, agents: [ASKER], pullRequestTotal: 0, pullRequests: [] },
};

/** An open item of the agent's, its thread one message of the agent's words. */
function askedItem(id: string, title: string, said: string, updatedAt: number): InboxItem {
  return {
    id,
    agentId: ASKER.id,
    key: id.slice(-4),
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    thread: [
      {
        id: `${id.slice(0, -4)}ffff`,
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: said,
        createdAt: updatedAt,
      },
    ],
    postedAt: updatedAt,
    updatedAt,
  };
}

const ROTATE = askedItem(
  "a1b2c3d4-0000-4000-8000-000000000011",
  "Which webhook secret should rotate?",
  "Rotate the Stripe signing secret today.",
  3_000,
);

/** An item settled after the open one was asked, so it is the newer of the two. */
const PREVIEWS: InboxItem = {
  ...askedItem(
    "a1b2c3d4-0000-4000-8000-000000000012",
    "Use acme.dev for previews?",
    "Previews would move off the vercel.app domain.",
    9_000,
  ),
  status: INBOX_STATUS.ANSWERED,
  settledAt: 9_000,
};

/** The palette over a window whose listed workspace's task holds the items main pushes as `inbox` says, main's word of it last changed at `changed`, every Inbox item it opens recorded. */
function paletteOverInbox(inbox: () => CodingAgentInboxChanged["inbox"], changed = 9_000) {
  const main = followedInboxes((scope) =>
    scope.kind === INBOX_SCOPE_KIND.PLAN && scope.id === ROTATION.id ? inbox() : undefined,
  );
  fakeActPort({ ...fakeActPortCalls(), ...main.procedures });
  const opened: InboxChoice[] = [];
  const tasks = tasksControl({
    tasks: [ROTATION],
    inboxTasks: [{ taskId: ROTATION.id, items: 2, updatedAt: changed }],
  });
  openPalette({
    ...tasks,
    inboxView: { ...tasks.inboxView, onOpenItem: (choice) => opened.push(choice) },
  });
  return { main, opened };
}

test("the Inbox is followed only once it is searched, and then lists what needs you first, each item beside its task", async () => {
  const { main } = paletteOverInbox(() => ({ items: [PREVIEWS, ROTATE] }));
  await settle();
  assert.deepEqual(main.asked, [], "opening the palette follows no inbox");

  chooseFilter("Inbox");
  await settle();

  assert.deepEqual(main.asked, [`${INBOX_SCOPE_KIND.PLAN}:${ROTATION.id}`]);
  assert.deepEqual(rows(), [
    "Which webhook secret should rotate? · Billing usage alerts",
    "Use acme.dev for previews? · Billing usage alerts",
  ]);
});

test("an Inbox item is the Inbox's own row: its agent's tile, the marks of its Inbox row and its time at its end, and its card hung beside it", async () => {
  paletteOverInbox(() => ({ items: [PREVIEWS, ROTATE] }));
  chooseFilter("Inbox");
  await settle();

  const [needs, answered] = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  assert.ok(needs, "the item that needs you is listed");
  assert.ok(needs.querySelector('.actor-mark[data-kind="agent"]'), "the agent's tile leads");
  assert.ok(needs.querySelector(".luke-combobox-option-hint .inbox-row-attention"), "it needs you");
  assert.ok(needs.querySelector(".luke-combobox-option-hint time"), "its time stands at its end");
  assert.equal(
    answered?.querySelector(".inbox-row-attention"),
    null,
    "an answered item needs no one",
  );

  restOn(needs);
  const card = document.querySelector(".luke-tooltip-card [data-inbox-row-card]");
  assert.equal(
    card?.querySelector(".luke-hover-card-name")?.textContent,
    "Which webhook secret should rotate?",
  );
  assert.match(card?.textContent ?? "", /Rotate the Stripe signing secret today\./u);
});

test("an Inbox item is found under All by words its thread says, which its row says beside its task", async () => {
  paletteOverInbox(() => ({ items: [PREVIEWS, ROTATE] }));

  type("stripe");
  await settle();

  assert.deepEqual(rows(), [
    "Which webhook secret should rotate? · Billing usage alerts · Rotate the Stripe signing secret today.",
  ]);
});

test("choosing an Inbox item opens it in the Inbox, as a notification's would", async () => {
  const { opened } = paletteOverInbox(() => ({ items: [PREVIEWS, ROTATE] }));
  chooseFilter("Inbox");
  await settle();

  press("Use acme.dev for previews? · Billing usage alerts");

  assert.deepEqual(opened, [{ taskId: ROTATION.id, itemId: PREVIEWS.id, opened: true }]);
  assert.equal(document.querySelector('[role="option"]'), null, "the palette closed");
});

test("an Inbox that could not be read says so, rather than that nothing matches", async () => {
  paletteOverInbox(() => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));
  chooseFilter("Inbox");
  await settle();

  assert.equal(emptyLine()?.startsWith("Your inbox could not be read."), true);
});

test("a query its title half answers says the thread's words that answer the rest, never the title again", async () => {
  paletteOverInbox(() => ({ items: [PREVIEWS, ROTATE] }));
  chooseFilter("Inbox");

  type("rotate stripe");
  await settle();

  assert.deepEqual(rows(), [
    "Which webhook secret should rotate? · Billing usage alerts · Rotate the Stripe signing secret today.",
  ]);
});

test("an Inbox item is found by a form's field and the value it was answered with", async () => {
  const PORT: InboxItem = {
    ...askedItem(
      "a1b2c3d4-0000-4000-8000-000000000013",
      "Which mail server?",
      "Fill in the relay.",
      4_000,
    ),
    status: INBOX_STATUS.ANSWERED,
    thread: [
      {
        id: "a1b2c3d4-0000-4000-8000-00000000ff13",
        author: INBOX_MESSAGE_AUTHOR.AGENT,
        text: "Fill in the relay.",
        ask: {
          type: INBOX_ASK.ANSWER,
          fields: [{ label: "SMTP port", type: INBOX_FIELD.NUMBER }],
          status: INBOX_ASK_STATUS.ANSWERED,
        },
        createdAt: 4_000,
      },
      {
        id: "a1b2c3d4-0000-4000-8000-00000000fe13",
        author: INBOX_MESSAGE_AUTHOR.MEMBER,
        text: "",
        answers: {
          ask: "a1b2c3d4-0000-4000-8000-00000000ff13",
          reply: INBOX_REPLY.SUBMITTED,
          values: [{ label: "SMTP port", value: 587 }],
        },
        createdAt: 4_000,
      },
    ],
    settledAt: 4_000,
  };
  paletteOverInbox(() => ({ items: [PORT] }));
  chooseFilter("Inbox");

  type("587");
  await settle();
  assert.deepEqual(rows(), ["Which mail server? · Billing usage alerts · 587"]);
  type("smtp");
  assert.deepEqual(rows(), ["Which mail server? · Billing usage alerts · SMTP port"]);
});

test("while main says a task's inbox changed later than its push, a query it does not answer says the inbox is still being read", async () => {
  const { main } = paletteOverInbox(() => ({ items: [PREVIEWS] }), 12_000);
  chooseFilter("Inbox");

  type("webhook");
  await settle();
  assert.equal(emptyLine(), "Reading your inbox");

  const fresh = { ...ROTATE, updatedAt: 12_000 };
  act(() =>
    main.push({ kind: INBOX_SCOPE_KIND.PLAN, id: ROTATION.id }, { items: [PREVIEWS, fresh] }),
  );
  await settle();
  assert.deepEqual(rows(), ["Which webhook secret should rotate? · Billing usage alerts"]);
});

test("an Inbox that could not be read says so in the Inbox's own group, beside the rows other groups matched, and its Retry reads it again", async () => {
  paletteOverInbox(() => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }));

  type("billing");
  await settle();

  assert.ok(
    rows().includes("Billing usage alerts · relay"),
    "the task the Tasks group matched is listed",
  );
  const notice = document.querySelector("[cmdk-list] [role=alert]");
  assert.equal(notice?.textContent?.startsWith("Your inbox could not be read."), true);
  const group = notice?.closest("[cmdk-group]");
  assert.equal(group?.querySelector("[cmdk-group-heading]")?.textContent, "Inbox");
  assert.ok(
    [...document.querySelectorAll("[cmdk-group-heading]")].some(
      (each) => each.textContent === "Tasks",
    ),
    "the other matches keep their own group",
  );
  assert.ok(
    [...(notice?.querySelectorAll("button") ?? [])].some((each) => each.textContent === "Retry"),
    "the failed source offers Retry",
  );
});

test("a key pressed in the search field is timed under ⌘K's own keystroke span, how long it waited and nothing of the key", () => {
  const spans: PanelSpan[] = [];
  const uninstall = installPanelSpanRecorder((span) => spans.push(span));
  reportEventTiming();
  openPalette();

  keyPressed(field(), { startTime: 800, processingStart: 804, processingEnd: 950, duration: 184 });
  uninstall();
  vi.unstubAllGlobals();

  assert.deepEqual(
    spans.map((span) => ({
      name: span.name,
      waited: span.endedAt - span.startedAt,
      measured: span.attributes(),
    })),
    [
      {
        name: PANEL_SPAN.KEYSTROKE_COMMAND_PALETTE,
        waited: 184,
        measured: { "keystroke.input_delay_ms": 4, "keystroke.processing_ms": 146 },
      },
    ],
  );
});
