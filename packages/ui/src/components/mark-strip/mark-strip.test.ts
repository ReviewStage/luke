// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { MARK_STRIP_LOOK, MARK_STRIP_TONE, MarkStrip } from "./mark-strip.js";

/**
 * mark-strip.test.ts -- a hidden rail's strip draws a mark for each row, in
 * its tone, viewed or the one shown; it is hidden from assistive technology;
 * a press anywhere on it shows the rail; and a strip that takes no press is
 * rested on instead, the pointer's coming and going heard.
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

test("a strip of bars that takes no press hears the pointer come to rest on it and leave", () => {
  const heard: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(MarkStrip, {
        look: MARK_STRIP_LOOK.BARS,
        marks: [{ tone: MARK_STRIP_TONE.WORKING, current: true }, {}],
        onPointerEnter: () => heard.push("rest"),
        onPointerLeave: () => heard.push("leave"),
      }),
    ),
  );
  const strip = container.firstElementChild as HTMLElement;
  expect(strip.firstElementChild?.getAttribute("data-tone")).toBe("working");

  act(() => (strip.lastElementChild as HTMLElement).click());
  act(() => strip.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
  act(() =>
    strip.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    ),
  );
  expect(heard).toEqual(["rest", "leave"]);
});
