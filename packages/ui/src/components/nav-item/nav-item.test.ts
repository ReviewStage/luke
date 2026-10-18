// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { useMenu } from "../menu/menu.js";
import { NAV_COUNT_SHOWN, NAV_CURRENT, NAV_ITEM_VARIANT, NavItem } from "./nav-item.js";

/**
 * nav-item.test.ts -- a nav item is a button named by its words, its count
 * read with its noun and left out at none; the place shown is announced as
 * the page, a search's find as the location; a fold's head says whether
 * its group stands open and folds it on a press; a menu's trigger says the
 * menu it drops and whether it stands; an unavailable item refuses its
 * press; a hint's words describe the item they hang from; and one that
 * keeps focus leaves it on the field that held it.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container on the page. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The one button drawn in `container`. */
function button(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector("button");
  if (found === null) throw new Error("no button drawn");
  return found;
}

test("a row is a button named by its words, its count read with its noun", () => {
  const container = mount(
    createElement(NavItem, {
      icon: createElement("svg"),
      count: { value: 3, noun: "waiting on you" },
      children: "Inbox",
    }),
  );

  expect(button(container).textContent).toBe("Inbox3 waiting on you");
});

test("a count of none is left out", () => {
  const container = mount(
    createElement(NavItem, { count: { value: 0, noun: "waiting on you" }, children: "Inbox" }),
  );

  expect(button(container).textContent).toBe("Inbox");
});

test("the place shown is announced as the page, a search's find as the location", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement(NavItem, { current: NAV_CURRENT.PAGE, children: "Home" }),
      createElement(NavItem, { current: NAV_CURRENT.LOCATION, children: "Theme" }),
      createElement(NavItem, { children: "Inbox" }),
    ),
  );

  const states = Array.from(container.querySelectorAll("button")).map((each) => [
    each.textContent,
    each.getAttribute("aria-current"),
  ]);
  expect(states).toEqual([
    ["Home", "page"],
    ["Theme", "location"],
    ["Inbox", null],
  ]);
});

test("a fold's head says whether its group is open, and a press folds it", () => {
  function Group(): React.JSX.Element {
    const [folded, setFolded] = useState(false);
    return createElement(NavItem, {
      variant: NAV_ITEM_VARIANT.HEAD,
      icon: createElement("svg"),
      expanded: !folded,
      count: folded ? { value: 4, noun: "tasks", shown: NAV_COUNT_SHOWN.ON_HOVER } : undefined,
      onClick: () => setFolded((was) => !was),
      children: "acme/web",
    });
  }
  const container = mount(createElement(Group));
  const head = button(container);

  expect([head.getAttribute("aria-expanded"), head.textContent]).toEqual(["true", "acme/web"]);
  act(() => head.click());
  expect([head.getAttribute("aria-expanded"), head.textContent]).toEqual([
    "false",
    "acme/web4 tasks",
  ]);
});

test("a menu's trigger says it drops a menu, and whether the menu stands", () => {
  function Account(): React.JSX.Element {
    const menu = useMenu(true);
    return createElement(NavItem, {
      variant: NAV_ITEM_VARIANT.IDENTITY,
      menu: menu.trigger(),
      children: "Ada Lovelace",
    });
  }
  const container = mount(createElement(Account));
  const trigger = button(container);

  expect([trigger.getAttribute("aria-haspopup"), trigger.getAttribute("aria-expanded")]).toEqual([
    "menu",
    "false",
  ]);
  act(() => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  act(() => trigger.click());
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("an unavailable row refuses its press", () => {
  const presses: string[] = [];
  const container = mount(
    createElement(NavItem, {
      disabled: true,
      onClick: () => presses.push("Home"),
      children: "Home",
    }),
  );

  act(() => button(container).click());

  expect(presses).toEqual([]);
});

test("a chord is named to a reader through the row, not read as its words", () => {
  const container = mount(
    createElement(NavItem, {
      "aria-keyshortcuts": "Meta+N",
      shortcut: createElement("kbd", { "aria-hidden": "true" }, "⌘N"),
      children: "New task",
    }),
  );
  const row = button(container);

  expect(row.getAttribute("aria-keyshortcuts")).toBe("Meta+N");
  expect(row.querySelector("[aria-hidden='true']")?.textContent).toBe("⌘N");
});

test("a hint's words describe the item they hang from", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement("span", { id: "hint" }, "acme/web, 4 open tasks"),
      createElement(NavItem, {
        variant: NAV_ITEM_VARIANT.HEAD,
        "aria-describedby": "hint",
        children: "acme/web",
      }),
    ),
  );
  const described = button(container).getAttribute("aria-describedby");

  expect(document.getElementById(described ?? "")?.textContent).toBe("acme/web, 4 open tasks");
});

test("a row that keeps focus leaves it on the field that held it under a pointer's press", () => {
  const container = mount(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Search" }),
      createElement(NavItem, { keepFocus: true, children: "Theme" }),
    ),
  );
  const field = container.querySelector("input");
  field?.focus();

  const pressed = button(container).dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );

  expect([pressed, document.activeElement]).toEqual([false, field]);
});
