// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Channel } from "@luke/features/channel-wire";
import {
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { experimentsOn } from "@luke/settings/testing";
import { holdExits } from "@luke/ui/testing/held-exits";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB } from "../panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { useChannels } from "../tasks/use-channels.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort } from "../testing/app-bridge.js";
import {
  DESKTOP_CAPABILITIES,
  handCapabilities,
  handState,
  stateWith,
} from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { holdMotion, releaseMotion } from "../testing/motion-held.js";
import { codingAgentsControl, tasksControl } from "../testing/tasks-control.js";
import { TabSwitcher } from "./tab-switcher.js";

/**
 * tab-switcher.test.ts -- ⌃Tab as the window answers it: a stop is a whole
 * screen, so arriving on a task with both panes is one stop and a tab the
 * window chose by itself takes it in place; a quick tap goes to the screen
 * before through the task's own doors, both panes restored, and draws
 * nothing; a hold draws the cards, the screen here first and dimmed, each
 * named as Back's list names it; ⇧ steps back, Escape goes nowhere, a card
 * pressed is gone to, and a still of the work area left is kept for its
 * card, out of the session recording. The cards stand in a modal dialog
 * that holds focus while they show and hands it back to where it was as
 * they go, fading out on the exit token, or at once where motion is held.
 * A browser keeps ⌃Tab for its own tabs, so a window that is no desktop app
 * leaves it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const TASK = DOCUMENT_TASK.id;

/** A still as main answers one, synthetic. */
const STILL = "data:image/jpeg;base64,AAAA";

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  releaseMotion();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.useRealTimers();
});

/** The cards' dialog, which the switcher draws in `@luke/ui`'s Dialog. */
const DIALOG = '[role="dialog"]';

/** What the switcher asked the window to show, in order. */
interface Asked {
  readonly shown: string[];
  readonly places: string[];
}

const asked = (): Asked => ({ shown: [], places: [] });

/** The window on the task, its panel on `tab` and its column on `column`, every door the switcher may use recorded in `told`. */
function onTask(
  tab: SidePanelTab,
  told: Asked,
  overrides: Partial<TasksControl> = {},
  column?: MainTab,
): TasksControl {
  const base = tasksControl({ activeTaskId: TASK, tasks: [{ ...DOCUMENT_TASK }] });
  const named = (shown: MainTab | SidePanelTab) =>
    typeof shown === "string" ? shown : JSON.stringify(shown);
  return {
    ...base,
    mainTabs: {
      ...base.mainTabs,
      tab: column,
      tabs: column === undefined ? [] : [column],
      openAgents: column !== undefined && "agent" in column ? [column.agent] : [],
    },
    sidePanel: {
      ...base.sidePanel,
      open: true,
      tab,
      onShow: (taskId, shown) =>
        told.shown.push(`panel beside ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    },
    onShowPanelTab: (taskId, shown) =>
      told.shown.push(`panel ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    onShowColumnTab: (taskId, shown) =>
      told.shown.push(`column ${taskId === TASK ? "the task" : taskId}: ${named(shown)}`),
    inboxView: { ...base.inboxView, onOpen: () => told.places.push("inbox") },
    ...overrides,
  };
}

/** The switcher over a window, drawn again on each place the test moves the window to. */
async function mounted(room: ShellRoom = SHELL_ROOM.WIDE) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (tasks: TasksControl) => {
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            ShellRoomContext.Provider,
            { value: room },
            createElement(TabSwitcher, {
              available: true,
              tab: PANEL_TAB.TASKS,
              onTabChange: () => undefined,
              tasks,
            }),
          ),
        ),
      ),
    );
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    });
  };
  return { draw };
}

function key(type: "keydown" | "keyup", init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const tab = (shift = false) =>
  key("keydown", { key: "Tab", code: "Tab", ctrlKey: true, shiftKey: shift });
const letGo = () => key("keyup", { key: "Control", code: "ControlLeft" });

/** A press of the pointer, as a tab chosen by hand is led by. */
function press(): void {
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".luke-tab-card")];
}

const inboxOpen = () => ({ ...tasksControl().inboxView, open: true });

test("a tab chosen by hand is a screen of its own, and a quick tap goes back to the one before without drawing anything", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  const pressed = tab();
  assert.equal(
    pressed.defaultPrevented,
    true,
    "⌃Tab is the switcher's, not the field's or the terminal's under it",
  );
  letGo();

  assert.deepEqual(told.shown, ["panel the task: plan"]);
  assert.equal(document.querySelector(DIALOG), null);
});

test("arriving on a task is one screen, the tabs that arrive with it taking it in place, so ⌃Tab goes back where you came from", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, {}, { agent: "x" }));

  tab();
  letGo();
  assert.deepEqual(told, { shown: [], places: ["inbox"] });
});

test("a screen picked restores both its panes, the task opened once", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, {}, { agent: "x" }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, { inboxView: inboxOpen() }));

  tab();
  letGo();
  assert.deepEqual(told.shown, ['column the task: {"agent":"x"}', "panel beside the task: code"]);
});

test("held, the cards show with the screen here first and dimmed; ⇧ steps back around, and Escape goes nowhere", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  tab();
  tab();
  const shown = cards();
  assert.equal(shown.length, 3);
  assert.deepEqual(
    shown.map((card) => card.getAttribute("aria-selected")),
    ["false", "false", "true"],
  );
  assert.match(shown[2]?.textContent ?? "", /Inbox/u);

  tab(true);
  tab(true);
  assert.equal(
    cards()[0]?.getAttribute("aria-selected"),
    "true",
    "back past the second card to the first",
  );
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();

  assert.equal(document.querySelector(DIALOG), null);
  assert.deepEqual(told, asked());
});

/** A field that holds focus before ⌃Tab, and the window moved from one task tab to another so the cards have two screens. */
async function heldOnField() {
  handCapabilities(DESKTOP_CAPABILITIES);
  const field = document.createElement("input");
  document.body.append(field);
  field.focus();
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));
  tab();
  tab();
  return field;
}

test("the cards stand in a dialog announced as modal that holds focus, and letting go hands focus back to where it was", async () => {
  const field = await heldOnField();

  const dialog = document.querySelector<HTMLElement>(DIALOG);
  assert.ok(dialog, "the cards are drawn in a dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(
    document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent,
    "Recent tabs",
  );
  assert.ok(dialog.contains(document.activeElement), "focus is held inside the dialog");

  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  assert.equal(document.activeElement, field);
});

test("the cards fade out as ⌃ is let go, drawn and inert through the exit, and are gone after it", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const exits = holdExits();
  await heldOnField();

  letGo();
  act(() => vi.advanceTimersToNextFrame());
  const standsAFrameOn = document.querySelector(DIALOG) !== null;
  await act(async () => exits.finish());

  assert.equal(standsAFrameOn, true);
  assert.equal(document.querySelector(DIALOG), null);
});

test("the cards go at once while motion is held", async () => {
  holdMotion();
  holdExits();
  await heldOnField();

  letGo();

  assert.equal(document.querySelector(DIALOG), null);
});

test("a task's card is named as Back's list names the screen: the task, then its panes' tabs", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  tab();
  tab();
  const words = cards().map((card) => [
    card.querySelector(".luke-tab-card-name")?.textContent,
    card.querySelector(".luke-tab-card-detail")?.textContent,
  ]);
  assert.deepEqual(words, [
    [DOCUMENT_TASK.name, "Code"],
    [DOCUMENT_TASK.name, "Plan"],
  ]);
});

test("a task's card says the task and its agent's tab by the names they go by now, and the agent as Back's list called it where nothing names it now", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  const column = { agent: "agent-token" };
  const agent = (title: string): CodingAgentSummary => ({
    id: column.agent,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
  });
  const named = (title: string | undefined, name = DOCUMENT_TASK.name) => ({
    tasks: [{ ...DOCUMENT_TASK, name }],
    agents: codingAgentsControl({ agents: title === undefined ? [] : [agent(title)] }),
  });
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, named("Token refresh"), column));
  press();
  await window.draw(
    onTask(SIDE_PANEL_TAB.CODE, told, named("Token renewal", "Auth rewrite"), column),
  );

  tab();
  tab();
  const left = () => {
    const card = cards()[1];
    return [
      card?.querySelector(".luke-tab-card-name")?.textContent,
      card?.querySelector(".luke-tab-card-detail")?.textContent,
    ];
  };
  assert.deepEqual(left(), ["Auth rewrite", "Token renewal · Plan"]);

  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, named(undefined, "Auth rewrite"), column));
  assert.deepEqual(left(), ["Auth rewrite", "Token refresh · Plan"]);
});

test("a person's page card wears their face and name, not a generic icon", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  const person = {
    ...tasksControl().personView,
    userId: "user-ada",
    name: "Ada Lovelace",
    workspaceId: undefined,
  };
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { personView: person }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));

  tab();
  tab();
  const card = cards().find((each) => each.textContent?.includes("Ada Lovelace"));
  assert.ok(card, "the person's page is a card");
  assert.equal(card.querySelector<HTMLElement>(".actor-mark")?.dataset.kind, "person");
});

/** A channel of the workspace as the service answers it, synthetic. */
function channelNamed(name: string, id: string): Channel {
  return { id, name, purpose: "", project: false, createdAt: 1, waiting: 0 };
}

/** What reads the workspace's channels as the window's sidebar does, so the window holds them. */
function ChannelsRead({ workspaceId }: { workspaceId: string }): null {
  useChannels(workspaceId, true);
  return null;
}

/** The cards' names with Channels on and the workspace's channels read, held over a task with the Inbox's place the stop behind, in `room`, the place standing a phone's list of channels where `listed`. */
async function channelCardNames(room: ShellRoom, listed: boolean): Promise<string[]> {
  const base = stateWith({}, {});
  handState(experimentsOn(EXPERIMENT.CHANNELS), {
    run: { ...base.run, capabilities: DESKTOP_CAPABILITIES },
  });
  fakeActPort({
    [ACT_KIND.CHANNELS_LIST]: () =>
      Promise.resolve({
        channels: [
          channelNamed("app", "a1000001-6d9f-4ab7-92df-000000000001"),
          channelNamed("general", "a1000001-6d9f-4ab7-92df-000000000002"),
        ],
      }),
  });
  const workspace = {
    id: "workspace-acme",
    name: "Acme",
    role: WORKSPACE_ROLE.MEMBER,
    github: null,
  };
  const reader = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(reader);
  await act(async () => {
    reader.render(
      onRegistry(AtomRegistry.make(), createElement(ChannelsRead, { workspaceId: workspace.id })),
    );
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
  const told = asked();
  const window = await mounted(room);
  const inboxView = { ...tasksControl().inboxView, listed };
  await window.draw(
    onTask(SIDE_PANEL_TAB.PLAN, told, { workspace, inboxView: { ...inboxView, open: true } }),
  );
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, { workspace, inboxView }));

  tab();
  tab(true);
  return cards().map((card) => card.textContent ?? "");
}

test("with Channels on, the Inbox's card names the channel its place shows", async () => {
  const names = await channelCardNames(SHELL_ROOM.WIDE, false);
  assert.ok(
    names.some((name) => name.includes("#general")),
    "the card names #general, the channel shown where none was chosen",
  );
  assert.ok(!names.some((name) => /Inbox/u.test(name)));
});

test("with Channels on, a phone standing its list of channels names the Inbox's card for the list, not a channel", async () => {
  const names = await channelCardNames(SHELL_ROOM.NARROW, true);
  assert.ok(names.includes("Channels"));
  assert.ok(!names.some((name) => name.includes("#general")));
});

test("a card pressed while the cards show is gone to, a place through its own door", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  tab();
  tab(true);
  const inbox = cards().find((card) => /Inbox/u.test(card.textContent ?? ""));
  assert.ok(inbox);
  act(() => {
    inbox.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true }),
    );
  });

  assert.deepEqual(told.places, ["inbox"]);
  assert.equal(document.querySelector(DIALOG), null);
});

test("the screen left is taken as a still of the work area for its card, drawn as it lands while the cards show, and the session recording leaves it out", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const taken: unknown[] = [];
  let answer: (still: string) => void = () => undefined;
  fakeActPort({
    [ACT_KIND.WINDOW_CAPTURE]: (part) => {
      taken.push(part);
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    },
  });
  const work = document.createElement("main");
  work.className = "desktop-main";
  work.getBoundingClientRect = () => new DOMRect(240, 0, 1040, 800);
  document.body.append(work);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  tab();
  tab();
  assert.equal(cards()[0]?.querySelector("img"), null, "no still yet, so the glyph stands");
  await act(async () => {
    answer(STILL);
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });

  assert.deepEqual(taken, [{ x: 240, y: 0, width: 1040, height: 800 }]);
  const preview = cards()[0]?.querySelector(".luke-tab-card-preview");
  assert.ok(preview?.classList.contains("ph-no-capture"));
  assert.equal(preview?.querySelector("img")?.getAttribute("src"), STILL);
  assert.equal(cards()[1]?.querySelector("img"), null, "a stop with no still wears its glyph");
});

test("a window that is no desktop app leaves ⌃Tab to the browser", async () => {
  handCapabilities(DESKTOP_CAPABILITIES.filter((each) => each !== HOST_CAPABILITY.DESKTOP_APP));
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), false);
  assert.deepEqual(told, asked());
});

test("the menu bar's Next recent tab goes at once, as a tap does", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB));
  });
  assert.deepEqual(told.shown, ["panel the task: plan"]);
});

test("a dialog over the window keeps ⌃Tab, so nothing moves behind it", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);

  assert.equal(tab().defaultPrevented, false);
  letGo();
  assert.equal(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB), true);
  assert.deepEqual(told, asked());
});

test("a screen whose tab closed since it was left is no stop", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  const closed = onTask(SIDE_PANEL_TAB.CODE, told);
  await window.draw({
    ...closed,
    sidePanel: { ...closed.sidePanel, strip: [SIDE_PANEL_TAB.CODE] },
  });

  tab();
  letGo();
  assert.deepEqual(told, { shown: [], places: ["inbox"] });
});

test("a task's screens stay stops while the Inbox stands in its place with a panel strip of its own", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));
  press();
  const over = onTask(SIDE_PANEL_TAB.CODE, told, { inboxView: inboxOpen() });
  await window.draw({ ...over, sidePanel: { ...over.sidePanel, strip: [] } });

  tab();
  letGo();
  assert.deepEqual(told.shown, ["panel the task: code"]);
});

test("a tab closed on its task's page stays let go once the Inbox stands in the task's place", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { boundFor: undefined }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  const closed = onTask(SIDE_PANEL_TAB.PLAN, told);
  await window.draw({
    ...closed,
    sidePanel: { ...closed.sidePanel, strip: [SIDE_PANEL_TAB.PLAN] },
  });
  press();
  const over = onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() });
  await window.draw({ ...over, sidePanel: { ...over.sidePanel, strip: [] } });

  tab();
  tab();
  assert.deepEqual(
    cards().map((card) => card.querySelector(".luke-tab-card-detail")?.textContent),
    ["", "Plan"],
  );
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();
});

test("a task opened before its row reaches the list stays a stop, and one gone from the list once left does not", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { tasks: [] }));
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));

  tab();
  letGo();
  assert.deepEqual(told.shown, ["panel the task: plan"]);

  await window.draw(
    onTask(SIDE_PANEL_TAB.PLAN, told, {
      inboxView: inboxOpen(),
      activeTaskId: undefined,
      tasks: [],
    }),
  );
  tab();
  letGo();
  assert.deepEqual(told.shown, ["panel the task: plan"], "a task deleted since is no stop");
});

test("the open task gone from the list after it was listed, as one deleted by a teammate, is no stop", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { tasks: [] }));
  press();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told, { tasks: [], inboxView: inboxOpen() }));

  tab();
  letGo();
  assert.deepEqual(told, asked());
});

test("a screen picked past unsaved work is restored only once the leave is confirmed, both panes together", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const asks: (() => void)[] = [];
  const guarded = {
    stand: () => () => undefined,
    pass: (leave: () => void) => leave(),
    guard:
      <Args extends readonly unknown[]>(leave: (...args: Args) => void) =>
      (...args: Args) =>
        asks.push(() => leave(...args)),
  };
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told, { leaveGuard: guarded }, { agent: "x" }));
  press();
  await window.draw(
    onTask(SIDE_PANEL_TAB.CODE, told, { inboxView: inboxOpen(), leaveGuard: guarded }),
  );

  tab();
  letGo();
  assert.deepEqual(told.shown, [], "nothing moves while the ask stands");
  tab();
  tab();
  assert.equal(
    cards()[0]?.dataset.here,
    "true",
    "a leave not yet confirmed leaves the screen here first",
  );
  assert.match(cards()[0]?.textContent ?? "", /Inbox/u);
  key("keydown", { key: "Escape", code: "Escape", ctrlKey: true });
  letGo();
  asks[0]?.();
  assert.deepEqual(told.shown, ['column the task: {"agent":"x"}', "panel beside the task: code"]);
});

test("a narrow room's panel, which fills the window as it stands, is opened on the screen's tab and not toggled shut", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const turned: string[] = [];
  const narrow = (control: TasksControl): TasksControl => ({
    ...control,
    sidePanel: {
      ...control.sidePanel,
      fullScreenOnly: true,
      onToggleFullScreen: () => turned.push("full screen turned"),
    },
  });
  const window = await mounted();
  const filled = onTask(SIDE_PANEL_TAB.CODE, told);
  await window.draw(narrow({ ...filled, sidePanel: { ...filled.sidePanel, fullScreen: true } }));
  press();
  const shut = onTask(SIDE_PANEL_TAB.CODE, told, { inboxView: inboxOpen() });
  await window.draw(narrow({ ...shut, sidePanel: { ...shut.sidePanel, open: false } }));

  tab();
  letGo();
  assert.deepEqual(told.shown, ["panel the task: code"]);
  assert.deepEqual(turned, []);
});

test("a screen picked with its panel shut shuts the panel, and one with the panel filling the window fills it again", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const panel: string[] = [];
  const doors = (control: TasksControl): TasksControl => ({
    ...control,
    sidePanel: {
      ...control.sidePanel,
      onSetOpen: (open) => panel.push(open ? "opened" : "shut"),
      onToggleFullScreen: () => panel.push("full screen turned"),
    },
  });
  const window = await mounted();
  const shut = onTask(SIDE_PANEL_TAB.PLAN, told, {}, { agent: "x" });
  await window.draw(doors({ ...shut, sidePanel: { ...shut.sidePanel, open: false } }));
  press();
  const filled = onTask(SIDE_PANEL_TAB.CODE, told, {}, { agent: "x" });
  await window.draw(doors({ ...filled, sidePanel: { ...filled.sidePanel, fullScreen: true } }));
  press();
  await window.draw(doors(onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: inboxOpen() })));

  tab();
  letGo();
  assert.deepEqual(told.shown, ["panel the task: code"]);
  assert.deepEqual(panel, ["full screen turned"]);

  press();
  await window.draw(
    doors(
      onTask(SIDE_PANEL_TAB.PLAN, told, {
        inboxView: { ...inboxOpen(), open: false },
        boardView: { ...tasksControl().boardView, open: true },
      }),
    ),
  );
  tab(true);
  letGo();
  assert.deepEqual(told.shown, ["panel the task: code", 'column the task: {"agent":"x"}']);
  assert.deepEqual(panel, ["full screen turned", "shut"]);
});

/** An agent with no task, listed in the window, as the sidebar lists it. */
function listedAgent(status: TasklessAgent["status"]): TasklessAgent {
  return {
    id: "0a1b2c3d-0000-4000-8000-200000000001",
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Sweep flaky tests",
    createdAt: 1,
    status,
    turnId: null,
    startedBy: { userId: "user-ada", name: "Ada Lovelace" },
    automationId: null,
    workspaceId: "workspace-acme",
    repository: "acme/relay",
    activityAt: 1,
  };
}

/** The switcher's cards, held over the agent's page and then the Inbox, so the agent is the stop behind. */
async function agentCardAfter(status: TasklessAgent["status"]): Promise<HTMLElement | undefined> {
  handCapabilities(DESKTOP_CAPABILITIES);
  const agent = listedAgent(status);
  const listed = { listedAgents: { standing: [agent], archived: [] } };
  const base = tasksControl();
  const window = await mounted();
  await window.draw({
    ...base,
    ...listed,
    agentView: { ...base.agentView, agentId: agent.id },
  });
  press();
  await window.draw({ ...base, ...listed, inboxView: inboxOpen() });
  tab();
  tab();
  return cards().find((card) => card.textContent?.includes(agent.title ?? ""));
}

test("an agent's stop whose turn failed says so at its end, as its row and its tab do", async () => {
  const card = await agentCardAfter(CODING_AGENT_STATUS.FAILED);
  assert.ok(card?.querySelector(".failed-mark"));
});

test("an agent's stop that finished says nothing at its end", async () => {
  const card = await agentCardAfter(CODING_AGENT_STATUS.COMPLETED);
  assert.ok(card);
  assert.equal(card.querySelector(".failed-mark"), null);
});
