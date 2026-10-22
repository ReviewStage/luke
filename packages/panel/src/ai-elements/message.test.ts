// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Tooltip } from "@luke/ui";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { Message, MessageContent } from "./message.js";

/**
 * message.test.ts -- on a screen with no hover, a tap spent opening a hint
 * inside a message shows none of the message's actions, while a tap on its
 * words still does.
 */

const roots: Root[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` into the document, on a registry of its own. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

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

/** A finger's tap on `target`, and the click its release makes where its touchend was not refused. */
function tap(target: Element): void {
  press(target, "pointerover");
  press(target, "pointerdown");
  press(target, "pointerup");
  press(target, "pointerout");
  const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(touchEnd);
    if (touchEnd.defaultPrevented) return;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** Whether a card stands, drawn and not on its way out. */
function cardStands(): boolean {
  const card = document.querySelector(".luke-tooltip-card");
  return card !== null && !card.hasAttribute("data-leaving");
}

test("on a screen with no hover, a tap spent opening a hint in a message shows none of the message's actions", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)" }));
  const page = mount(
    createElement(
      Message,
      { from: "assistant" },
      createElement(MessageContent, null, "Rerunning the spec on WebKit."),
      createElement(Tooltip, {
        label: "Worked for 3m",
        card: createElement("p", null, "Began at 9:14 AM"),
        children: createElement(
          "p",
          { "data-worked": "", "aria-describedby": undefined },
          "Worked for 3m",
        ),
      }),
    ),
  );
  const message = page.querySelector(".transcript-message") ?? assert.fail("the message");

  tap(page.querySelector("[data-worked]") ?? assert.fail("the line"));
  assert.equal(cardStands(), true);
  assert.equal(message.hasAttribute("data-actions-shown"), false);

  tap(page.querySelector(".message-content") ?? assert.fail("the words"));
  assert.equal(message.getAttribute("data-actions-shown"), "true", "a tap on its words still does");
});
