// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MenuRow } from "@luke/panel/settings/menu-row";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { CopyIcon } from "lucide-react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { LinesMenu } from "../tasks/file-menu";

/**
 * The window's menus as the developer opens them: a ⋯ that drops its menu
 * and closes it again, a right-click that hangs the same menu at the
 * pointer, or under the row where the menu key asked with no point of its
 * own, and a row's acts in groups ruled apart. How the menu itself behaves
 * is `@luke/ui`'s `Menu`'s, tested beside it.
 */

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const ignore = () => undefined;
const ACTIONS = [{ label: "Copy key", icon: createElement(CopyIcon), onSelect: ignore }];

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The menu standing open, if one is: drawn and not on its way out. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

function press(button: HTMLElement): void {
  act(() => button.click());
}

function rightClick(target: HTMLElement, at: { x: number; y: number }): void {
  act(() => {
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
      }),
    );
  });
}

/** Lays an element out where the window would, which jsdom never does. */
function placeAt(element: Element, box: { left: number; top: number; bottom: number }): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: box.left, y: box.top, width: 120, height: box.bottom - box.top }),
  );
}

test("a Settings row's ⋯ and a file bar's ⋯ each open their menu on a press and close it on the next", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(MenuRow, { label: "Linear actions", actions: ACTIONS, children: "Linear" }),
      createElement(LinesMenu, { label: "File actions", actions: ACTIONS }),
    ),
  );
  for (const name of ["Linear actions", "File actions"]) {
    const ellipsis = container.querySelector<HTMLElement>(`button[aria-label="${name}"]`);
    assert.ok(ellipsis, `the ${name} ⋯ is drawn`);
    assert.equal(ellipsis.getAttribute("aria-haspopup"), "menu");

    press(ellipsis);
    assert.equal(openMenu()?.getAttribute("aria-label"), name, `the ${name} ⋯ opens its menu`);
    assert.equal(ellipsis.getAttribute("aria-expanded"), "true");

    press(ellipsis);
    assert.equal(openMenu(), null, `a second press on the ${name} ⋯ closes its menu`);
    assert.equal(ellipsis.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, ellipsis, "focus is back on the ⋯");
  }
});

test("a right-click opens the row's menu at the pointer, and the menu key's under the row", () => {
  const container = mount(
    createElement(MenuRow, { label: "Linear actions", actions: ACTIONS, children: "Linear" }),
  );
  const row = container.querySelector<HTMLElement>(".settings-row");
  assert.ok(row, "the row is drawn");

  rightClick(row, { x: 300, y: 200 });
  const atPointer = openMenu();
  assert.equal(atPointer?.style.left, "300px", "the menu hangs where the pointer is");
  assert.equal(atPointer?.style.top, "200px");
  act(() =>
    atPointer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  assert.equal(openMenu(), null, "Escape closes it");
  assert.equal(
    document.activeElement,
    container.querySelector('button[aria-label="Linear actions"]'),
    "and hands focus to the row's ⋯, its door from the keyboard",
  );

  // The menu key's right-click says no point of its own: the menu drops
  // under the row from its start rather than into the window's corner.
  placeAt(row, { left: 40, top: 60, bottom: 100 });
  rightClick(row, { x: 0, y: 0 });
  assert.equal(openMenu()?.style.left, "40px", "the menu key's menu starts at the row's start");
  assert.equal(openMenu()?.style.top, "104px", "and hangs under the row");
});

test("a Settings row's ⋯ opens its acts in groups ruled apart, and Escape, Tab, or a press elsewhere closes them, focus back on the ⋯", () => {
  const container = mount(
    createElement(MenuRow, {
      label: "GitHub actions",
      actions: [ACTIONS, [{ label: "Disconnect", danger: true, onSelect: ignore }]],
      children: "GitHub",
    }),
  );
  const row = container.querySelector<HTMLElement>(".settings-row");
  assert.ok(row, "the row is drawn");
  const ellipsis =
    row.querySelector<HTMLButtonElement>('button[aria-label="GitHub actions"]') ??
    assert.fail("no ⋯");
  assert.equal(ellipsis.getAttribute("aria-haspopup"), "menu");

  press(ellipsis);
  const menu = openMenu();
  assert.equal(menu?.getAttribute("aria-label"), "GitHub actions", "the menu keeps its name");
  assert.equal(ellipsis.getAttribute("aria-expanded"), "true");
  assert.deepEqual(
    [...(menu?.children ?? [])].map((child) =>
      child.tagName === "HR" ? "rule" : (child.textContent ?? ""),
    ),
    ["Copy key", "rule", "Disconnect"],
  );
  assert.equal(document.activeElement?.textContent, "Copy key", "focus lands on the first item");
  act(() => menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  assert.equal(document.activeElement?.textContent, "Disconnect", "Down walks past the rule");
  act(() => menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(openMenu(), null, "Escape closes it");
  assert.equal(ellipsis.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, ellipsis, "and focus is back on the ⋯");

  rightClick(row, { x: 300, y: 200 });
  assert.equal(openMenu()?.getAttribute("aria-label"), "GitHub actions", "a right-click opens it");
  act(() =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    ),
  );
  assert.equal(openMenu(), null, "Tab closes it");
  assert.equal(document.activeElement, ellipsis, "handing focus to the ⋯, the keyboard's door");

  press(ellipsis);
  act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  assert.equal(openMenu(), null, "a press elsewhere closes it");
});

test("a Settings row keeps its ⋯, named for its menu, and More on the pointer", () => {
  const container = mount(
    createElement(MenuRow, { label: "Linear actions", actions: ACTIONS, children: "Linear" }),
  );
  const ellipsis =
    container.querySelector<HTMLButtonElement>('button[aria-label="Linear actions"]') ??
    assert.fail("no ⋯");

  act(() => ellipsis.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));

  assert.equal(ellipsis.textContent, "", "with no words of its own");
  assert.equal(document.querySelector(".luke-tooltip")?.textContent, "More");
});
