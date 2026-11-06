// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import {
  Conversation,
  ConversationContent,
  ConversationRows,
  ConversationScrollButton,
} from "./conversation.js";

/**
 * conversation.test.ts -- a log opens on its newest line, offers the way
 * back to it once the reader scrolls away, and asks for older lines as the
 * reader nears its top. jsdom lays nothing out, so the log's heights are
 * stood in for.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

/** Lays out every log drawn from now on as 2000px of lines in a 600px box, its rows' block 16px down it. */
function logsLaidOut(): void {
  const tops = new WeakMap<Element, number>();
  const isLog = (element: Element) => element.getAttribute("role") === "log";
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLog(this) ? 2000 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLog(this) ? 600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("ui-virtual-rows") ? 16 : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return tops.get(this) ?? 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (
    this: Element,
    to: number,
  ) {
    tops.set(this, Math.max(0, Math.min(to, isLog(this) ? 1400 : 0)));
  });
}

/** The way back to the newest line, where it shows. */
const WAY_BACK = "[aria-label='Scroll to the newest line']";

/** Scrolls `box` to `top` as the browser would, so the log hears it. */
function scroll(box: HTMLElement, top: number): void {
  box.scrollTop = top;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** Draws a long log of ten lines, asking for older lines through `onNearTop` where one is handed, and answers its box. */
function mountLog(onNearTop?: () => void) {
  logsLaidOut();
  // jsdom has no `scrollTo` on an element, which the virtualizer writes through.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(this: HTMLElement, options?: ScrollToOptions) {
      if (options?.top !== undefined) this.scrollTop = options.top;
    },
  });
  const keys = Array.from({ length: 10 }, (_, index) => `line-${index}`);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        Conversation,
        { onNearTop },
        createElement(
          ConversationContent,
          null,
          createElement(ConversationRows, {
            keys,
            estimate: 160,
            gap: 12,
            children: (index: number) => createElement("p", null, keys[index]),
          }),
        ),
        createElement(ConversationScrollButton),
      ),
    ),
  );
  const box = container.querySelector<HTMLElement>("[role=log]") ?? assert.fail("the log");
  return { container, box };
}

test("a long log opens on its newest line, and offers the way back to it once the reader scrolls away", () => {
  const { container, box } = mountLog();
  scroll(box, box.scrollTop);
  assert.equal(box.scrollTop, 1400, "the log stands at its end");
  assert.equal(container.querySelector(WAY_BACK), null, "at its end it offers no way back");
  scroll(box, 300);
  const back = container.querySelector<HTMLButtonElement>(WAY_BACK) ?? assert.fail("the way back");
  act(() => back.click());
  scroll(box, box.scrollTop);
  assert.equal(box.scrollTop, 1400, "the way back takes the log to its end");
  assert.equal(container.querySelector(WAY_BACK), null);
});

test("a log asks for its older lines as the reader scrolls up near its top", () => {
  const asked: string[] = [];
  const { box } = mountLog(() => void asked.push("older"));
  scroll(box, 1400);
  asked.splice(0);
  scroll(box, 1000);
  assert.deepEqual(asked, [], "a scroll up far from the top asks for nothing");
  scroll(box, 400);
  assert.deepEqual(asked, ["older"], "a scroll up within a screen of the top asks for older lines");
});
