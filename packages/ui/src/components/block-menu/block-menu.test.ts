// @vitest-environment jsdom

import { SHORTCUT_KEY, WRITING_BLOCK, WRITING_INSERT } from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { comboboxOptionId } from "../combobox/combobox.js";
import {
  BLOCK_MENU_GROUP,
  BlockMenu,
  type BlockMenuGroup,
  type BlockMenuRow,
  writingRow,
} from "./block-menu.js";

/**
 * block-menu.test.ts -- the `/` menu: its blocks under their groups' headings,
 * each saying at its end the Markdown that makes it or else its chord; the
 * row the editor's keys stand on highlighted and named by its id; the
 * pointer moving the highlight and a press choosing a row; a group with
 * nothing in it left out, and a menu with nothing in it saying so; and the
 * keys it hears named at its foot.
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

/** A row of the owner's own, which no writing action is. */
const TABLE: BlockMenuRow = {
  id: "table",
  label: "Table",
  icon: null,
  chord: { key: SHORTCUT_KEY.ZERO, shift: true },
};

const GROUPS: readonly BlockMenuGroup[] = [
  {
    label: BLOCK_MENU_GROUP.BASIC,
    rows: [writingRow(WRITING_BLOCK.TEXT), writingRow(WRITING_BLOCK.HEADING_2)],
  },
  { label: BLOCK_MENU_GROUP.LISTS, rows: [] },
  { label: BLOCK_MENU_GROUP.INSERT, rows: [TABLE, writingRow(WRITING_INSERT.DIVIDER)] },
];

/** What a test's menu told its owner. */
interface Told {
  active: number[];
  chosen: string[];
}

/** The menu over `groups`, `active` highlighted. */
function mount(groups: readonly BlockMenuGroup[], active = 0): { menu: HTMLElement; told: Told } {
  const told: Told = { active: [], chosen: [] };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(BlockMenu, {
        id: "blocks",
        groups,
        active,
        onActiveChange: (index) => told.active.push(index),
        onChoose: (row) => told.chosen.push(row.id),
      }),
    ),
  );
  return { menu: container, told };
}

/** The menu's rows. */
function rows(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
}

test("the blocks stand under their groups' headings, an emptied group left out", () => {
  const { menu } = mount(GROUPS);
  expect(menu.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Blocks");
  const groups = [...menu.querySelectorAll('[role="group"]')];
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Basic", "Insert"]);
});

test("each row says the Markdown that makes its block, or else its chord", () => {
  const { menu } = mount(GROUPS);
  expect(rows(menu).map((row) => row.textContent)).toEqual([
    "Text⌥⌘0",
    "Heading 2##",
    "Table⇧⌘0",
    "Divider---",
  ]);
});

test("the row the editor's keys stand on is highlighted and named by its id", () => {
  const { menu } = mount(GROUPS, 2);
  const highlighted = rows(menu).filter((row) => row.getAttribute("aria-selected") === "true");
  expect(highlighted.map((row) => row.id)).toEqual([comboboxOptionId("blocks", 2)]);
});

test("the pointer moves the highlight, and a press chooses the row", () => {
  const { menu, told } = mount(GROUPS);
  const divider = rows(menu)[3];
  act(() => {
    divider?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
  expect(told.active).toEqual([3]);
  act(() => divider?.click());
  expect(told.chosen).toEqual([WRITING_INSERT.DIVIDER]);
});

test("a menu with nothing left in it says so", () => {
  const { menu } = mount([{ label: BLOCK_MENU_GROUP.BASIC, rows: [] }]);
  expect(rows(menu)).toEqual([]);
  expect(menu.textContent).toContain("No blocks match");
});

test("its foot names the keys it hears, and is read by nobody", () => {
  const { menu } = mount(GROUPS);
  const foot = menu.querySelector('.luke-menu-keys[aria-hidden="true"]');
  expect([...(foot?.children ?? [])].map((key) => key.textContent)).toEqual([
    "↑↓Move",
    "⏎⇥Insert",
    "EscClose",
  ]);
});
