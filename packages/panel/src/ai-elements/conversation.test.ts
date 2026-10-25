// @vitest-environment jsdom

import assert from "node:assert/strict";
import { askScroll } from "@luke/ui/scroll-asked";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { relayout } from "../testing/resize-observer.js";
import {
  Conversation,
  ConversationContent,
  ConversationRows,
  ConversationScrollButton,
} from "./conversation.js";

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
  room: number;
  readonly writes: number[];
}

/** Lays out `box` as `layout` says, hearing every write to its scroll position. */
function layOut(box: HTMLElement, layout: StandInBox): void {
  let top = 0;
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => layout.height });
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => layout.room });
  Object.defineProperty(box, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      layout.writes.push(to);
      top = to;
    },
  });
}

/** Scrolls `box` to `top` as the browser would of its own accord, so the log hears it. */
function scroll(box: HTMLElement, top: number): void {
  box.scrollTop = top;
  act(() => {
    box.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** Scrolls `box` to `top` as the reader's wheel would. */
function readerScroll(box: HTMLElement, top: number): void {
  act(() => {
    box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: top - box.scrollTop }));
  });
  scroll(box, top);
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
  const layout: StandInBox = { height: 300, room: 100, writes: [] };
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
  readerScroll(box, 0);
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

/** Grows the log's box to `room` as lines land to `height` in the same frame, and hears the scroll the browser sends a frame later, its position pulled back to the box's end before the lines landed. */
function grownAsLinesLand(
  box: HTMLElement,
  layout: StandInBox,
  room: number,
  height: number,
): void {
  const pulledTo = layout.height - room;
  layout.room = room;
  layout.height = height;
  scroll(box, pulledTo);
}

test("a log on its newest line stays on it when the window grows its box as lines land, the browser pulling its scroll up", () => {
  const { box, layout } = mount(["one", "two"]);
  scroll(box, 200);
  layout.writes.splice(0);
  grownAsLinesLand(box, layout, 160, 420);
  assert.deepEqual(layout.writes, [140, 420], "the log is taken back to its new end");
  layout.writes.splice(0);
  layout.height = 480;
  act(() => relayout());
  assert.deepEqual(layout.writes, [480], "and goes on following its newest line");
});

test("a reader's wheel just before a scroll up takes the log off its newest line, though its box grew", () => {
  const { box, layout } = mount(["one", "two"]);
  scroll(box, 200);
  act(() => {
    box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -60 }));
  });
  grownAsLinesLand(box, layout, 160, 420);
  layout.writes.splice(0);
  layout.height = 480;
  act(() => relayout());
  assert.deepEqual(layout.writes, [], "the reader's place stands");
});

test("a log on its newest line stays on it when rows hidden and shown again in one frame leave its scroll at its first line", () => {
  const { box, layout } = mount(["one", "two"]);
  scroll(box, 200);
  layout.writes.splice(0);
  // The hidden rows clamped the scroll to the top, and stand again as tall as they were.
  scroll(box, 0);
  assert.deepEqual(layout.writes, [0, 300], "the log is taken back to its end");
});

test("a scroll up a script asks for takes the log off its newest line", () => {
  const { root, box, layout } = mount(["one", "two"]);
  scroll(box, 200);
  askScroll(box);
  scroll(box, 50);
  layout.writes.splice(0);
  layout.height = 400;
  draw(root, ["one", "two", "three"]);
  assert.deepEqual(layout.writes, [], "the line the script scrolled to stands");
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
  readerScroll(box, 30);
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
    return this.hasAttribute("data-virtual-rows") ? 16 : 0;
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

test("a long log opens on its newest line, and stays following it once the virtualizer takes its box", () => {
  logsLaidOut();
  const keys = Array.from({ length: 10 }, (_, index) => `line-${index}`);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const log = () =>
    createElement(
      Conversation,
      null,
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
    );
  act(() => root.render(log()));
  const box = container.querySelector<HTMLElement>("[role=log]") ?? assert.fail("the log");
  // jsdom scrolls nothing by `scrollTo`, which the virtualizer writes through.
  box.scrollTo = ((options?: ScrollToOptions) => {
    if (options?.top !== undefined) box.scrollTop = options.top;
  }) as HTMLElement["scrollTo"];
  // Drawn again, as any patch to the window's state draws it, by when the virtualizer takes the box.
  act(() => root.render(log()));
  scroll(box, box.scrollTop);
  assert.equal(box.scrollTop, 1400, "the log stands at its end");
  assert.equal(
    container.querySelector("[aria-label='Scroll to the newest line']"),
    null,
    "the log still follows its newest line",
  );
});
