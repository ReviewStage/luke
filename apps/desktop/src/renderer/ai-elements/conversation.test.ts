// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  followsNewest,
} from "./conversation";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The log's scroll box as jsdom lays it out: a fixed height over a content height the test sets. */
function scrollBox(container: HTMLElement, contentHeight: number): HTMLElement {
  const box = container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(box);
  Object.defineProperty(box, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(box, "scrollHeight", { configurable: true, value: contentHeight });
  return box;
}

test("the list follows the newest line only while it is scrolled to the bottom", () => {
  assert.equal(followsNewest({ scrollTop: 600, scrollHeight: 1_000, clientHeight: 400 }), true);
  assert.equal(followsNewest({ scrollTop: 590, scrollHeight: 1_000, clientHeight: 400 }), true);
  assert.equal(followsNewest({ scrollTop: 300, scrollHeight: 1_000, clientHeight: 400 }), false);
});

test("the way back to the newest line appears once the reader scrolls away, and takes them there", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (lines: number) =>
    act(() =>
      root.render(
        createElement(
          Conversation,
          null,
          createElement(
            ConversationContent,
            null,
            ...Array.from({ length: lines }, (_, index) =>
              createElement("p", { key: index }, `Line ${index}`),
            ),
          ),
          createElement(ConversationScrollButton),
        ),
      ),
    );
  const button = () => container.querySelector<HTMLButtonElement>("button");

  draw(1);
  const box = scrollBox(container, 1_000);
  assert.equal(button(), null);

  box.scrollTop = 200;
  act(() => box.dispatchEvent(new Event("scroll")));
  assert.ok(button());

  // A new line leaves the reader where they are, with the way back still offered.
  scrollBox(container, 1_200);
  draw(2);
  assert.equal(box.scrollTop, 200);
  assert.ok(button());

  act(() => button()?.click());
  assert.equal(box.scrollTop, 1_200);
  assert.equal(button(), null);
});
