// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PopoverIconButton } from "./popover-icon-button.js";

/**
 * popover-icon-button.test.ts -- the button hangs its panel outside the box
 * it stands in, named by its title and saying so in `aria-expanded`; a second
 * press on the button puts the panel away rather than opening it again; and
 * Escape puts it away and hands the focus back to the button.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A button whose panel's standing is held as an owner holds it. */
function Held(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return createElement(PopoverIconButton, {
    icon: "☺",
    label: "Change icon",
    title: "Icon",
    open,
    onOpenChange: setOpen,
    children: createElement("p", null, "Pick an icon"),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

async function mount(): Promise<{ container: HTMLElement; button: HTMLButtonElement }> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Held)));
  await settle();
  const button = container.querySelector("button") ?? assert.fail("no button");
  return { container, button };
}

const panel = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Icon"]');

test("a press hangs the panel outside the button's box, and a second press puts it away", async () => {
  const { container, button } = await mount();
  assert.equal(button.getAttribute("aria-expanded"), "false");

  await act(async () => button.click());
  await settle();
  const shown = panel() ?? assert.fail("no panel");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(container.contains(shown), false, "the panel is drawn outside the button's box");
  assert.ok(shown.textContent?.includes("Pick an icon"));

  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    button.click();
  });
  await settle();
  assert.equal(button.getAttribute("aria-expanded"), "false");
});

test("Escape puts the panel away and hands the focus back to the button", async () => {
  const { button } = await mount();
  await act(async () => button.click());
  await settle();
  const shown = panel() ?? assert.fail("no panel");

  await act(async () => {
    shown.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await settle();

  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, button);
});
