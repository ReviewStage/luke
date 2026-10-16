// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CopyIcon } from "lucide-react";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { SearchableMenu } from "../searchable-menu";
import { MenuRow } from "../settings/menu-row";
import { LinesMenu } from "../tasks/file-menu";
import { ActionMenu, useActionMenu } from "./action-menu";

/**
 * The window's menus as the developer opens them: a ⋯ that drops its menu
 * and closes it again, a right-click that hangs the same menu at the
 * pointer, or under the row where the menu key asked with no point of its
 * own, a row's acts in groups ruled apart, and every menu, the window's own and the searchable picker alike,
 * drawn on one surface with one row.
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

test("the window's menu and the searchable picker stand on one surface and draw one row", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(MenuRow, { label: "Linear actions", actions: ACTIONS, children: "Linear" }),
      createElement(SearchableMenu, {
        id: "repository",
        label: "Repository",
        placeholder: "Search repositories",
        rows: [{ id: "acme/relay", label: "acme/relay", icon: createElement(CopyIcon) }],
        value: undefined,
        noMatch: "No match",
        onPick: ignore,
        onClose: ignore,
        onLeave: ignore,
      }),
    ),
  );
  const ellipsis = container.querySelector<HTMLElement>('button[aria-label="Linear actions"]');
  assert.ok(ellipsis, "the ⋯ is drawn");
  press(ellipsis);

  const menus = [openMenu(), document.querySelector<HTMLElement>('[role="dialog"]')];
  for (const menu of menus) {
    assert.ok(menu, "the menu is drawn");
    const name = menu.getAttribute("aria-label");
    assert.ok(menu.classList.contains("menu-surface"), `${name} stands on the menu surface`);
    const row = menu.querySelector('[role="menuitem"], [role="option"]');
    assert.ok(row, `${name} draws a row`);
    assert.ok(row.classList.contains("menu-item"), `${name}'s rows are the one menu row`);
    assert.ok(row.querySelector(".menu-item-glyph > svg"), "with the mark in the glyph slot");
  }
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

test("a Settings row keeps its muted ⋯, named for its menu, and More on the pointer", () => {
  const container = mount(
    createElement(MenuRow, { label: "Linear actions", actions: ACTIONS, children: "Linear" }),
  );
  const ellipsis =
    container.querySelector<HTMLButtonElement>('button[aria-label="Linear actions"]') ??
    assert.fail("no ⋯");

  act(() => ellipsis.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));

  assert.ok(ellipsis.classList.contains("icon-button"), "the ⋯ is the muted glyph button");
  assert.equal(ellipsis.textContent, "", "with no words of its own");
  assert.equal(document.querySelector(".luke-tooltip")?.textContent, "More");
});

/** A menu of two submenus, as the sidebar's View options is: Group by over Order by. */
function TwoSubmenus(): React.JSX.Element {
  const menu = useActionMenu(true);
  const choice = (label: string) => ({ label, checked: false, onSelect: ignore });
  return createElement(
    Fragment,
    null,
    createElement("button", { type: "button", ...menu.trigger() }, "View options"),
    menu.drawn === undefined
      ? null
      : createElement(ActionMenu, {
          label: "View options",
          menu: menu.drawn,
          groups: [
            [
              { label: "Group by", items: [choice("Repository"), choice("None")] },
              { label: "Order by", items: [choice("Last updated"), choice("Name")] },
            ],
          ],
          onClose: menu.close,
        }),
  );
}

/** The menu item that opens the submenu named `label`. */
function submenuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(item, `${label} is drawn`);
  return item;
}

/** The pointer moving onto `to`, from `from` or from outside the window, as a browser reports it. */
function pointerMove(from: HTMLElement | null, to: HTMLElement): void {
  act(() => {
    from?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

test("resting on one submenu's item after another's opens the second's submenu, with no press", () => {
  const container = mount(createElement(TwoSubmenus));
  const button = container.querySelector("button");
  assert.ok(button, "the menu's button is drawn");
  press(button);

  pointerMove(null, submenuItem("Group by"));
  assert.ok(document.querySelector('[role="menu"][aria-label="Group by"]'), "Group by opens");

  pointerMove(submenuItem("Group by"), submenuItem("Order by"));
  assert.ok(document.querySelector('[role="menu"][aria-label="Order by"]'), "Order by opens");
  assert.equal(document.querySelector('[role="menu"][aria-label="Group by"]'), null);

  pointerMove(submenuItem("Order by"), submenuItem("Group by"));
  act(() => {
    submenuItem("Order by").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  assert.ok(document.querySelector('[role="menu"][aria-label="Order by"]'), "→ opens Order by");
});
