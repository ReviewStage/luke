// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LINK_ORIGIN } from "@repo/features/link-home";
import { INLINE_REF_LOOK, InlineRef, ListRow, useMenu } from "@repo/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { LinkMenu, useEditedLinksHost } from "./link-menu.js";
import type { Address } from "./route.js";
import { OpenAddressesHere } from "./tasks/use-open-link.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { TextLink } from "./text-link.js";

const ADDRESS = "https://github.com/ReviewStage/luke/pull/42";

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

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

function rightClick(element: Element): void {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30 }),
    );
  });
}

function menuItems(): string[] | undefined {
  const menu = document.querySelector('[role="menu"]:not([data-leaving])');
  if (menu === null) return undefined;
  return [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
}

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
  const title = document.querySelector(".ui-list-row-title");
  assert.ok(title);

  rightClick(title);
  choose("Open link");
  assert.deepEqual(opened, [ADDRESS]);

  rightClick(title);
  choose("Copy link");
  await act(async () => undefined);
  assert.deepEqual(copied, [ADDRESS]);
});

test("a right-click on a row naming an agent's page offers Open in browser, which opens the page's own Vespin link flagged to stay on the web", () => {
  const page = `${LINK_ORIGIN}/acme/task/7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10/page/5d1c3f9a-7e2b-4c8d-9f10-2a3b4c5d6e7f`;
  const opened: string[] = [];
  mount(
    createElement(
      "ul",
      null,
      createElement(ListRow, { title: "Invite funnel", onPress: () => undefined, linkHref: page }),
    ),
  );
  fakeAppPlatform({ ...QUIET_PANEL, openWeb: (url) => opened.push(url) });
  const title = document.querySelector(".ui-list-row-title");
  assert.ok(title);

  rightClick(title);
  assert.deepEqual(menuItems(), ["Open link", "Open in browser", "Copy link"]);
  choose("Open in browser");
  assert.deepEqual(opened, [`${page}?stay=web`]);
});

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
      OpenAddressesHere,
      {
        value: (address: Address) => {
          if (address.href !== undefined) openedHere.push(address.href);
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

test("a chip the editor holds fixed in words being edited opens through its own press", () => {
  const pressed: string[] = [];
  mount(
    createElement(
      OpenAddressesHere,
      { value: () => assert.fail("a fixed chip opens through its own press") },
      createElement(
        "div",
        { contentEditable: true, suppressContentEditableWarning: true },
        createElement(
          "span",
          { contentEditable: false },
          createElement(InlineRef, {
            look: INLINE_REF_LOOK.PILL,
            label: "app.ts",
            onPress: () => pressed.push(ADDRESS),
            linkHref: ADDRESS,
          }),
        ),
      ),
    ),
  );
  const chip = document.querySelector("button");
  assert.ok(chip);

  rightClick(chip);
  choose("Open link");

  assert.deepEqual(pressed, [ADDRESS]);
});

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
