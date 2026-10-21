// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { HistoryStep, NavigationHistory } from "../navigation-history.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { HistoryButtons } from "./desktop-sidebar.js";

/**
 * history-buttons.test.ts -- Back and Forward list the steps along their
 * way on a right-click or a held press, as a browser's do, each named as the
 * window called it, a page's steps gathered together, and any of them gone
 * to at once; a plain press still takes one step.
 */

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
});

afterEach(() => {
  vi.useRealTimers();
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

const BACK: readonly HistoryStep[] = [
  { at: 2, title: { label: "Auth refactor", detail: "Fix token refresh · Code" }, page: "plan:a" },
  { at: 1, title: { label: "Auth refactor", detail: "Fix token refresh · Plan" }, page: "plan:a" },
  { at: 0, title: { label: "Inbox", detail: "Desktop shell" }, page: "inbox" },
];

/** Back and Forward over a history standing on the steps given, each step gone to and each press recorded. */
function mount(steps: readonly HistoryStep[]) {
  const went: number[] = [];
  const pressed: string[] = [];
  const history: NavigationHistory = {
    canGoBack: steps.length > 0,
    canGoForward: false,
    onBack: () => pressed.push("back"),
    onForward: () => pressed.push("forward"),
    steps: { back: steps, forward: [] },
    onGoTo: (at) => went.push(at),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(HistoryButtons, { history, room: SHELL_ROOM.WIDE }),
      ),
    ),
  );
  const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
  assert.ok(back);
  return { back, went, pressed };
}

/** The menu standing, its items' words in order and the rules between its groups. */
function menuWords(): string[] {
  const menu = document.querySelector('[role="menu"]');
  assert.ok(menu, "the list stands");
  return [...menu.querySelectorAll('[role="menuitem"], hr')].map((each) =>
    each.tagName === "HR" ? "—" : (each.textContent ?? ""),
  );
}

test("a right-click on Back lists the steps behind, the nearest first, each named with what it showed, a page's steps together", () => {
  const window = mount(BACK);
  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(menuWords(), [
    "Auth refactorFix token refresh · Code",
    "Auth refactorFix token refresh · Plan",
    "—",
    "InboxDesktop shell",
  ]);
});

test("choosing a step from Back's list goes straight to it, without a step of Back's own", () => {
  const window = mount(BACK);
  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const inbox = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].at(-1);
  assert.ok(inbox);
  act(() => inbox.click());
  assert.deepEqual(window.went, [0]);
  assert.deepEqual(window.pressed, []);
});

test("Back held opens its list and its release takes no step, while a quick press takes one step", () => {
  vi.useFakeTimers();
  const window = mount(BACK);
  const down = () =>
    act(() => {
      window.back.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    });
  const up = () =>
    act(() => {
      window.back.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      window.back.click();
    });

  down();
  up();
  assert.deepEqual(window.pressed, ["back"], "a quick press is a step");
  assert.equal(document.querySelector('[role="menu"]'), null);

  down();
  act(() => vi.advanceTimersByTime(1000));
  up();
  assert.ok(document.querySelector('[role="menu"]'), "the held press opened the list");
  assert.deepEqual(window.pressed, ["back"], "and its release took no step");
});

test("a step named nothing as the window stood on it is listed all the same", () => {
  const window = mount([{ at: 0, title: undefined, page: "home" }]);
  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(menuWords(), ["Earlier page"]);
});
