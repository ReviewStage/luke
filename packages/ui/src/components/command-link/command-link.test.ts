// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { COMMAND_LINK_ELEMENT, CommandLink } from "./command-link.js";

/**
 * command-link.test.ts -- a ⌘-click, or a Ctrl-click, on the words opens what
 * they name, while a plain press leaves them to be selected and a press on a
 * button among them is the button's own.
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

function click(element: Element, keys: { metaKey?: boolean; ctrlKey?: boolean } = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...keys });
  act(() => {
    element.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("only a ⌘-click or a Ctrl-click opens, and never one on a button among the words", () => {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(CommandLink, {
        as: COMMAND_LINK_ELEMENT.H2,
        className: "title",
        onOpen: () => opened.push("GitHub"),
        children: [
          "Fix token refresh ",
          createElement("button", { key: "edit", type: "button" }, "Edit"),
        ],
      }),
    ),
  );
  const heading = container.querySelector("h2.title") ?? expect.unreachable("the heading stands");
  const edit = heading.querySelector("button") ?? expect.unreachable("the button stands");

  expect(click(heading)).toBe(false);
  expect(opened).toEqual([]);
  expect(click(edit, { metaKey: true })).toBe(false);
  expect(opened).toEqual([]);
  expect(click(heading, { metaKey: true })).toBe(true);
  expect(click(heading, { ctrlKey: true })).toBe(true);
  expect(opened).toEqual(["GitHub", "GitHub"]);
});
