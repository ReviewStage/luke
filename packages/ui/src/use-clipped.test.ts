// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useClipped } from "./use-clipped.js";

/**
 * use-clipped.test.ts -- a label is marked cut short once its words outrun
 * its box: words handed in as a string in the very render that draws them,
 * and words drawn as a tree once the change under the box is heard. jsdom
 * lays nothing out, so a box is stood in for as 50px wide, its words 10px a
 * letter, and the observer reports a box once as a first layout would.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {}
      observe(): void {
        this.heard([], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(50);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.textContent ?? "").length * 10;
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A label drawing `words`, handing them to the hook, or as a tree it cannot compare where `tree` says so. */
function Label({ words, tree }: { words: string; tree: boolean }): React.JSX.Element {
  const [measured, clipped] = useClipped(tree ? undefined : words);
  return createElement(
    "span",
    { ref: measured, "data-overflow": String(clipped) },
    tree ? createElement("b", null, words) : words,
  );
}

/** Draws a label of `words` and answers what reads whether it is cut short, and a way to draw it again. */
function mount(words: string, tree: boolean) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const draw = (next: string) =>
    act(() => root.render(createElement(Label, { words: next, tree })));
  draw(words);
  return {
    overflow: () => container.querySelector("span")?.getAttribute("data-overflow") ?? null,
    draw,
  };
}

test("words handed in are measured in the render that renames them", () => {
  const label = mount("Plan", false);
  assert.equal(label.overflow(), "false");
  label.draw("Plan");
  assert.equal(label.overflow(), "false");
  label.draw("A longer plan");
  assert.equal(label.overflow(), "true", "renamed longer, it is cut short before it is painted");
  label.draw("Plan");
  assert.equal(label.overflow(), "false", "renamed shorter, it reads whole again");
});

test("words drawn as a tree are measured once the change under the box is heard", async () => {
  const label = mount("Plan", true);
  assert.equal(label.overflow(), "false");
  label.draw("A longer plan");
  await act(async () => undefined);
  assert.equal(label.overflow(), "true");
});
