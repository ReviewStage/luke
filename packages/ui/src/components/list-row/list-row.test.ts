// @vitest-environment jsdom

import { act, cloneElement, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { IconButton } from "../button/button.js";
import { LIST_ROW_CURRENT, LIST_ROW_META, List, ListRow, type ListRowHint } from "./list-row.js";

/**
 * list-row.test.ts -- a row's press and its acts are separate buttons, never
 * one inside the other, and an act is pressed without pressing its row. A
 * row reads as its words, title first, and Tab meets it before its acts; the
 * open one is announced as current, whether it opens something or not; and a
 * row that opens nothing is no control, though its acts still are. A
 * keyboard-driven list can hand focus back to a row through its ref, hear
 * the keys pressed on it, and hear a right-click anywhere on it. A row
 * current as the page beside the list is announced so, and the app's hint
 * hung from a row's press raises its words for the press. A row whose
 * metadata stands on its title's line reads it after the title and before
 * the line under it. Synthetic members.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", role: "Owner" },
  { id: "grace", name: "Grace Hopper", role: "Admin" },
] as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a container in the document and hands the container back. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A glyph standing in for an act's icon. */
function glyph(): React.ReactElement {
  return createElement("svg");
}

/** Members whose rows open one and whose ⋯ is pressed, what was pressed listed after them. */
function Members(): React.JSX.Element {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [heard, setHeard] = useState<string[]>([]);
  return createElement(
    "div",
    null,
    createElement(List, {
      label: "Members",
      children: MEMBERS.map((member) =>
        createElement(ListRow, {
          key: member.id,
          leading: glyph(),
          title: member.name,
          description: `${member.id}@example.com`,
          meta: member.role,
          current: open === member.id ? LIST_ROW_CURRENT.ITEM : undefined,
          onPress: () => {
            setOpen(member.id);
            setHeard((all) => [...all, `open ${member.id}`]);
          },
          actions: createElement(IconButton, {
            icon: glyph(),
            label: `More for ${member.id}`,
            onClick: () => setHeard((all) => [...all, `more ${member.id}`]),
          }),
        }),
      ),
    }),
    createElement("output", null, heard.join(",")),
  );
}

/** The button whose words or label are `name`. */
function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

function press(target: HTMLElement): void {
  act(() => target.click());
}

test("a row's press and its acts are separate buttons in its item, neither inside the other", () => {
  const container = draw(createElement(Members));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.length).toBe(4);
  for (const each of buttons) {
    expect(each.parentElement?.closest("button")).toBeNull();
  }
  const row = button(container, "Ada Lovelaceada@example.comOwner");
  const more = button(container, "More for ada");
  expect(row.closest("li")).toBe(more.closest("li"));
  expect(container.querySelector("ul")?.getAttribute("aria-label")).toBe("Members");
});

test("pressing an act does not press its row, and pressing a row opens it", () => {
  const container = draw(createElement(Members));
  press(button(container, "More for ada"));
  press(button(container, "Grace Hoppergrace@example.comAdmin"));
  expect(container.querySelector("output")?.textContent).toBe("more ada,open grace");
});

test("the open row is announced as current, and only it", () => {
  const container = draw(createElement(Members));
  const ada = button(container, "Ada Lovelaceada@example.comOwner");
  expect(ada.getAttribute("aria-current")).toBeNull();
  press(ada);
  expect(ada.getAttribute("aria-current")).toBe("true");
  expect(container.querySelectorAll("[aria-current]").length).toBe(1);
});

test("a row reads as its words, title first, its leading mark hidden from a reader", () => {
  const container = draw(createElement(Members));
  const row = button(container, "Ada Lovelaceada@example.comOwner");
  expect(row.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
  // Note that nothing names the row over its words, because a voice says what it sees.
  expect([row.getAttribute("aria-label"), row.getAttribute("aria-labelledby")]).toEqual([
    null,
    null,
  ]);
});

test("a row whose metadata ends its title's line reads it after the title and before the line under it, as a mail app's row is read", () => {
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        description: "ada@example.com",
        meta: "Owner",
        metaAt: LIST_ROW_META.TITLE,
        onPress: () => undefined,
      }),
    }),
  );
  expect(button(container, "Ada LovelaceOwnerada@example.com")).toBeTruthy();
});

test("Tab meets a row, then its acts, then the next row, none taken out of the order", () => {
  const container = draw(createElement(Members));
  const order = [
    "Ada Lovelaceada@example.comOwner",
    "More for ada",
    "Grace Hoppergrace@example.comAdmin",
    "More for grace",
  ].map((name) => button(container, name));
  expect([...container.querySelectorAll("button")]).toEqual(order);
  for (const each of order) {
    expect(each.tabIndex).toBe(0);
  }
});

test("a row that opens nothing is no control, its acts still are", () => {
  const container = draw(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Nightly review",
        meta: "2h ago",
        actions: createElement(IconButton, { icon: glyph(), label: "Run again" }),
      }),
    }),
  );
  expect(
    [...container.querySelectorAll("button")].map((each) => each.getAttribute("aria-label")),
  ).toEqual(["Run again"]);
  expect(container.querySelector("li")?.textContent).toBe("Nightly review2h ago");
});

test("a row that opens nothing is still announced as current", () => {
  const container = draw(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Running review",
        current: LIST_ROW_CURRENT.ITEM,
      }),
    }),
  );
  const current = container.querySelector('[aria-current="true"]');
  expect(current?.textContent).toBe("Running review");
});

test("focus is handed back to a row's press through its ref", () => {
  let row: HTMLElement | null = null;
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        ref: (element: HTMLElement | null) => {
          row = element;
        },
        title: "Ada Lovelace",
        onPress: () => undefined,
      }),
    }),
  );
  act(() => row?.focus());
  expect(document.activeElement).toBe(button(container, "Ada Lovelace"));
});

test("a row that opens nothing hands its item to its ref", () => {
  let row: HTMLElement | null = null;
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        ref: (element: HTMLElement | null) => {
          row = element;
        },
        title: "Ada Lovelace",
      }),
    }),
  );
  expect(row).toBe(container.querySelector("li"));
});

test("a key pressed on a row reaches its handler, and a right-click anywhere on it reaches its own", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        onPress: () => undefined,
        onKeyDown: (event) => heard.push(`key ${event.key}`),
        onContextMenu: () => heard.push("menu"),
        actions: createElement(IconButton, { icon: glyph(), label: "More for ada" }),
      }),
    }),
  );
  const row = button(container, "Ada Lovelace");
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    button(container, "More for ada").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
  });
  expect(heard).toEqual(["key j", "menu", "menu"]);
});

test("a row that opens nothing hears no keys, not even its acts'", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        onKeyDown: (event) => heard.push(`key ${event.key}`),
        actions: createElement(IconButton, { icon: glyph(), label: "More for ada" }),
      }),
    }),
  );
  act(() => {
    button(container, "More for ada").dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
  });
  expect(heard).toEqual([]);
});

test("a row current as the page shown beside the list is announced as the page", () => {
  const container = draw(
    createElement(List, {
      label: "Inbox items",
      children: createElement(ListRow, {
        title: "Review the release",
        current: LIST_ROW_CURRENT.PAGE,
        onPress: () => undefined,
      }),
    }),
  );
  expect(button(container, "Review the release").getAttribute("aria-current")).toBe("page");
});

/** A hint that says its words beside the press while the press holds the keyboard. */
const SayingHint: ListRowHint = ({ label, children }) => {
  const [shown, setShown] = useState(false);
  return createElement(
    "div",
    null,
    cloneElement(children, { onFocus: () => setShown(true), onBlur: () => setShown(false) }),
    shown ? createElement("output", null, label) : null,
  );
};

test("the app's hint hung from a row's press raises its words while the press holds the keyboard, and the press still opens the row", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Inbox items",
      children: createElement(ListRow, {
        title: "Review the release",
        meta: "2h",
        hint: { Hint: SayingHint, label: "Review the release" },
        onPress: () => heard.push("open"),
      }),
    }),
  );
  const row = button(container, "Review the release2h");
  expect(container.querySelector("output")).toBeNull();
  act(() => row.focus());
  expect(container.querySelector("output")?.textContent).toBe("Review the release");
  press(row);
  expect(heard).toEqual(["open"]);
});
