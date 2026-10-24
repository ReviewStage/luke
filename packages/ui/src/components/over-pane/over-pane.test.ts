// @vitest-environment jsdom

import { MOTION_DURATION_MS } from "@luke/brand";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Button } from "../button/button.js";
import { OverPane } from "./over-pane.js";

/**
 * over-pane.test.ts -- a closed pane stays drawn through its slide out and
 * is let go once it has run, or at once where motion is held still; one
 * opened again on its way out stays; Escape and a press outside it close
 * it, a press in it or on its toggle, or any of its toggles, does not; and
 * it takes the keyboard as it opens, holds it against Tab, and hands it back
 * to its toggle as it closes; one that comes as a peek takes no keyboard
 * until it is made open.
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
  document.body.style.removeProperty("--luke-duration-pane");
  vi.useRealTimers();
});

/** A tab with a toggle that floats its pane, the pane holding two controls, and a control of the tab's own beside. */
function Tab(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return createElement(
    "div",
    null,
    createElement(Button, {
      ref: toggle,
      onClick: () => setOpen((was) => !was),
      children: "Files",
    }),
    createElement(Button, { onClick: () => undefined, children: "Elsewhere" }),
    createElement(OverPane, {
      open,
      onClose: () => setOpen(false),
      label: "Files pane",
      toggle,
      children: [
        createElement(Button, { key: "first", onClick: () => undefined, children: "First" }),
        createElement(Button, { key: "last", onClick: () => undefined, children: "Last" }),
      ],
    }),
  );
}

function mount(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Tab)));
  return container;
}

function pane(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[aria-label='Files pane']");
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((each) => each.textContent === name);
  if (found === undefined) throw new Error(`the ${name} button is drawn`);
  return found;
}

/** A press as a pointer makes it: down, then the click. */
function press(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    target.click();
  });
}

/** Opens the pane from its toggle, the keyboard on the toggle first, as a press or Return leaves it. */
function openFromToggle(): void {
  act(() => button("Files").focus());
  press(button("Files"));
}

function key(target: Element, name: string, shiftKey = false): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true }));
  });
}

test("a closed pane stays drawn and inert through its slide out, then is let go", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mount();
  expect(pane()).toBeNull();
  openFromToggle();
  expect(pane()?.getAttribute("data-state")).toBe("open");
  press(button("Files"));
  expect(pane()?.getAttribute("data-state")).toBe("leaving");
  expect(pane()?.hasAttribute("inert")).toBe(true);
  act(() => vi.advanceTimersByTime(MOTION_DURATION_MS.PANE - 1));
  expect(pane()).not.toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(pane()).toBeNull();
});

test("a pane opened again on its way out stays drawn, open", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  mount();
  openFromToggle();
  press(button("Files"));
  act(() => vi.advanceTimersByTime(MOTION_DURATION_MS.PANE / 2));
  press(button("Files"));
  act(() => vi.advanceTimersByTime(MOTION_DURATION_MS.PANE * 2));
  expect(pane()?.getAttribute("data-state")).toBe("open");
});

test("with motion held still, a closed pane is let go at once", () => {
  document.body.style.setProperty("--luke-duration-pane", "1ms");
  mount();
  openFromToggle();
  press(button("Files"));
  expect(pane()).toBeNull();
});

test("Escape in the pane closes it", () => {
  mount();
  openFromToggle();
  key(button("First"), "Escape");
  expect(pane()?.getAttribute("data-state")).toBe("leaving");
});

test("a press outside the pane closes it, and a press in it leaves it open", () => {
  mount();
  openFromToggle();
  press(button("Last"));
  expect(pane()?.getAttribute("data-state")).toBe("open");
  press(button("Elsewhere"));
  expect(pane()?.getAttribute("data-state")).toBe("leaving");
});

test("the pane takes the keyboard as it opens and holds it against Tab", () => {
  mount();
  openFromToggle();
  expect(document.activeElement).toBe(pane());
  key(pane() ?? document.body, "Tab");
  expect(document.activeElement).toBe(button("First"));
  key(button("First"), "Tab", true);
  expect(document.activeElement).toBe(button("Last"));
  key(button("Last"), "Tab");
  expect(document.activeElement).toBe(button("First"));
});

test("Escape hands the keyboard back to the toggle that opened the pane", () => {
  mount();
  openFromToggle();
  act(() => button("Last").focus());
  key(button("Last"), "Escape");
  expect(document.activeElement).toBe(button("Files"));
});

/** A tab whose pane is a peek until its Settle is pressed, the pane named by two toggles. */
function PeekTab(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(true);
  const first = useRef<HTMLButtonElement>(null);
  const second = useRef<HTMLButtonElement>(null);
  return createElement(
    "div",
    null,
    createElement(Button, {
      ref: first,
      onClick: () => {
        setPeek(true);
        setOpen(true);
      },
      children: "Peek",
    }),
    createElement(Button, { ref: second, onClick: () => setPeek(false), children: "Settle" }),
    createElement(Button, { onClick: () => undefined, children: "Elsewhere" }),
    createElement(OverPane, {
      open,
      peek,
      onClose: () => setOpen(false),
      label: "Files pane",
      toggle: [first, second],
      children: createElement(Button, { onClick: () => undefined, children: "Inside" }),
    }),
  );
}

test("a peek takes no keyboard and holds none against Tab, until it is made open; a press on either toggle is no press outside", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(PeekTab)));
  act(() => button("Elsewhere").focus());

  press(button("Peek"));
  expect(pane()?.getAttribute("data-arrival")).toBe("peek");
  expect(document.activeElement).toBe(button("Elsewhere"));
  key(button("Inside"), "Tab");
  expect(document.activeElement).toBe(button("Elsewhere"));

  press(button("Settle"));
  expect(pane()?.getAttribute("data-state")).toBe("open");
  expect(pane()?.hasAttribute("data-arrival")).toBe(false);
  expect(document.activeElement).toBe(pane());

  press(button("Elsewhere"));
  expect(pane()?.getAttribute("data-state")).toBe("leaving");
});

test("Escape puts a peek away wherever the keyboard stands, though it holds none", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(PeekTab)));
  act(() => button("Elsewhere").focus());
  press(button("Peek"));
  expect(pane()?.getAttribute("data-arrival")).toBe("peek");

  key(button("Elsewhere"), "Escape");
  expect(pane()?.getAttribute("data-state")).toBe("leaving");
});

test("a peek leaves Escape to what the keyboard stands in when that takes it", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(PeekTab)));
  act(() => button("Elsewhere").focus());
  press(button("Peek"));
  const taken = (event: Event) => event.preventDefault();
  button("Elsewhere").addEventListener("keydown", taken);

  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    button("Elsewhere").dispatchEvent(event);
  });
  expect(pane()?.getAttribute("data-state")).toBe("open");
});
