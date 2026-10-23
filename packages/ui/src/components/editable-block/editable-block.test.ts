// @vitest-environment jsdom

import { act, createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import {
  EDITABLE_BLOCK_KIND,
  EDITABLE_TEXT_BLOCK_SELECTOR,
  EditableBlock,
} from "./editable-block.js";

/**
 * editable-block.test.ts -- a document's blocks are one Tab stop the arrows
 * step across, Return opens the block the keyboard selected, and a press on
 * a block's own words opens it where it landed, while a press portaled out
 * of it and a key from inside it are not the block's.
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

/** Draws a title and two sections, each telling `heard` what opened it and how. */
function drawDocument(heard: string[], portaled?: HTMLElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const block = (
    label: string,
    kind: (typeof EDITABLE_BLOCK_KIND)[keyof typeof EDITABLE_BLOCK_KIND],
    entry: boolean,
  ) =>
    createElement(EditableBlock, {
      key: label,
      label,
      kind,
      entry,
      onOpen: () => heard.push(`${label} opened`),
      onPress: ({ x, y }) => heard.push(`${label} pressed at ${String(x)},${String(y)}`),
      children: [
        createElement("p", { key: "words" }, `${label} words`),
        createElement("pre", { key: "code" }, "code"),
        label === "Second" && portaled !== undefined
          ? createPortal(createElement(Button, { children: "Menu" }), portaled, "menu")
          : null,
      ],
    });
  act(() =>
    root.render(
      createElement(
        "div",
        null,
        block("Title", EDITABLE_BLOCK_KIND.TITLE, false),
        block("First", EDITABLE_BLOCK_KIND.TEXT, true),
        block("Second", EDITABLE_BLOCK_KIND.TEXT, false),
      ),
    ),
  );
  return container;
}

function blockNamed(label: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[role='group'][aria-label='${label}']`);
  if (found === null) throw new Error(`the ${label} block is drawn`);
  return found;
}

function key(target: HTMLElement, name: string): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name }),
    );
  });
}

test("the document is one Tab stop, at its entry, and no code inside a block is another", () => {
  drawDocument([]);
  expect(blockNamed("First").tabIndex).toBe(0);
  expect(blockNamed("Title").tabIndex).toBe(-1);
  expect(blockNamed("Second").tabIndex).toBe(-1);
  for (const code of document.querySelectorAll<HTMLElement>("pre")) expect(code.tabIndex).toBe(-1);
});

test("the arrows step to the block before and after, and Return opens the one selected", () => {
  const heard: string[] = [];
  drawDocument(heard);
  act(() => blockNamed("First").focus());
  key(blockNamed("First"), "ArrowDown");
  expect(document.activeElement).toBe(blockNamed("Second"));
  key(blockNamed("Second"), "ArrowUp");
  key(blockNamed("First"), "ArrowUp");
  expect(document.activeElement).toBe(blockNamed("Title"));
  key(blockNamed("Title"), "Enter");
  expect(heard).toEqual(["Title opened"]);
});

test("a key from inside a block is the words', never the block's", () => {
  const heard: string[] = [];
  drawDocument(heard);
  const words = blockNamed("First").querySelector("p");
  if (words === null) throw new Error("the words are drawn");
  key(words, "Enter");
  key(words, "ArrowDown");
  expect(heard).toEqual([]);
});

test("a press on a block's words opens it where it landed, and a portaled press does not", () => {
  const heard: string[] = [];
  const elsewhere = document.body.appendChild(document.createElement("div"));
  drawDocument(heard, elsewhere);
  const words = blockNamed("Second").querySelector("p");
  const menu = elsewhere.querySelector("button");
  if (words === null || menu === null) throw new Error("the words and the menu are drawn");
  act(() => {
    words.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 34 }));
    menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(heard).toEqual(["Second pressed at 12,34"]);
});

test("the text's blocks are found apart from the title's", () => {
  const container = drawDocument([]);
  const text = [...container.querySelectorAll(EDITABLE_TEXT_BLOCK_SELECTOR)];
  expect(text.map((block) => block.getAttribute("aria-label"))).toEqual(["First", "Second"]);
});
