// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ListRow, useMenu } from "@luke/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { LinkMenu, useEditedLinksHost } from "./link-menu.js";
import { OpenHereProvider } from "./tasks/use-open-link.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { TextLink } from "./text-link.js";

/**
 * link-menu.test.ts -- a right-click on a link anywhere in the window hangs
 * Open link and Copy link: on a link in words and on a row that opens an
 * address alike, never over a menu of the clicked thing's own, and never on
 * what is no link.
 */

const ADDRESS = "https://github.com/ReviewStage/luke/pull/42";

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** `element` drawn beside the window's link menu, a clipboard taking every copy into the list answered. */
function mount(element: ReactElement): string[] {
  const copied: string[] = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const drawn = createElement("div", null, element, createElement(LinkMenu));
  act(() => root.render(onRegistry(AtomRegistry.make(), drawn)));
  return copied;
}

/** A right-click on `element` at a point in the window, as the system sends one. */
function rightClick(element: Element): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }),
    );
  });
}

/** The items of the menu standing open, by label; none where no menu stands. */
function menuItems(): string[] | undefined {
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');
  if (menu === null) return undefined;
  return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
}

/** Chooses the standing menu's item named `label`. */
function choose(label: string): void {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (button) => button.textContent === label,
  );
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

test("a right-click on a link in words opens it as its press does, or copies its address", async () => {
  const opened: string[] = [];
  const copied = mount(
    createElement(TextLink, {
      href: ADDRESS,
      words: "the pull request",
      onOpen: (href: string) => opened.push(href),
      children: "the pull request",
    }),
  );
  const link = document.querySelector("a");
  assert.ok(link);

  rightClick(link);
  assert.deepEqual(menuItems(), ["Open link", "Copy link"]);
  choose("Open link");
  assert.deepEqual(opened, [ADDRESS]);

  rightClick(link);
  choose("Copy link");
  await act(async () => undefined);
  assert.deepEqual(copied, [ADDRESS]);
});

test("a right-click on a row that opens an address offers the same menu, opening it through the row's own press", async () => {
  const opened: string[] = [];
  const copied = mount(
    createElement(
      "ul",
      null,
      createElement(ListRow, {
        title: "Preview",
        onPress: () => opened.push(ADDRESS),
        linkHref: ADDRESS,
      }),
    ),
  );
  const title = document.querySelector(".luke-list-row-title");
  assert.ok(title);

  rightClick(title);
  choose("Open link");
  assert.deepEqual(opened, [ADDRESS]);

  rightClick(title);
  choose("Copy link");
  await act(async () => undefined);
  assert.deepEqual(copied, [ADDRESS]);
});

/** Words being edited, as a plan's body holds them, with a link in them. */
function EditedWords(): React.JSX.Element {
  const host = useEditedLinksHost();
  return createElement(
    "div",
    { ref: host },
    createElement(
      "div",
      { contentEditable: true, suppressContentEditableWarning: true },
      createElement(
        "a",
        {
          href: ADDRESS,
          onClick: () => assert.fail("a press in the editor only places the caret"),
        },
        "the pull request",
      ),
    ),
  );
}

test("a link in words being edited opens where the words stand, through the place's own opener", () => {
  const openedHere: string[] = [];
  mount(
    createElement(
      OpenHereProvider,
      {
        value: (href: string) => {
          openedHere.push(href);
          return true;
        },
      },
      createElement(EditedWords),
    ),
  );
  const link = document.querySelector("a");
  assert.ok(link);

  rightClick(link);
  choose("Open link");

  assert.deepEqual(openedHere, [ADDRESS]);
});

/** A row hanging a menu of its own on a right-click, as a task's row does, around a link. */
function RowWithMenu(): React.JSX.Element {
  const { contextMenu, open } = useMenu(true);
  return createElement(
    "div",
    { ...contextMenu(), "data-row-menu": open === undefined ? "closed" : "open" },
    createElement("a", { href: ADDRESS }, "inside"),
  );
}

test("a right-click on a link inside something with a menu of its own hangs that menu, not the link's", () => {
  mount(createElement(RowWithMenu));
  const link = document.querySelector("a");
  assert.ok(link);

  rightClick(link);

  assert.equal(document.querySelector("[data-row-menu]")?.getAttribute("data-row-menu"), "open");
  assert.equal(menuItems(), undefined);
});

test("a right-click on what is no link, or on a link to an address the window opens nowhere, hangs nothing", () => {
  mount(
    createElement(
      "p",
      null,
      "Plain words ",
      createElement("a", { href: "file:///etc/hosts" }, "a script"),
    ),
  );
  const words = document.querySelector("p");
  const script = document.querySelector("a");
  assert.ok(words && script);

  rightClick(words);
  assert.equal(menuItems(), undefined);
  rightClick(script);
  assert.equal(menuItems(), undefined);
});
