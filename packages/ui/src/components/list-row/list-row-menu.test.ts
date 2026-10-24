// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import type { MenuEntry } from "../menu/menu.js";
import { List, ListRow, type ListRowMenu } from "./list-row.js";

/**
 * list-row-menu.test.ts -- a row's one menu (`menu`) opens alike from its
 * ⋯, a right-click anywhere on the row, and the menu key or ⇧F10 on the
 * row's press or its ⋯: the same items, named for the row's thing, and an
 * item chosen does its act. The ⋯ is a Tab stop after the row's press and
 * its other acts, named "{Thing} actions" and described by the row's title,
 * and Escape hands focus back to the door the keyboard opened the menu
 * from. A row whose thing offers no acts now, or which is unavailable,
 * draws no ⋯ and opens nothing by any door. Synthetic tasks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TASK = "Fix the sign-in loop";

const roots: Root[] = [];

// Note that every row measures its title, which needs a ResizeObserver jsdom lacks.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Draws `element` into a container in the document and hands the container back. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The menu of a task's acts, its choices written to `chosen`. */
function taskMenu(chosen: string[]): ListRowMenu {
  const groups: readonly (readonly MenuEntry[])[] = [
    [
      { label: "Rename", onSelect: () => chosen.push("Rename") },
      { label: "Archive", onSelect: () => chosen.push("Archive") },
    ],
    [{ label: "Delete", danger: true, onSelect: () => chosen.push("Delete") }],
  ];
  return { thing: "Task", groups };
}

/** One task's row in a list, with a Pin act beside its press, and what its press opened. */
function TaskList({
  menu,
  disabled = false,
}: {
  menu: ListRowMenu;
  disabled?: boolean;
}): React.JSX.Element {
  const [opened, setOpened] = useState(0);
  return createElement(
    "div",
    null,
    createElement(List, {
      label: "Tasks",
      children: createElement(ListRow, {
        title: TASK,
        meta: "2h",
        disabled,
        onPress: () => setOpened((count) => count + 1),
        actions: createElement(IconButton, { icon: createElement("svg"), label: "Pin" }),
        menu,
      }),
    }),
    createElement("output", null, `opened ${opened}`),
  );
}

/** The button named `name`, by its label or its words. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

/** The row's press, named by its words. */
function rowPress(): HTMLButtonElement {
  return button(`${TASK}2h`);
}

/** The menu standing open, or nothing. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

/** What the open menu offers, by its items' words, and what it is named. */
function offered(): { label: string | null; items: string[] } {
  const menu = openMenu();
  if (menu === null) throw new Error("No menu open");
  const items = [...menu.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
  return { label: menu.getAttribute("aria-label"), items };
}

/** Presses `key` on `target`, with ⇧ where asked. */
function key(target: HTMLElement, name: string, shiftKey = false): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

/** Closes the open menu by Escape, on whatever holds the focus. */
function pressEscape(): void {
  key((document.activeElement as HTMLElement | null) ?? document.body, "Escape");
}

const SAME_MENU = { label: "Task actions", items: ["Rename", "Archive", "Delete"] };

test("the row's ⋯, a right-click on it, and the menu key on it all open the same menu", () => {
  draw(createElement(TaskList, { menu: taskMenu([]) }));
  expect(openMenu()).toBeNull();

  act(() => button("Task actions").click());
  expect(offered()).toEqual(SAME_MENU);
  pressEscape();
  expect(openMenu()).toBeNull();

  act(() => {
    rowPress().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 8 }),
    );
  });
  expect(offered()).toEqual(SAME_MENU);
  pressEscape();

  key(rowPress(), "ContextMenu");
  expect(offered()).toEqual(SAME_MENU);
  pressEscape();

  key(rowPress(), "F10", true);
  expect(offered()).toEqual(SAME_MENU);
});

test("a right-click on the row's other acts opens its menu too, and opens nothing of the row", () => {
  draw(createElement(TaskList, { menu: taskMenu([]) }));
  act(() => {
    button("Pin").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 8 }),
    );
  });
  expect(offered()).toEqual(SAME_MENU);
  expect(document.querySelector("output")?.textContent).toBe("opened 0");
});

test("an item chosen from the menu does its act and closes the menu, the row left unopened", () => {
  const chosen: string[] = [];
  draw(createElement(TaskList, { menu: taskMenu(chosen) }));
  key(rowPress(), "ContextMenu");
  const archive = [...(openMenu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
    (item) => item.textContent === "Archive",
  );
  act(() => archive?.click());
  expect(chosen).toEqual(["Archive"]);
  expect(openMenu()).toBeNull();
  expect(document.querySelector("output")?.textContent).toBe("opened 0");
});

test("the ⋯ is a Tab stop after the row's press and its acts, named for the row's thing and described by its title", () => {
  draw(createElement(TaskList, { menu: taskMenu([]) }));
  const more = button("Task actions");
  const buttons = [...document.querySelectorAll("li button")];
  expect(buttons).toEqual([rowPress(), button("Pin"), more]);
  expect(more.tabIndex).toBe(0);
  expect(more.disabled).toBe(false);
  expect(more.getAttribute("aria-haspopup")).toBe("menu");
  const described = document.getElementById(more.getAttribute("aria-describedby") ?? "");
  expect(described?.textContent).toBe(TASK);
});

test("the keyboard opens the menu from the ⋯ it focused, and Escape hands focus back to it", () => {
  draw(createElement(TaskList, { menu: taskMenu([]) }));
  const more = button("Task actions");
  act(() => more.focus());
  key(more, "ContextMenu");
  expect(offered()).toEqual(SAME_MENU);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  pressEscape();
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(more);
});

test("Escape from a menu the menu key opened on the row's press hands focus back to the press", () => {
  draw(createElement(TaskList, { menu: taskMenu([]) }));
  const press = rowPress();
  act(() => press.focus());
  key(press, "F10", true);
  expect(openMenu()).not.toBeNull();
  pressEscape();
  expect(document.activeElement).toBe(press);
});

test("a row whose thing offers no acts now draws no ⋯, and neither a right-click nor the menu key opens anything", () => {
  draw(createElement(TaskList, { menu: { thing: "Task", groups: [[]] } }));
  expect(document.querySelector('button[aria-label="Task actions"]')).toBeNull();
  const press = rowPress();
  const rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => {
    press.dispatchEvent(rightClick);
  });
  key(press, "ContextMenu");
  expect(openMenu()).toBeNull();
  expect(rightClick.defaultPrevented).toBe(false);
});

test("an unavailable row draws no ⋯ and opens its menu by no door", () => {
  draw(createElement(TaskList, { menu: taskMenu([]), disabled: true }));
  expect(document.querySelector('button[aria-label="Task actions"]')).toBeNull();
  act(() => {
    rowPress().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  expect(openMenu()).toBeNull();
});

test("the arrows walk a list's rows past their ⋯, which stays a Tab stop of its own", () => {
  const names = ["Fix the sign-in loop", "Ship the spring release"] as const;
  draw(
    createElement(List, {
      label: "Tasks",
      children: names.map((name) =>
        createElement(ListRow, {
          key: name,
          title: name,
          onPress: () => undefined,
          menu: taskMenu([]),
        }),
      ),
    }),
  );
  const [first, second] = names.map((name) => button(name));
  if (first === undefined || second === undefined) throw new Error("No rows");
  act(() => first.focus());
  key(first, "ArrowDown");
  expect(document.activeElement).toBe(second);
  key(second, "ArrowDown");
  expect(document.activeElement).toBe(first);
  const mores = [
    ...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Task actions"]'),
  ];
  expect(mores.map((more) => more.tabIndex)).toEqual([0, 0]);
});

/** A pointer event on the row's swipe, `x` across, left held. */
function pointer(type: string, x: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: 10,
    pointerId: 1,
  });
}

test("a row swiped open still opens its menu on its ⋯'s first press, the swipe doing nothing", () => {
  const acted: string[] = [];
  draw(
    createElement(List, {
      label: "Tasks",
      children: createElement(ListRow, {
        title: TASK,
        onPress: () => undefined,
        swipe: { label: "Done", icon: createElement("svg"), onAct: () => acted.push("Done") },
        menu: taskMenu([]),
      }),
    }),
  );
  const item = document.querySelector("li") ?? expect.fail("the row stands");
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: 360, height: 56 }),
  );
  Object.assign(item, { setPointerCapture: () => undefined });
  const press = button(TASK);
  act(() => {
    press.dispatchEvent(pointer("pointerdown", 10));
    press.dispatchEvent(pointer("pointermove", 20));
    press.dispatchEvent(pointer("pointermove", 50));
    press.dispatchEvent(pointer("pointerup", 50));
    press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(item.dataset.swipe).toBe("open");
  const more = button("Task actions");
  act(() => {
    more.dispatchEvent(pointer("pointerdown", 340));
    more.dispatchEvent(pointer("pointerup", 340));
    more.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  expect(offered()).toEqual(SAME_MENU);
  expect(acted).toEqual([]);
});
