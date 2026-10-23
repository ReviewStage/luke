// @vitest-environment jsdom

import {
  WRITING_BLOCK,
  WRITING_MARK,
  type WritingBlock,
  type WritingMark,
} from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { FormatToolbar } from "./format-toolbar.js";

/**
 * format-toolbar.test.ts -- the toolbar over selected words: each mark a
 * toggle pressed while the selection wears it, telling its owner which
 * was pressed without taking the focus, and naming its chord; Turn into
 * naming the current block and dropping the blocks, the current one
 * checked, the one chosen told; Comment told; and one Tab stop the arrows,
 * Home, and End move along.
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

/** What a test's toolbar told its owner, in order. */
interface Told {
  marks: WritingMark[];
  turned: WritingBlock[];
  comments: number;
}

/** The toolbar over a selection wearing `marks`, offering Turn into from `current` and Comment where asked. */
function mount(
  marks: readonly WritingMark[],
  offer: { turnInto?: boolean; current?: WritingBlock; comment?: boolean } = {},
): { toolbar: HTMLElement; told: Told } {
  const told: Told = { marks: [], turned: [], comments: 0 };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(FormatToolbar, {
        marks,
        onMark: (mark) => told.marks.push(mark),
        turnInto:
          offer.turnInto === true
            ? { current: offer.current, onTurn: (block) => told.turned.push(block) }
            : undefined,
        onComment:
          offer.comment === true
            ? () => {
                told.comments += 1;
              }
            : undefined,
      }),
    ),
  );
  const toolbar = container.querySelector<HTMLElement>('[role="toolbar"]');
  if (toolbar === null) throw new Error("the toolbar is drawn");
  return { toolbar, told };
}

/** The toolbar's button named `name`. */
function press(toolbar: HTMLElement, name: string): HTMLButtonElement {
  const button = [...toolbar.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  if (button === undefined) throw new Error(`the toolbar holds ${name}`);
  return button;
}

/** The names of the toolbar's buttons, in order. */
function names(toolbar: HTMLElement): string[] {
  return [...toolbar.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
}

/** Presses `key` on what holds the focus. */
function key(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("a box that writes marks alone offers the five marks, the ones the selection wears pressed", () => {
  const { toolbar } = mount([WRITING_MARK.BOLD, WRITING_MARK.LINK]);
  expect(toolbar.getAttribute("aria-label")).toBe("Formatting");
  expect(names(toolbar)).toEqual(["Bold", "Italic", "Strikethrough", "Code", "Link"]);
  expect(names(toolbar).map((name) => press(toolbar, name).getAttribute("aria-pressed"))).toEqual([
    "true",
    "false",
    "false",
    "false",
    "true",
  ]);
});

test("a mark's press tells its owner which, leaving the focus in the editor, and names its chord", () => {
  const { toolbar, told } = mount([]);
  const italic = press(toolbar, "Italic");
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    italic.dispatchEvent(down);
  });
  expect(down.defaultPrevented).toBe(true);
  act(() => italic.click());
  act(() => press(toolbar, "Strikethrough").click());
  expect(told.marks).toEqual([WRITING_MARK.ITALIC, WRITING_MARK.STRIKE]);
  expect(press(toolbar, "Bold").getAttribute("aria-keyshortcuts")).toBe("Meta+B");
  expect(press(toolbar, "Strikethrough").getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+X");
  expect(press(toolbar, "Code").getAttribute("aria-keyshortcuts")).toBe("Meta+E");
  expect(press(toolbar, "Link").getAttribute("aria-keyshortcuts")).toBe("Meta+K");
});

test("the plan's toolbar leads with Turn into, naming the block, and ends with Comment", () => {
  const { toolbar, told } = mount([], {
    turnInto: true,
    current: WRITING_BLOCK.HEADING_2,
    comment: true,
  });
  expect(names(toolbar)).toEqual([
    "Turn into Heading 2",
    "Bold",
    "Italic",
    "Strikethrough",
    "Code",
    "Link",
    "Comment",
  ]);
  expect(press(toolbar, "Turn into Heading 2").textContent).toBe("Heading 2");
  act(() => press(toolbar, "Comment").click());
  expect(told.comments).toBe(1);
});

test("Turn into drops the blocks with the current one checked, and tells its owner the one chosen", () => {
  const { toolbar, told } = mount([], { turnInto: true, current: WRITING_BLOCK.TEXT });
  const turn = press(toolbar, "Turn into Text");
  act(() => turn.click());
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  if (menu === null) throw new Error("the menu opens");
  const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')];
  expect(rows.map((row) => row.querySelector(".luke-menu-item-label")?.textContent)).toEqual([
    "Text",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Bulleted list",
    "Numbered list",
    "To-do list",
    "Quote",
    "Code block",
  ]);
  expect(rows.filter((row) => row.getAttribute("aria-checked") === "true").length).toBe(1);
  expect(rows[0]?.getAttribute("aria-checked")).toBe("true");
  act(() => rows[7]?.click());
  expect(told.turned).toEqual([WRITING_BLOCK.QUOTE]);
});

test("a selection over several kinds of block is offered Turn into by name alone", () => {
  const { toolbar } = mount([], { turnInto: true });
  expect(press(toolbar, "Turn into").textContent).toBe("Turn into");
});

test("the toolbar is one Tab stop the arrows, Home, and End move along", () => {
  const { toolbar } = mount([], { comment: true });
  const stops = () =>
    [...toolbar.querySelectorAll("button")].filter((button) => button.tabIndex !== -1);
  expect(stops().map((button) => button.getAttribute("aria-label"))).toEqual(["Bold"]);
  act(() => press(toolbar, "Bold").focus());
  key("ArrowRight");
  expect(document.activeElement).toBe(press(toolbar, "Italic"));
  key("End");
  expect(document.activeElement).toBe(press(toolbar, "Comment"));
  key("ArrowRight");
  expect(document.activeElement).toBe(press(toolbar, "Bold"));
  key("ArrowLeft");
  expect(document.activeElement).toBe(press(toolbar, "Comment"));
  key("Home");
  expect(document.activeElement).toBe(press(toolbar, "Bold"));
  key("ArrowRight");
  expect(stops()).toEqual([press(toolbar, "Italic")]);
});
