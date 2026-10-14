// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CopyIcon } from "lucide-react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { LinesMenu } from "../planning/file-menu";
import { SearchableMenu } from "../searchable-menu";
import { MenuRow } from "../settings/menu-row";

/**
 * The window's menus as the developer opens them: a ⋯ that drops its menu
 * and closes it again, a right-click that hangs the same menu at the
 * pointer, or under the row where the menu key asked with no point of its
 * own, and every menu, the window's own and the searchable picker alike,
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
