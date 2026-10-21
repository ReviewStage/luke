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

/** Scrolls `box` to `top` as a reader or the browser would, so the log hears it. */
function scroll(box: HTMLElement, top: number): void {
  box.scrollTop = top;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** Draws a log of `lines` in `root`, asking for older lines through `onNearTop` where one is handed. */
function draw(root: Root, lines: readonly string[], onNearTop?: () => void): void {
  act(() =>
    root.render(
      createElement(
        Conversation,
        { onNearTop },
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
function mount(lines: readonly string[], onNearTop?: () => void) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  draw(root, lines, onNearTop);
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
  scroll(box, 200);
  scroll(box, 0);
  layout.writes.splice(0);
  layout.height = 400;
  draw(root, ["one", "two", "three"]);
  act(() => relayout());
  assert.deepEqual(layout.writes, [], "the reader's place stands");
});

test("a log the browser shifts down to hold its place, as lines above it grow, still follows its newest line", () => {
  const { box, layout } = mount(["one", "two"]);
  scroll(box, 200);
  // A line above grows 200px, and the browser's scroll anchoring moves the log down 150px of it.
  layout.height = 500;
  scroll(box, 350);
  layout.writes.splice(0);
  act(() => relayout());
  assert.deepEqual(layout.writes, [500], "the log is taken the rest of the way to its end");
});

/** Stands in for each line's place in the log: 50px a line, one under another. */
function linesLaidOut(): void {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const siblings = this.parentElement === null ? [] : [...this.parentElement.children];
    return siblings.indexOf(this) * 50;
  });
}

test("lines put before the first keep the line the reader was on where it stood, and the log asks for them as the reader nears its top", () => {
  linesLaidOut();
  const asked: string[] = [];
  const older = () => void asked.push("older");
  const { root, box, layout } = mount(["c", "d", "e", "f"], older);
  scroll(box, 120);
  asked.splice(0);
  scroll(box, 30);
  assert.deepEqual(asked, ["older"], "a reader scrolling up near the top asks for older lines");

  layout.writes.splice(0);
  layout.height = 400;
  draw(root, ["a", "b", "c", "d", "e", "f"], older);
  // "c" stood 30px above the box's top; two lines of 50px landed above it.
  assert.deepEqual(layout.writes, [130], "the line the reader was on stays where it stood");
  const first = box.querySelector("p:nth-child(3)") as HTMLElement;
  assert.equal(first.offsetTop - box.scrollTop, -30);
});

test("a log that follows its newest line stays on it as lines are put before the first", () => {
  linesLaidOut();
  const { root, layout } = mount(["c", "d"], () => undefined);
  layout.writes.splice(0);
  layout.height = 400;
  draw(root, ["a", "b", "c", "d"], () => undefined);
  assert.deepEqual(layout.writes, [400]);
});

test("a fold the reader opens on the newest line grows under them without the log following it", () => {
  const { root, box, layout } = mount(["one", "two"]);
  draw(root, ["one", "two"]);
  const fold = document.createElement("details");
  const summary = fold.appendChild(document.createElement("summary"));
  box.firstElementChild?.appendChild(fold);
  act(() => summary.click());
  layout.writes.splice(0);
  layout.height = 900;
  act(() => relayout());
  assert.deepEqual(layout.writes, [], "the lines above the fold stay where they stood");
});
