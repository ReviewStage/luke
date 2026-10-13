// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type Exit, installExits, uninstallExits } from "#testing/exits";
import { ActionMenu, dropBelow, useActionMenu } from "./action-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** The exit a leaving menu runs, as desktop.css plays it. */
const LEAVING_MENU = '.plan-menu[data-leaving="true"]';

let root: Root | undefined;
let exits: Exit[];

/** A ⋯ button and the menu it drops, as a row's actions are drawn. */
function Actions(): React.JSX.Element {
  const menu = useActionMenu(true);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      {
        type: "button",
        "aria-label": "Plan actions",
        "aria-expanded": menu.open !== undefined,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          if (menu.open !== undefined) menu.close(false);
          else menu.show(dropBelow(event.currentTarget), event.currentTarget);
        },
      },
      "⋯",
    ),
    menu.drawn === undefined
      ? null
      : createElement(ActionMenu, {
          label: "Plan actions",
          menu: menu.drawn,
          groups: [[{ label: "Rename", onSelect: () => undefined }]],
          onClose: menu.close,
        }),
  );
}

function opener(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[aria-label="Plan actions"]');
  assert.ok(button, "no ⋯ button");
  return button;
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

function press(): void {
  act(() => opener().click());
}

/** Lets every exit started so far finish, as the stylesheet's would. */
function finishExits(): void {
  act(() => {
    for (const exit of exits) exit.finish();
  });
}

function pressEscape(): void {
  const drawn = menu();
  assert.ok(drawn, "no menu to press Escape in");
  act(() => {
    drawn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

beforeEach(() => {
  exits = installExits(LEAVING_MENU);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(createElement(Actions)));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  uninstallExits();
});

test("a menu Escape closes hands focus back at once, and stays drawn, inert, until its exit is done", () => {
  press();
  assert.equal(document.activeElement?.textContent, "Rename", "its first item takes focus");

  pressEscape();
  assert.ok(document.activeElement === opener(), "the button has focus back before the exit");
  assert.equal(opener().getAttribute("aria-expanded"), "false");
  const leaving = menu();
  assert.ok(leaving, "the menu is drawn through its exit");
  assert.equal(leaving.dataset.leaving, "true");
  assert.equal(leaving.hasAttribute("inert"), true, "nothing reaches the menu on its way out");

  finishExits();
  assert.equal(menu(), null, "the exit done takes it out");
});

test("the menu opened again while it leaves stands again, focused, and its old exit takes nothing", () => {
  press();
  pressEscape();
  assert.equal(menu()?.dataset.leaving, "true");

  press();
  const standing = menu();
  assert.ok(standing, "the menu stands");
  assert.equal(standing.dataset.leaving, undefined);
  assert.equal(standing.hasAttribute("inert"), false);
  assert.equal(opener().getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.textContent, "Rename", "its first item takes focus again");

  finishExits();
  assert.ok(menu() === standing, "the exit it was playing takes nothing away");
});
