// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  ROVING_ORIENTATION,
  ROVING_REACH,
  type RovingReach,
  rovingItem,
  useRovingColumns,
  useRovingKeys,
} from "./roving-keys.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOOLS = ["Bold", "Italic", "Link"] as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function Toolbar(): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });
  return createElement(
    "div",
    { ...roving, "aria-label": "Format" },
    TOOLS.map((tool) =>
      createElement(
        "button",
        {
          key: tool,
          type: "button",
          ...rovingItem(),
          onKeyDown:
            tool === "Italic"
              ? (event: React.KeyboardEvent) => {
                  if (event.key === "ArrowRight") event.preventDefault();
                }
              : undefined,
        },
        tool,
      ),
    ),
  );
}

function draw(): Record<(typeof TOOLS)[number], HTMLButtonElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Toolbar)));
  const [bold, italic, link] = [...container.querySelectorAll("button")];
  if (bold === undefined || italic === undefined || link === undefined) throw new Error("No tools");
  return { Bold: bold, Italic: italic, Link: link };
}

function key(name: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

test("a row of items walks with ← and →, wrapping, and leaves ↑ and ↓ alone", () => {
  const tools = draw();
  act(() => tools.Bold.focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(tools.Bold);
  key("ArrowLeft");
  expect(document.activeElement).toBe(tools.Link);
  key("ArrowRight");
  expect(document.activeElement).toBe(tools.Bold);
  expect([tools.Bold, tools.Italic, tools.Link].map((tool) => tool.tabIndex)).toEqual([0, -1, -1]);
});

test("an item whose own handler takes a key keeps the focus", () => {
  const tools = draw();
  act(() => tools.Italic.focus());
  key("ArrowRight");
  expect(document.activeElement).toBe(tools.Italic);
});

test("a key heard on the box itself steps from none: forward and Home to the first, back and End to the last", () => {
  const tools = draw();
  const box = tools.Bold.parentElement;
  if (box === null) throw new Error("No toolbar");
  box.tabIndex = -1;
  for (const [name, landed] of [
    ["ArrowRight", tools.Bold],
    ["Home", tools.Bold],
    ["ArrowLeft", tools.Link],
    ["End", tools.Link],
  ] as const) {
    act(() => box.focus());
    key(name);
    expect(document.activeElement, name).toBe(landed);
  }
});

function DrawnTools({ heard }: { heard: RovingReach[] }): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>({
    orientation: ROVING_ORIENTATION.HORIZONTAL,
    reach: (_from, to) => {
      heard.push(to);
      return to !== ROVING_REACH.PREVIOUS;
    },
  });
  return createElement(
    "div",
    { ...roving, "aria-label": "Format" },
    TOOLS.map((tool) =>
      createElement("button", { key: tool, type: "button", ...rovingItem() }, tool),
    ),
  );
}

test("a set drawing only some of its items hands its owner every key walking it, and walks one it leaves", () => {
  const heard: RovingReach[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(DrawnTools, { heard })));
  const [bold, italic, link] = [...container.querySelectorAll("button")];

  bold?.focus();
  key("ArrowRight");
  key("Home");
  key("End");
  expect(heard).toEqual([ROVING_REACH.NEXT, ROVING_REACH.FIRST, ROVING_REACH.LAST]);
  expect(document.activeElement).toBe(bold);

  link?.focus();
  key("ArrowLeft");
  expect(heard.at(-1)).toBe(ROVING_REACH.PREVIOUS);
  expect(document.activeElement).toBe(italic);

  bold?.focus();
  key("ArrowLeft");
  expect(heard.at(-1)).toBe(ROVING_REACH.PREVIOUS);
  expect(document.activeElement).toBe(link);
});

const COLUMNS = [["Backlog one", "Backlog two"], [], ["Done one"]] as const;

function Column({ cards }: { cards: readonly string[] }): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>();
  return createElement(
    "div",
    roving,
    cards.map((card) =>
      createElement("button", { key: card, type: "button", ...rovingItem() }, card),
    ),
  );
}

function Board(): React.JSX.Element {
  const crossing = useRovingColumns<HTMLDivElement>();
  return createElement(
    "div",
    crossing,
    COLUMNS.map((cards, at) => createElement(Column, { key: at, cards })),
  );
}

test("← and → cross from a column to the next one's Tab stop, an empty column passed over, wrapping, and leave ↑↓ to the column", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Board)));
  const card = (name: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (each) => each.textContent === name,
    );
    if (found === undefined) throw new Error(`No card ${name}`);
    return found;
  };
  act(() => card("Backlog one").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(card("Backlog two"));
  key("ArrowRight");
  expect(document.activeElement).toBe(card("Done one"));
  key("ArrowRight");
  expect(document.activeElement).toBe(card("Backlog two"));
  key("ArrowLeft");
  expect(document.activeElement).toBe(card("Done one"));
});

const ROWS = ["First", "Second", "Third"] as const;

function Rows({
  marks,
}: {
  marks: Partial<Record<(typeof ROWS)[number], Record<string, string>>>;
}): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>();
  return createElement(
    "div",
    roving,
    ROWS.map((row) =>
      createElement("button", { key: row, type: "button", ...rovingItem(), ...marks[row] }, row),
    ),
  );
}

function drawRows(marks: React.ComponentProps<typeof Rows>["marks"]): HTMLButtonElement[] {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Rows, { marks })));
  return [...container.querySelectorAll("button")];
}

test("Tab enters a list on its aria-current row, whatever value says current", () => {
  for (const value of ["page", "step", "true"]) {
    const rows = drawRows({ Third: { "aria-current": value } });
    expect(
      rows.map((row) => row.tabIndex),
      value,
    ).toEqual([-1, -1, 0]);
    document.body.replaceChildren();
  }
});

test("a row with aria-current false is not the current one", () => {
  const rows = drawRows({ Third: { "aria-current": "false" } });
  expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
});

test("a chosen row outranks the current one, and the row last moved to outranks both", () => {
  const rows = drawRows({
    Second: { "aria-selected": "true" },
    Third: { "aria-current": "page" },
  });
  expect(rows.map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
  act(() => rows[0]?.focus());
  expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
});
