// @vitest-environment jsdom

import { act, createElement, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Card } from "../card/card.js";
import { Tooltip } from "../tooltip/hint.js";
import { type ListRowMenu, useRowMenu } from "./row-menu.js";

/**
 * row-menu.test.ts -- a row that is no `ListRow`, here a card, offers its
 * menu by the same three doors a `ListRow` does: the ⋯ `more` draws, a
 * right-click anywhere on the card, and the menu key or ⇧F10 on any control
 * in it. None is offered where the row has no acts or is unavailable.
 * Where the row's press hangs a hover card, the menu offers Show details,
 * which opens the card with focus inside it, and Escape hands focus back to
 * the press; a row hanging no card offers no Show details.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks: a card is placed once and never resized here. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function draw(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

const MENU: ListRowMenu = {
  thing: "Card",
  groups: [[{ label: "Rename", onSelect: () => undefined }]],
};

/** A card holding a press and a chip, with the menu its row hook offers. */
function MenuCard({
  menu,
  disabled = false,
}: {
  menu: ListRowMenu | undefined;
  disabled?: boolean;
}): React.JSX.Element {
  const press = useRef<HTMLButtonElement | null>(null);
  const row = useRowMenu(menu, { disabled, opener: press });
  return createElement(
    "div",
    null,
    createElement(Card, {
      ...row.props,
      children: [
        createElement("button", { key: "press", type: "button", ref: press }, "Press"),
        createElement("button", { key: "chip", type: "button" }, "Chip"),
        row.more(),
      ],
    }),
    row.popup,
  );
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

function menuLabel(): string | null {
  return document.querySelector('[role="menu"]')?.getAttribute("aria-label") ?? null;
}

function closeMenu(): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

test("the ⋯, a right-click on the card, and the menu key on its press or its chip open one menu named for the thing", () => {
  draw(createElement(MenuCard, { menu: MENU }));
  expect(menuLabel()).toBeNull();

  act(() => buttonNamed("Card actions").click());
  expect(menuLabel()).toBe("Card actions");
  closeMenu();

  act(() => {
    buttonNamed("Chip").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 9, clientY: 9 }),
    );
  });
  expect(menuLabel()).toBe("Card actions");
  closeMenu();

  for (const name of ["Press", "Chip"]) {
    act(() => {
      buttonNamed(name).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(menuLabel()).toBe("Card actions");
    closeMenu();
  }
});

test("a card with no acts, or unavailable, offers no ⋯ and opens nothing", () => {
  draw(createElement(MenuCard, { menu: { thing: "Card", groups: [[]] } }));
  expect(document.querySelector("button[aria-label='Card actions']")).toBeNull();
  act(() => {
    buttonNamed("Chip").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  expect(menuLabel()).toBeNull();

  document.body.replaceChildren();
  draw(createElement(MenuCard, { menu: MENU, disabled: true }));
  expect(document.querySelector("button[aria-label='Card actions']")).toBeNull();
});

/** A card whose press hangs a hover card holding a button, with the menu its row hook offers. */
function CardedMenuCard(): React.JSX.Element {
  const press = useRef<HTMLButtonElement | null>(null);
  const row = useRowMenu(
    { thing: "Card", groups: [...MENU.groups, [{ label: "Delete", onSelect: () => undefined }]] },
    { opener: press },
  );
  return createElement(
    "div",
    null,
    createElement(Card, {
      ...row.props,
      children: [
        createElement(Tooltip, {
          key: "press",
          label: "Press",
          card: createElement("button", { type: "button" }, "Open transcript"),
          children: createElement(
            "button",
            { type: "button", ref: press, "aria-describedby": undefined },
            "Press",
          ),
        }),
        row.more(),
      ],
    }),
    row.popup,
  );
}

/** The labels of the menu standing open, without the chord an item prints at its end. */
function menuItems(): readonly string[] {
  return [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map((item) => {
    const words = item.textContent ?? "";
    return words.slice(0, words.length - (item.querySelector("kbd")?.textContent?.length ?? 0));
  });
}

test("a row whose press hangs a card offers Show details, before its last group, which enters the card, and Escape hands focus back to the press", () => {
  draw(createElement(CardedMenuCard));

  act(() => buttonNamed("Card actions").click());
  expect(menuItems()).toEqual(["Rename", "Show details", "Delete"]);
  const details = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]'),
  ].find((item) => item.textContent?.startsWith("Show details"));
  act(() => details?.click());

  const card = document.querySelector(".luke-tooltip-card");
  expect(menuLabel()).toBeNull();
  expect(card?.getAttribute("role")).toBe("dialog");
  expect(document.activeElement === buttonNamed("Open transcript")).toBe(true);

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement === buttonNamed("Press")).toBe(true);
});

test("a row hanging no card offers no Show details", () => {
  draw(createElement(MenuCard, { menu: MENU }));
  act(() => buttonNamed("Card actions").click());
  expect(menuItems()).toEqual(["Rename"]);
});
