// @vitest-environment jsdom

import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CARD_PADDING, Card } from "./card.js";

/**
 * card.test.ts -- a card shows what it holds at every padding, offers its
 * hint to a pointer resting on it, and hands its element to what measures
 * against it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` on the page and hands back what it was drawn into. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a card shows what it holds at every padding", () => {
  for (const padding of Object.values(CARD_PADDING)) {
    const container = draw(
      createElement(Card, {
        padding,
        children: createElement("button", { type: "button" }, "Try again"),
      }),
    );
    expect(container.querySelector("button")?.textContent).toBe("Try again");
  }
});

test("a card's hint is the whole card's, and its element reaches what measures it", () => {
  const ref = createRef<HTMLDivElement>();
  const container = draw(
    createElement(Card, {
      title: "Counted since launch",
      ref,
      children: createElement("p", null, "1,204"),
    }),
  );
  const paragraph = container.querySelector("p");
  expect(paragraph?.closest("[title]")?.getAttribute("title")).toBe("Counted since launch");
  expect(ref.current?.contains(paragraph ?? null)).toBe(true);
});
