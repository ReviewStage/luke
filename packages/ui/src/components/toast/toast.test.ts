// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { TOAST_TONE, Toast } from "./toast.js";
import { ToastActions } from "./toast-actions.js";
import { ToastStack } from "./toast-stack.js";

/**
 * toast.test.ts -- a toast with an action holds under the pointer and focus
 * apart, dismisses on Escape and on its ×, and presses its action after
 * dismissing; one without is never held; its countdown stops while it is
 * held; a turn of tone keeps the glyph it led with to fade under the new
 * one; a drag or a trackpad sweep past the threshold sends it away and one
 * short of it puts it back; the stack names itself and says the newest words
 * through its two live regions.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function acting(
  onHold: (holding: boolean) => void,
  onEscape: () => void,
  onPress: () => void,
  countdown?: number,
) {
  return createElement(Toast, {
    tone: TOAST_TONE.DONE,
    words: "Task archived",
    countdown,
    onHold,
    onEscape,
    actions: createElement(ToastActions, {
      label: "Undo",
      onPress,
      dismissLabel: "Dismiss",
      onDismiss: onEscape,
    }),
  });
}

test("a toast is held while the pointer or focus is on it, and let go once neither is", () => {
  const onHold = vi.fn();
  const view = render(
    createElement(
      "ol",
      null,
      acting(
        onHold,
        () => undefined,
        () => undefined,
      ),
    ),
  );
  const toast = view.querySelector("li");
  assert.ok(toast !== null);

  act(() =>
    toast.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body }),
    ),
  );
  act(() => toast.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  act(() =>
    toast.dispatchEvent(
      new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    ),
  );
  assert.deepEqual(onHold.mock.calls, [[true]], "focus still holds it");
  act(() => toast.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  assert.deepEqual(onHold.mock.calls, [[true], [false]]);
});

test("Escape in a toast with an action dismisses it, and its action dismisses before it presses", () => {
  const calls: string[] = [];
  const view = render(
    createElement(
      "ol",
      null,
      acting(
        () => undefined,
        () => calls.push("dismiss"),
        () => calls.push("press"),
      ),
    ),
  );
  const toast = view.querySelector("li");
  assert.ok(toast !== null);
  act(() => toast.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  const undo = [...view.querySelectorAll("button")].find((b) => b.textContent === "Undo");
  assert.ok(undo !== undefined);
  act(() => undo.click());
  assert.deepEqual(calls, ["dismiss", "dismiss", "press"]);
});

test("a toast with no action takes no press and no hold", () => {
  const view = render(
    createElement(
      "ol",
      null,
      createElement(Toast, { tone: TOAST_TONE.FAILED, words: "Couldn't save", detail: "Offline" }),
    ),
  );
  const toast = view.querySelector("li");
  assert.ok(toast !== null);
  assert.equal(toast.dataset.action, undefined);
  assert.equal(view.querySelectorAll("button").length, 0);
  assert.equal(toast.querySelector(".luke-toast-detail")?.textContent, "Offline");
});

test("the stack is a named landmark with a polite and an alert region", () => {
  const view = render(
    createElement(ToastStack, {
      label: "Notifications",
      polite: "Link copied",
      alert: "Couldn't save",
      children: null,
    }),
  );
  assert.equal(view.querySelector("section")?.getAttribute("aria-label"), "Notifications");
  assert.equal(view.querySelector('[role="status"]')?.textContent, "Link copied");
  assert.equal(view.querySelector('[role="alert"]')?.textContent, "Couldn't save");
});

/** A pointer's press, travel, or release on `target`, at `x` across and `y` down. */
function pointer(target: Element, type: string, x: number, y = 0): void {
  act(() =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
    ),
  );
}

/** A toast with an action that records each dismissal in `dismissed`. */
function swipeable(dismissed: string[]): HTMLLIElement {
  const view = render(
    createElement(
      "ol",
      null,
      acting(
        () => undefined,
        () => dismissed.push("dismiss"),
        () => undefined,
      ),
    ),
  );
  const toast = view.querySelector("li");
  assert.ok(toast !== null);
  return toast;
}

test("a toast's countdown drains over the hold it is handed, and stops while the toast is held", () => {
  const view = render(
    createElement(
      "ol",
      null,
      acting(
        () => undefined,
        () => undefined,
        () => undefined,
        5000,
      ),
    ),
  );
  const toast = view.querySelector("li");
  const bar = view.querySelector<HTMLElement>(".luke-toast-countdown");
  assert.ok(toast !== null && bar !== null);

  act(() => toast.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  const held = toast.dataset.held;
  act(() => toast.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

  assert.equal(bar.style.getPropertyValue("--luke-toast-hold"), "5000ms");
  assert.equal(held, "true");
  assert.equal(toast.dataset.held, undefined);
});

test("a toast whose tone turns keeps the glyph it led with beside the new one, and its words change in place", () => {
  const container = document.body.appendChild(document.createElement("ol"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Toast, { tone: TOAST_TONE.WORKING, words: "Saving…" })));
  const toast = container.querySelector("li");
  const before = [...container.querySelectorAll<HTMLElement>(".luke-toast-glyph > span")];

  act(() => root.render(createElement(Toast, { tone: TOAST_TONE.DONE, words: "Saved" })));
  const after = [...container.querySelectorAll<HTMLElement>(".luke-toast-glyph > span")];

  assert.deepEqual(
    before.map((glyph) => glyph.dataset.tone),
    [TOAST_TONE.WORKING],
  );
  assert.deepEqual(
    after.map((glyph) => [glyph.dataset.tone, glyph.dataset.turn]),
    [
      [TOAST_TONE.WORKING, "was"],
      [TOAST_TONE.DONE, "now"],
    ],
  );
  assert.equal(container.querySelector("li"), toast, "the same card");
  assert.equal(toast?.dataset.tone, TOAST_TONE.DONE);
  assert.equal(container.querySelector(".luke-toast-words")?.textContent, "Saved");
});

test("a toast dragged sideways past the threshold is sent away off that side, and one let go short of it goes back", () => {
  const dismissed: string[] = [];
  const toast = swipeable(dismissed);

  pointer(toast, "pointerdown", 0);
  pointer(toast, "pointermove", 30);
  const following = toast.style.getPropertyValue("--luke-toast-drag");
  pointer(toast, "pointerup", 30);
  const back = toast.style.getPropertyValue("--luke-toast-drag");
  const shortOf = [...dismissed];
  pointer(toast, "pointerdown", 0);
  pointer(toast, "pointermove", 120);
  pointer(toast, "pointerup", 120);

  assert.equal(following, "30px");
  assert.equal(back, "0px");
  assert.deepEqual(shortOf, []);
  assert.deepEqual(dismissed, ["dismiss"]);
  assert.equal(toast.dataset.swiped, "right");
});

test("a press that travels up or down, or not at all, is no swipe", () => {
  const dismissed: string[] = [];
  const toast = swipeable(dismissed);

  pointer(toast, "pointerdown", 0, 0);
  pointer(toast, "pointermove", 10, 120);
  pointer(toast, "pointermove", 120, 120);
  pointer(toast, "pointerup", 120, 120);

  assert.deepEqual(dismissed, []);
  assert.equal(toast.style.getPropertyValue("--luke-toast-drag"), "");
});

test("a trackpad's sideways sweep sends the toast away once it passes the threshold, and an up-and-down scroll is no sweep", () => {
  const dismissed: string[] = [];
  const toast = swipeable(dismissed);
  const sweep = (deltaX: number, deltaY = 0) =>
    act(() => toast.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX, deltaY })));

  sweep(4, 40);
  const scrolled = toast.style.getPropertyValue("--luke-toast-drag");
  sweep(20);
  sweep(20);
  const before = [...dismissed];
  sweep(40);

  assert.equal(scrolled, "", "an up-and-down scroll is no sweep");
  assert.deepEqual(before, []);
  assert.deepEqual(dismissed, ["dismiss"]);
  assert.equal(toast.dataset.swiped, "left");
});
