// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import {
  EDITABLE_HEADING_LEAVE,
  EditableHeading,
  type EditableHeadingLeave,
} from "./editable-heading.js";

/**
 * editable-heading.test.ts -- Esc leaves the heading back onto what holds
 * it and Return or ↓ on into what follows, each key held from typing, while
 * every other key types, and a key an input method took is left alone.
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

function drawHeading(left: EditableHeadingLeave[]): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(EditableHeading, {
        label: "Task name",
        onLeave: (way) => left.push(way),
      }),
    ),
  );
  const heading = container.querySelector<HTMLElement>("[role='textbox']");
  if (heading === null) throw new Error("the heading is drawn");
  return heading;
}

/** Presses `name` on `target`, answering whether the key went on to type. */
function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: name,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return !event.defaultPrevented;
}

test("Esc leaves back, and Return and ↓ leave on, none of them typing", () => {
  const left: EditableHeadingLeave[] = [];
  const heading = drawHeading(left);
  expect(key(heading, "Escape")).toBe(false);
  expect(key(heading, "Enter")).toBe(false);
  expect(key(heading, "ArrowDown")).toBe(false);
  expect(left).toEqual([
    EDITABLE_HEADING_LEAVE.BACK,
    EDITABLE_HEADING_LEAVE.ON,
    EDITABLE_HEADING_LEAVE.ON,
  ]);
});

test("every other key is the words' own and leaves nothing", () => {
  const left: EditableHeadingLeave[] = [];
  const heading = drawHeading(left);
  expect(key(heading, "a")).toBe(true);
  expect(key(heading, "ArrowUp")).toBe(true);
  expect(left).toEqual([]);
});

test("it is named for what it edits and is no Tab stop of its own", () => {
  const heading = drawHeading([]);
  expect(heading.getAttribute("aria-label")).toBe("Task name");
  expect(heading.tabIndex).toBe(-1);
});

test("keys an input method took leave nothing and stay the input method's own", () => {
  const left: EditableHeadingLeave[] = [];
  const heading = drawHeading(left);
  expect(key(heading, "Enter", { isComposing: true })).toBe(true);
  expect(key(heading, "Enter", { keyCode: 229 })).toBe(true);
  expect(key(heading, "Escape", { isComposing: true })).toBe(true);
  expect(left).toEqual([]);
});
