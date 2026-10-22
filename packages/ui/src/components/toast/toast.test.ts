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
 * dismissing; one without is never held; the stack names itself and says
 * the newest words through its two live regions.
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

function acting(onHold: (holding: boolean) => void, onEscape: () => void, onPress: () => void) {
  return createElement(Toast, {
    tone: TOAST_TONE.DONE,
    words: "Task archived",
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
