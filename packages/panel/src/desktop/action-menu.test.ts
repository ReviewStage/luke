// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CopyIcon } from "lucide-react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { MenuRow } from "../settings/menu-row.js";
import { BarMenu } from "../tasks/file-menu.js";
import { restOn } from "../testing/hint-rest.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";

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
/** Where the open menu hangs, once Base UI has placed it over the few promises it places it in: its positioner's offset. */
async function hungAt(): Promise<{ left: string; top: string } | undefined> {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });
  const at = /translate\((-?[\d.]+px), (-?[\d.]+px)\)/u.exec(
    openMenu()?.parentElement?.style.transform ?? "",
  );
  return at === null ? undefined : { left: at[1] ?? "", top: at[2] ?? "" };
}

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
      createElement(MenuRow, { thing: "Linear", actions: ACTIONS, children: "Linear" }),
      createElement(BarMenu, { label: "File actions", actions: ACTIONS }),
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

test("a right-click opens the row's menu at the pointer, and the menu key's under the row", async () => {
  const container = mount(
    createElement(MenuRow, { thing: "Linear", actions: ACTIONS, children: "Linear" }),
  );
  const row = container.querySelector<HTMLElement>(".settings-row");
  assert.ok(row, "the row is drawn");

  rightClick(row, { x: 300, y: 200 });
  const atPointer = openMenu();
  const hung = await hungAt();
  assert.equal(hung?.left, "300px", "the menu hangs where the pointer is");
  assert.equal(hung?.top, "200px");
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
  const under = await hungAt();
  assert.equal(under?.left, "40px", "the menu key's menu starts at the row's start");
  assert.equal(under?.top, "104px", "and hangs under the row");
});

test("the menu key and ⇧F10 on a Settings row open the same menu under the row", async () => {
  const container = mount(
    createElement(MenuRow, { thing: "Linear", actions: ACTIONS, children: "Linear" }),
  );
  const row = container.querySelector<HTMLElement>(".settings-row") ?? assert.fail("no row");
  placeAt(row, { left: 40, top: 60, bottom: 100 });
  for (const key of [{ key: "ContextMenu" }, { key: "F10", shiftKey: true }]) {
    act(() => {
      row.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }));
    });
    assert.equal(openMenu()?.getAttribute("aria-label"), "Linear actions");
    assert.equal((await hungAt())?.left, "40px", "the menu hangs under the row from its start");
    act(() =>
      openMenu()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    assert.equal(openMenu(), null);
  }
});

test("Escape from a menu the menu key opened on a Settings row's ⋯ hands focus back to the ⋯", () => {
  const container = mount(
    createElement(MenuRow, { thing: "Linear", actions: ACTIONS, children: "Linear" }),
  );
  const ellipsis =
    container.querySelector<HTMLButtonElement>('button[aria-label="Linear actions"]') ??
    assert.fail("no ⋯");
  act(() => ellipsis.focus());
  act(() => {
    ellipsis.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }),
    );
  });
  const menu = openMenu();
  assert.ok(menu, "the menu key opens it");
  act(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(openMenu(), null);
  assert.equal(document.activeElement, ellipsis, "focus is back on the ⋯");
});

test("a Settings row's ⋯ opens its acts in groups ruled apart, and Escape, Tab, or a press elsewhere closes them, focus back on the ⋯", () => {
  const container = mount(
    createElement(MenuRow, {
      thing: "GitHub",
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

test("a Settings row keeps its ⋯, named for its menu, and says so on the pointer", () => {
  const container = mount(
    createElement(MenuRow, { thing: "Linear", actions: ACTIONS, children: "Linear" }),
  );
  const ellipsis =
    container.querySelector<HTMLButtonElement>('button[aria-label="Linear actions"]') ??
    assert.fail("no ⋯");

  restOn(ellipsis);

  assert.equal(ellipsis.textContent, "", "with no words of its own");
  assert.equal(document.querySelector(".luke-tooltip")?.textContent, "Linear actions");
});
