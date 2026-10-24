// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@luke/brand";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { STATUS_TONE } from "../../status-tone.js";
import { TOAST_LOOK, Toast, type ToastLook } from "./toast.js";
import { ToastActions } from "./toast-actions.js";
import { ToastStack } from "./toast-stack.js";

/**
 * toast.test.ts -- a toast with an action holds under the pointer and focus
 * apart, dismisses on Escape and on its ×, and presses its action after
 * dismissing; one without is never held; its countdown stops while it is
 * held; a turn of tone keeps the glyph it led with to fade under the new
 * one; a drag or a trackpad sweep past the threshold sends it away and one
 * short of it puts it back; a compact one leaves its second line to the announcer
 * and stands across the window's foot; the stack names itself and says the newest words
 * through the window's announcer.
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
    tone: STATUS_TONE.COMPLETE,
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

test("an action given an href is a link to it in the action's look, and its press dismisses, then presses, without the browser following it", () => {
  const calls: string[] = [];
  const view = render(
    createElement(
      "ol",
      null,
      createElement(Toast, {
        tone: STATUS_TONE.DANGER,
        words: "Out of credit",
        actions: createElement(ToastActions, {
          label: "Add credit",
          href: "https://example.test/billing",
          onPress: () => calls.push("press"),
          dismissLabel: "Dismiss",
          onDismiss: () => calls.push("dismiss"),
        }),
      }),
    ),
  );
  const link = [...view.querySelectorAll("a")].find((a) => a.textContent === "Add credit");
  assert.ok(link !== undefined, "the action is a link");
  assert.equal(link.getAttribute("href"), "https://example.test/billing");
  assert.equal(
    [...view.querySelectorAll("button")].some((b) => b.textContent === "Add credit"),
    false,
    "and no button",
  );
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(click);
  });
  assert.deepEqual(calls, ["dismiss", "press"]);
  assert.equal(click.defaultPrevented, true);
});

test("a toast with no action takes no press and no hold", () => {
  const view = render(
    createElement(
      "ol",
      null,
      createElement(Toast, { tone: STATUS_TONE.DANGER, words: "Couldn't save", detail: "Offline" }),
    ),
  );
  const toast = view.querySelector("li");
  assert.ok(toast !== null);
  assert.equal(toast.dataset.action, undefined);
  assert.equal(view.querySelectorAll("button").length, 0);
  assert.equal(toast.querySelector(".luke-toast-detail")?.textContent, "Offline");
});

test("the stack is a named landmark that says the newest words through the window's announcer", () => {
  const stack = (polite: string, alert: string) =>
    createElement(ToastStack, { label: "Notifications", polite, alert, children: null });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(stack("", "")));
  assert.equal(container.querySelector("section")?.getAttribute("aria-label"), "Notifications");

  act(() => root.render(stack("Link copied", "")));
  assert.equal(container.querySelector('[role="status"]')?.textContent, "Link copied");

  act(() => root.render(stack("Link copied", "Couldn't save")));
  assert.equal(container.querySelector('[role="alert"]')?.textContent, "Couldn't save");
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
  assert.equal(bar.style.getPropertyValue("--luke-toast-seconds"), "5", "a notch a second");
  assert.equal(held, "true");
  assert.equal(toast.dataset.held, undefined);
});

test("a toast whose tone turns keeps the glyph it led with beside the new one, and its words change in place", () => {
  const container = document.body.appendChild(document.createElement("ol"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Toast, { tone: STATUS_TONE.WORKING, words: "Saving…" })));
  const toast = container.querySelector("li");
  const before = [...container.querySelectorAll<HTMLElement>(".luke-toast-glyph > span")];

  act(() => root.render(createElement(Toast, { tone: STATUS_TONE.COMPLETE, words: "Saved" })));
  const after = [...container.querySelectorAll<HTMLElement>(".luke-toast-glyph > span")];

  assert.deepEqual(
    before.map((glyph) => glyph.dataset.tone),
    [STATUS_TONE.WORKING],
  );
  assert.deepEqual(
    after.map((glyph) => [glyph.dataset.tone, glyph.dataset.turn]),
    [
      [STATUS_TONE.WORKING, "was"],
      [STATUS_TONE.COMPLETE, "now"],
    ],
  );
  assert.equal(container.querySelector("li"), toast, "the same card");
  assert.equal(toast?.dataset.tone, STATUS_TONE.COMPLETE);
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

test("a toast drawn compact shows its words alone, and its stack stands across the window's foot rather than in its corner", () => {
  const drawn = (look: ToastLook) =>
    render(
      createElement(ToastStack, {
        label: "Notifications",
        polite: "",
        alert: "Couldn't end the call",
        look,
        children: createElement(Toast, {
          tone: STATUS_TONE.DANGER,
          words: "Couldn't end the call",
          detail: "The voice window is not answering.",
          look,
        }),
      }),
    );
  drawn(TOAST_LOOK.CARD);
  drawn(TOAST_LOOK.COMPACT);
  const stacks = [...document.querySelectorAll<HTMLElement>("section.luke-toast-stack")];
  assert.deepEqual(
    stacks.map((stack) => [
      stack.dataset.look,
      stack.querySelector(".luke-toast-words")?.textContent,
      stack.querySelector(".luke-toast-detail")?.textContent ?? null,
    ]),
    [
      [TOAST_LOOK.CARD, "Couldn't end the call", "The voice window is not answering."],
      [TOAST_LOOK.COMPACT, "Couldn't end the call", null],
    ],
  );
});

/** The words of the hint the pointer resting on `target` raises, past the hint's wait, on a faked clock. */
function hintOn(target: Element): string | undefined {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
    });
    return document.querySelector('[role="tooltip"]')?.textContent ?? undefined;
  } finally {
    vi.useRealTimers();
  }
}

test("a toast's × says Dismiss in a hint on hover", () => {
  const view = render(
    createElement(
      "ol",
      null,
      acting(
        () => undefined,
        () => undefined,
        () => undefined,
      ),
    ),
  );
  const dismiss = view.querySelector('button[aria-label="Dismiss"]');
  assert.ok(dismiss !== null);
  assert.equal(hintOn(dismiss), "Dismiss");
});
