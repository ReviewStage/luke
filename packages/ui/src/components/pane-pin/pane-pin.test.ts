// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { Button } from "../button/button.js";
import { PanePin } from "./pane-pin.js";

/**
 * pane-pin.test.ts -- a press anywhere in a pinned pane, on a control in it
 * or on its bare ground, pins it before the document hears the press, and
 * a pane that floats nothing now pins nothing.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
const listeners: (() => void)[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const remove of listeners.splice(0)) remove();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A pane holding one button, whose pins and the document's presses are recorded in order. */
function mount(pins: boolean): { pane: HTMLElement; heard: string[] } {
  const heard: string[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PanePin, {
        "aria-label": "Pane",
        onPin: pins ? () => heard.push("pinned") : undefined,
        children: createElement(Button, { onClick: () => undefined, children: "Inside" }),
      }),
    ),
  );
  const pane = container.querySelector<HTMLElement>("[aria-label=Pane]");
  if (pane === null) throw new Error("the pane is drawn");
  const hear = () => heard.push("document");
  document.addEventListener("pointerdown", hear);
  listeners.push(() => document.removeEventListener("pointerdown", hear));
  return { pane, heard };
}

function pointerDown(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

test("a press on a control in the pane pins it before the document hears it", () => {
  const { pane, heard } = mount(true);
  pointerDown(pane.querySelector("button") ?? pane);
  expect(heard).toEqual(["pinned", "document"]);
});

test("a press on the pane's bare ground pins it too", () => {
  const { pane, heard } = mount(true);
  pointerDown(pane);
  expect(heard).toEqual(["pinned", "document"]);
});

test("a pane that floats nothing pins nothing", () => {
  const { pane, heard } = mount(false);
  pointerDown(pane);
  expect(heard).toEqual(["document"]);
});
