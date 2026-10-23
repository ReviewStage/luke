// @vitest-environment jsdom

import { WRITING_BLOCK, type WritingBlock } from "@luke/settings/shortcuts";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { useMenu } from "../menu/menu.js";
import { TurnIntoMenu } from "./turn-into-menu.js";

/**
 * turn-into-menu.test.ts -- the blocks a line is turned into, each with
 * the chord that turns it, the current one's kept beside its check,
 * opening on the current block, which alone is checked; choosing one
 * hands the focus back and tells the owner which.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A button that drops Turn into over a line that is `current`. */
function Harness({
  current,
  onTurn,
}: {
  current: WritingBlock | undefined;
  onTurn: (block: WritingBlock) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    Fragment,
    null,
    createElement(Button, { ...menu.trigger(), children: "Turn into" }),
    menu.drawn === undefined
      ? null
      : createElement(TurnIntoMenu, { menu: menu.drawn, current, onTurn, onClose: menu.close }),
  );
}

/** Opens Turn into over a line that is `current`; answers its rows and what it told. */
function open(current: WritingBlock | undefined): { rows: HTMLElement[]; turned: WritingBlock[] } {
  const turned: WritingBlock[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(Harness, { current, onTurn: (block) => turned.push(block) })),
  );
  act(() => container.querySelector("button")?.click());
  const rows = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
  return { rows, turned };
}

test("each block is offered with the chord that turns it, where it has one", () => {
  const { rows } = open(WRITING_BLOCK.TEXT);
  expect(rows.map((row) => row.textContent)).toEqual([
    "Text⌥⌘0",
    "Heading 1⌥⌘1",
    "Heading 2⌥⌘2",
    "Heading 3⌥⌘3",
    "Bulleted list⇧⌘8",
    "Numbered list⇧⌘7",
    "To-do list⇧⌘9",
    "Quote⇧⌘B",
    "Code block",
  ]);
});

test("the menu opens on the current block, which alone is checked", () => {
  const { rows } = open(WRITING_BLOCK.NUMBERED_LIST);
  const checked = rows.filter((row) => row.getAttribute("aria-checked") === "true");
  expect(checked.map((row) => row.textContent)).toEqual(["Numbered list⇧⌘7"]);
  expect(document.activeElement).toBe(checked[0]);
});

test("a line over several kinds of block has none checked", () => {
  const { rows } = open(undefined);
  expect(rows.some((row) => row.getAttribute("aria-checked") === "true")).toBe(false);
});

test("choosing a block hands the focus back to what opened the menu and tells the owner which", () => {
  const { rows, turned } = open(WRITING_BLOCK.TEXT);
  act(() => rows[2]?.click());
  expect(turned).toEqual([WRITING_BLOCK.HEADING_2]);
  expect(document.activeElement).toBe(document.querySelector("button"));
});
