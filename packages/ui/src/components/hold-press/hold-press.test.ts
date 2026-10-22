// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import { HoldPress } from "./hold-press.js";

/**
 * hold-press.test.ts -- a press held on the control it wraps does its second
 * act and its release presses nothing, while a quick press is the control's
 * own; a right-click does what it asks in place of the system's menu; and an
 * unavailable control's held press counts for nothing.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Back, wrapped, each of its acts recorded in order. */
function mount(options: { disabled?: boolean; contextMenu?: boolean } = {}) {
  const done: string[] = [];
  function Back(): React.JSX.Element {
    const [, redraw] = useState(0);
    return createElement(
      HoldPress,
      {
        mouse: true,
        disabled: options.disabled,
        onHold: () => {
          done.push("held");
          redraw((count) => count + 1);
        },
        onContextMenu: options.contextMenu === true ? () => done.push("menu") : undefined,
      },
      createElement(IconButton, {
        icon: null,
        label: "Back",
        onClick: () => done.push("pressed"),
      }),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Back)));
  const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
  if (back === null) throw new Error("Back is not drawn");
  return { back, done };
}

function down(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
        isPrimary: true,
      }),
    );
  });
}

function release(element: HTMLElement): void {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    element.click();
  });
}

test("a quick press is the control's own, and one held does the second act and presses nothing", () => {
  vi.useFakeTimers();
  const { back, done } = mount();

  down(back);
  release(back);
  expect(done).toEqual(["pressed"]);

  down(back);
  act(() => vi.advanceTimersByTime(1000));
  release(back);
  expect(done).toEqual(["pressed", "held"]);

  down(back);
  release(back);
  expect(done).toEqual(["pressed", "held", "pressed"]);
});

test("a right-click does what it asks, in place of the system's menu", () => {
  const { back, done } = mount({ contextMenu: true });
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });

  act(() => {
    back.dispatchEvent(event);
  });

  expect(done).toEqual(["menu"]);
  expect(event.defaultPrevented).toBe(true);
});

test("an unavailable control's held press counts for nothing", () => {
  vi.useFakeTimers();
  const { back, done } = mount({ disabled: true });

  down(back);
  act(() => vi.advanceTimersByTime(1000));

  expect(done).toEqual([]);
});
