// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { ThumbStrip } from "../../index.js";

/**
 * thumb-strip.test.ts -- a press on a thumb shows its file, and the shown
 * file's thumb alone is marked current and stops Tab, the focus following
 * it where it stood on the strip. Synthetic files.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [{ name: "one.png", image: "data:," }, { name: "two.png" }, { name: "notes.txt" }];

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("a press on a thumb shows its file, whose thumb alone is current and stops Tab, taking the focus from the strip", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let at = 0;
  const draw = () =>
    act(() =>
      root.render(
        createElement(ThumbStrip, {
          label: "Files",
          items: ITEMS,
          at,
          onPick: (next: number) => {
            at = next;
            draw();
          },
        }),
      ),
    );
  draw();
  const thumb = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
    expect.fail(`the strip holds ${name}`);

  act(() => thumb("one.png").focus());
  act(() => thumb("notes.txt").click());

  expect(at).toBe(2);
  const current = [...container.querySelectorAll("button")].map((button) => [
    button.getAttribute("aria-current"),
    button.tabIndex,
  ]);
  expect(current).toEqual([
    ["false", -1],
    ["false", -1],
    ["true", 0],
  ]);
  expect(document.activeElement).toBe(thumb("notes.txt"));
});
