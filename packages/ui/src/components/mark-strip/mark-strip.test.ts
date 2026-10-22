// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { MARK_STRIP_TONE, MarkStrip } from "./mark-strip.js";

/**
 * mark-strip.test.ts -- a hidden rail's strip draws a mark for each row, in
 * its tone, viewed or the one shown; it is hidden from assistive technology;
 * and a press anywhere on it shows the rail.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("a mark stands for each row, the strip is hidden from a reader, and a press on it shows the rail", () => {
  const shown: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(MarkStrip, {
        marks: [
          { tone: MARK_STRIP_TONE.DANGER, viewed: true },
          { tone: MARK_STRIP_TONE.COMPLETE, current: true },
          {},
        ],
        onPress: () => shown.push("rail"),
      }),
    ),
  );
  const strip = container.firstElementChild as HTMLElement;
  const marks = [...strip.children].map((mark) => [
    mark.getAttribute("data-tone"),
    mark.hasAttribute("data-viewed"),
    mark.hasAttribute("data-current"),
  ]);

  expect(strip.getAttribute("aria-hidden")).toBe("true");
  expect(marks).toEqual([
    ["danger", true, false],
    ["complete", false, true],
    [null, false, false],
  ]);

  const last = strip.lastElementChild as HTMLElement;
  act(() => last.click());
  expect(shown).toEqual(["rail"]);
});
