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
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { tasksControl } from "../testing/tasks-control.js";
import { TabSwitcher } from "./tab-switcher.js";

/**
 * tab-switcher.test.ts -- ⌃Tab as the window answers it: a quick tap going
 * to the tab before through the task's own door and drawing nothing, a hold
 * drawing the cards with the stop here first and dimmed, ⇧ stepping back,
 * Escape going nowhere, a card pressed gone to, and a still of the stop
 * left kept for its card, out of the session recording. A browser keeps
 * ⌃Tab for its own tabs, so a window that is no desktop app leaves it.
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
  readonly panelTabs: [string, SidePanelTab][];
  readonly places: string[];
}

/** The window on the task, its panel on `tab`, every door the switcher may use recorded in `asked`. */
function onTask(
  tab: SidePanelTab,
  asked: Asked,
  overrides: Partial<TasksControl> = {},
): TasksControl {
  const base = tasksControl({ activeTaskId: TASK, tasks: [{ ...DOCUMENT_TASK }] });
  return {
    ...base,
    sidePanel: { ...base.sidePanel, open: true, tab },
    onShowPanelTab: (taskId, shown) => asked.panelTabs.push([taskId, shown]),
    inboxView: { ...base.inboxView, onOpen: () => asked.places.push("inbox") },
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

function cards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".tab-switcher-card")];
}

const asked = (): Asked => ({ panelTabs: [], places: [] });

test("a quick tap goes to the tab before through the task's own door, and draws nothing", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  const press = tab();
  assert.equal(
    press.defaultPrevented,
    true,
    "⌃Tab is the switcher's, not the field's or the terminal's under it",
  );
  letGo();

  assert.deepEqual(told.panelTabs, [[TASK, SIDE_PANEL_TAB.PLAN]]);
  assert.equal(document.querySelector(".tab-switcher"), null);
});

test("held, the cards show with the stop here first and dimmed; ⇧ steps back around, and Escape goes nowhere", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(
    onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: { ...tasksControl().inboxView, open: true } }),
  );
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
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

test("a card pressed while the cards show is gone to, a place through its own door", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const told = asked();
  const window = await mounted();
  await window.draw(
    onTask(SIDE_PANEL_TAB.PLAN, told, { inboxView: { ...tasksControl().inboxView, open: true } }),
  );
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

test("the stop left is taken as a still for its card, which the session recording leaves out", async () => {
  handCapabilities(DESKTOP_CAPABILITIES);
  const taken: unknown[] = [];
  fakeActPort({
    [ACT_KIND.WINDOW_CAPTURE]: (part) => {
      taken.push(part);
      return Promise.resolve(STILL);
    },
  });
  const panel = document.createElement("div");
  panel.className = "side-panel";
  panel.getBoundingClientRect = () => new DOMRect(880, 0, 400, 800);
  document.body.append(panel);
  const told = asked();
  const window = await mounted();
  await window.draw(onTask(SIDE_PANEL_TAB.PLAN, told));
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  tab();
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
  tab();
  tab();

  assert.deepEqual(taken, [{ x: 880, y: 0, width: 400, height: 800 }]);
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
  await window.draw(onTask(SIDE_PANEL_TAB.CODE, told));

  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.NEXT_RECENT_TAB));
  });
  assert.deepEqual(told.panelTabs, [[TASK, SIDE_PANEL_TAB.PLAN]]);
});
