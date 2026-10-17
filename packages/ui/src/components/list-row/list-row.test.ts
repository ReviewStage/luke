// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { IconButton } from "../button/button.js";
import { List, ListRow } from "./list-row.js";

/**
 * list-row.test.ts -- a row's press and its acts are separate buttons, never
 * one inside the other, and an act is pressed without pressing its row. A
 * row reads as its words, title first; the open one is announced as current,
 * whether it opens something or not; and a row that opens nothing is no
 * control, though its acts still are. Synthetic members.
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
          current: open === member.id,
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
      children: createElement(ListRow, { title: "Running review", current: true }),
    }),
  );
  const current = container.querySelector('[aria-current="true"]');
  expect(current?.textContent).toBe("Running review");
});
