// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { relayout } from "../testing/resize-observer.js";
import { Conversation, ConversationContent } from "./conversation.js";

/**
 * conversation.test.ts -- a log following its newest line scrolls to it
 * when a line comes in or grows, and a render that changes no line leaves
 * the scroll alone. jsdom lays nothing out, so the log's heights are stood
 * in for and every write to its scroll position is heard.
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
});

/** The log's box as the window would lay it out: its height, the room it shows, and every scroll written to it. */
interface StandInBox {
  height: number;
  readonly writes: number[];
}

/** Lays out `box` as `layout` says, hearing every write to its scroll position. */
function layOut(box: HTMLElement, layout: StandInBox): void {
  let top = 0;
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => layout.height });
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(box, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      layout.writes.push(to);
      top = to;
    },
  });
}

/** Draws a log of `lines` in `root`. */
function draw(root: Root, lines: readonly string[]): void {
  act(() =>
    root.render(
      createElement(
        Conversation,
        null,
        createElement(
          ConversationContent,
          null,
          lines.map((line) => createElement("p", { key: line }, line)),
        ),
      ),
    ),
  );
}

/** Draws a log of `lines`, then lays its box out, so what follows is heard from a log at rest. */
function mount(lines: readonly string[]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  draw(root, lines);
  const box = container.querySelector<HTMLElement>("[role=log]") ?? assert.fail("the log");
  const layout: StandInBox = { height: 300, writes: [] };
  layOut(box, layout);
  return { root, box, layout };
}

test("a render with the same lines leaves the scroll alone, and a new line is scrolled to", () => {
  const { root, layout } = mount(["one", "two"]);
  draw(root, ["one", "two"]);
  draw(root, ["one", "two"]);
  assert.deepEqual(layout.writes, [], "a re-render with the same lines scrolls nowhere");
  layout.height = 400;
  draw(root, ["one", "two", "three"]);
  assert.deepEqual(layout.writes, [400], "a new line is scrolled to");
});

test("a line that grows while the log follows is scrolled to when the window reports it", () => {
  const { root, layout } = mount(["one"]);
  layout.height = 500;
  draw(root, ["one"]);
  assert.deepEqual(layout.writes, []);
  act(() => relayout());
  assert.deepEqual(layout.writes, [500], "the grown line is scrolled to");
});

test("a reader scrolled up to an earlier line is left there when a new line comes in", () => {
  const { root, box, layout } = mount(["one", "two"]);
  box.scrollTop = 0;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  layout.writes.splice(0);
  layout.height = 400;
  draw(root, ["one", "two", "three"]);
  act(() => relayout());
  assert.deepEqual(layout.writes, [], "the reader's place stands");
});
