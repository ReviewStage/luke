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
  {
    at: 2,
    title: { label: "Auth refactor", detail: "Fix token refresh · Code" },
    page: { kind: "plan", of: "a" },
  },
  {
    at: 1,
    title: { label: "Auth refactor", detail: "Fix token refresh · Plan" },
    page: { kind: "plan", of: "a" },
  },
  {
    at: 0,
    title: { label: "Inbox", detail: "Desktop shell" },
    page: { kind: "inbox", of: undefined },
  },
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
  const window = mount([{ at: 0, title: undefined, page: { kind: "home", of: undefined } }]);
  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(menuWords(), ["Earlier page"]);
});

test("a press held into the list and let go there leaves the list's first click its own", () => {
  vi.useFakeTimers();
  const window = mount(BACK);
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
  act(() => vi.advanceTimersByTime(1000));
  // Let go over the list rather than over Back, which clicks nothing.
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  const inbox = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].at(-1);
  assert.ok(inbox);
  act(() => inbox.click());
  assert.deepEqual(window.went, [0], "the first click in the list goes to its step");
});

test("a touch held on Back opens its list and no hint over it, and Android's own contextmenu before the hold's timer spends the hold, so the lift takes no step", () => {
  vi.useFakeTimers();
  const window = mount(BACK);
  const touchDown = () =>
    act(() => {
      window.back.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
    });
  touchDown();
  act(() => vi.advanceTimersByTime(1000));
  assert.ok(document.querySelector('[role="menu"]'), "the held touch opened the list");
  assert.equal(document.querySelector('[role="tooltip"]'), null, "and no hint stands over it");
  act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  touchDown();
  act(() => vi.advanceTimersByTime(300));
  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const end = new TouchEvent("touchend", { bubbles: true, cancelable: true });
  act(() => {
    window.back.dispatchEvent(end);
  });
  assert.equal(end.defaultPrevented, true, "the lift makes no click of its own");
  assert.deepEqual(window.pressed, []);
});

test("after a mouse hold let go away from Back and its list shut, the keyboard's context-menu key opens the list again", () => {
  vi.useFakeTimers();
  const window = mount(BACK);
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
  act(() => vi.advanceTimersByTime(1000));
  act(() => {
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert.ok(menu);
  act(() => {
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  act(() => vi.advanceTimersByTime(1000));
  assert.equal(document.querySelector('[role="menu"]'), null, "Escape shut the list");

  act(() => {
    window.back.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  assert.ok(document.querySelector('[role="menu"]'), "the context-menu key opens it again");
});
