// @vitest-environment jsdom

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { MOTION_DELAY_MS } from "@repo/brand";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BACK_BUTTON_LOOK, BackButton, type BackButtonLook, NO_BACK_KEY } from "./back-button.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOOKS = [BACK_BUTTON_LOOK.HEADER, BACK_BUTTON_LOOK.COLUMN] as const;

const roots: Root[] = [];

class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  delete document.documentElement.dataset.keyboard;
});

function draw(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(RegistryContext.Provider, { value: AtomRegistry.make() }, element)),
  );
}

function wayBack(
  look: BackButtonLook,
  keyed: Pick<Parameters<typeof BackButton>[0], "command" | "tabbable" | "keepFocus" | "name"> = {},
): { button: HTMLButtonElement; backs: () => number } {
  let backs = 0;
  draw(
    createElement(BackButton, {
      ...keyed,
      look,
      label: "Inbox",
      place: "inbox",
      onBack: () => {
        backs += 1;
      },
    }),
  );
  const button = document.querySelector("button");
  if (button === null) throw new Error("No way back");
  return { button, backs: () => backs };
}

function focusByKeyboard(button: HTMLButtonElement): void {
  document.documentElement.dataset.keyboard = "true";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  act(() => button.focus());
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  vi.useRealTimers();
}

test.each(LOOKS)("a way back in a %s is named by its words and goes back once pressed", (look) => {
  const { button, backs } = wayBack(look);
  expect(button.textContent).toContain("Inbox");
  act(() => button.click());
  expect(backs()).toBe(1);
});

test("a way back in a bar given a name says it to a reader, its words still drawn", () => {
  const { button } = wayBack(BACK_BUTTON_LOOK.HEADER, { name: "Back to Inbox" });
  expect(button.getAttribute("aria-label")).toBe("Back to Inbox");
  expect(button.textContent).toContain("Inbox");
});

test.each(LOOKS)("a way back in a %s hints where it leads, with the key that goes back", (look) => {
  const { button } = wayBack(look);
  focusByKeyboard(button);
  const hint = document.querySelector('[role="tooltip"]');
  expect(hint?.textContent).toContain("Back to inbox");
  const described = document.getElementById(button.getAttribute("aria-describedby") ?? "");
  expect(described?.textContent).toBe("Back to inbox");
  expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+[");
});

test.each(LOOKS)(
  "a way back in a %s that names no key hints where it leads and says no key",
  (look) => {
    const { button } = wayBack(look, { command: NO_BACK_KEY });
    focusByKeyboard(button);
    const hint = document.querySelector('[role="tooltip"]');
    expect(hint?.textContent).toBe("Back to inbox");
    expect(button.getAttribute("aria-keyshortcuts")).toBeNull();
  },
);

test("a way back in a bar that is not tabbable leaves the tab order, and one that keeps focus refuses the press's focus move", () => {
  const { button } = wayBack(BACK_BUTTON_LOOK.HEADER, { tabbable: false, keepFocus: true });
  expect(button.tabIndex).toBe(-1);
  const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    button.dispatchEvent(press);
  });
  expect(press.defaultPrevented).toBe(true);
});
