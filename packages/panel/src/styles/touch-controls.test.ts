// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MessageActions } from "@repo/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { Message, MessageAction, MessageContent } from "../ai-elements/message.js";
import { layContainersAt } from "../testing/container-width.js";

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

function layFor(touch: boolean): void {
  laid = layContainersAt({}, { touch });
}

function opacityOf(element: Element): number {
  const opacity = getComputedStyle(element).opacity;
  return opacity.endsWith("%") ? Number.parseFloat(opacity) / 100 : Number.parseFloat(opacity);
}

function standing(element: Element, press: Element = element): boolean {
  return opacityOf(element) === 1 && getComputedStyle(press).pointerEvents !== "none";
}

function faded(element: Element): boolean {
  return opacityOf(element) === 0;
}

function tappableMessage() {
  layFor(true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)" }));
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        Message,
        { from: "assistant" },
        createElement(MessageContent, null, "Rerunning the spec on WebKit."),
        createElement(
          MessageActions,
          null,
          createElement(MessageAction, { label: "Copy", onClick: () => undefined, children: "⧉" }),
        ),
      ),
    ),
  );
  const part = (selector: string) =>
    container.querySelector<HTMLElement>(selector) ?? assert.fail(selector);
  return {
    actions: () => part(".ui-message-actions"),
    tap: (selector: string) => act(() => part(selector).click()),
  };
}

test("on a touch screen a message's actions stay hidden at rest, so the transcript is not a column of buttons, stand once the message is tapped, and go with another tap", () => {
  const message = tappableMessage();
  assert.ok(faded(message.actions()));
  assert.equal(getComputedStyle(message.actions()).pointerEvents, "none");

  message.tap(".message-content");
  assert.ok(standing(message.actions()), "a tap on the message shows them");
  message.tap("button");
  assert.ok(standing(message.actions()), "a tap on one of them keeps them");
  message.tap(".message-content");
  assert.ok(faded(message.actions()), "another tap on the message hides them");
});

test("on a touch screen a press that ends a selection of a message's words leaves its actions as they were", () => {
  const message = tappableMessage();
  const words = document.querySelector(".message-content") ?? assert.fail("the words");
  window.getSelection()?.selectAllChildren(words);
  message.tap(".message-content");
  assert.ok(faded(message.actions()));
  window.getSelection()?.removeAllRanges();
});
