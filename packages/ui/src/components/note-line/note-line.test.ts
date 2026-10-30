/**
 * note-line.test.ts -- a note line is a plain line of words, with no press and
 * no alert; one a reader should hear land is a status, and one that is not
 * says nothing as it lands; and one a hint wraps hangs the hint's card, as a
 * finished turn's line hangs its turn's.
 */

// @vitest-environment jsdom

import { RegistryContext } from "@effect/atom-react/RegistryContext";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOTE_LINE_LOOK, NoteLine, Tooltip } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const WORDS = "No shells.";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` into the page and answers the container it was drawn in. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a note line announced as a status says its words alone, with no alert or press", () => {
  const container = mount(
    createElement(NoteLine, { look: NOTE_LINE_LOOK.LIST, status: true, children: WORDS }),
  );
  const statuses = container.querySelectorAll('[role="status"]');

  expect(statuses).toHaveLength(1);
  expect(statuses[0]?.textContent).toBe(WORDS);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});

test("a note line not announced says its words without a live role", () => {
  const container = mount(createElement(NoteLine, { children: WORDS }));

  expect(container.textContent).toBe(WORDS);
  expect(container.querySelector("[role]")).toBeNull();
});

/** A finger going `type` on `target`, as the browser sends it. */
function press(target: Element, type: string): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        pointerType: "touch",
        isPrimary: true,
        clientX: 12,
        clientY: 12,
      }),
    );
  });
}

test("a note line a hint wraps hangs the hint's card when tapped, found by its caller's mark", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)" }));
  const container = mount(
    createElement(
      RegistryContext.Provider,
      { value: AtomRegistry.make() },
      createElement(Tooltip, {
        label: "Worked for 3m",
        card: createElement("p", null, "Began at 9:14 AM"),
        children: createElement(NoteLine, {
          look: NOTE_LINE_LOOK.INSET,
          "data-worked": "",
          children: "Worked for 3m",
        }),
      }),
    ),
  );
  const line = container.querySelector("[data-worked]");
  expect(line?.textContent).toBe("Worked for 3m");

  for (const type of ["pointerover", "pointerdown", "pointerup", "pointerout"]) {
    press(line ?? document.body, type);
  }
  const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
  act(() => {
    line?.dispatchEvent(touchEnd);
    if (!touchEnd.defaultPrevented) {
      line?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    }
  });

  expect(document.querySelector(".luke-tooltip-card")?.textContent).toBe("Began at 9:14 AM");
});
