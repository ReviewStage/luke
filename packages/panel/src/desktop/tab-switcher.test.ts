// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { HOST_CAPABILITY } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { PANEL_TAB } from "../panel-tabs.js";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { TabSwitcher } from "./tab-switcher.js";

/**
 * tab-switcher.test.ts -- ⌃Tab as the window answers it: a stop is a whole
 * screen, so arriving on a task with both panes is one stop and a tab the
 * window chose by itself takes it in place; a quick tap goes to the screen
 * before through the task's own doors, both panes restored, and draws
 * nothing; a hold draws the cards, the screen here first and dimmed, each
 * named as Back's list names it; ⇧ steps back, Escape goes nowhere, a card
 * pressed is gone to, and a still of the work area left is kept for its
 * card, out of the session recording. A browser keeps ⌃Tab for its own
 * tabs, so a window that is no desktop app leaves it.
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
});

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
async function mounted() {
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
          createElement(TabSwitcher, {
            available: true,
            tab: PANEL_TAB.TASKS,
            onTabChange: () => undefined,
            tasks,
          }),
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
  return [...document.querySelectorAll<HTMLElement>(".tab-switcher-card")];
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
  assert.equal(document.querySelector(".tab-switcher"), null);
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
  assert.equal(shown[0]?.dataset.here, "true");
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

  assert.equal(document.querySelector(".tab-switcher"), null);
  assert.deepEqual(told, asked());
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
    card.querySelector(".tab-switcher-name")?.textContent,
    card.querySelector(".tab-switcher-detail")?.textContent,
  ]);
  assert.deepEqual(words, [
    [DOCUMENT_TASK.name, "Code"],
    [DOCUMENT_TASK.name, "Plan"],
  ]);
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
  assert.equal(document.querySelector(".tab-switcher"), null);
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
  const preview = cards()[0]?.querySelector(".tab-switcher-preview");
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
    cards().map((card) => card.querySelector(".tab-switcher-detail")?.textContent),
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
        chatView: { ...tasksControl().chatView, open: true },
      }),
    ),
  );
  tab(true);
  letGo();
  assert.deepEqual(told.shown, ["panel the task: code", 'column the task: {"agent":"x"}']);
  assert.deepEqual(panel, ["full screen turned", "shut"]);
});
