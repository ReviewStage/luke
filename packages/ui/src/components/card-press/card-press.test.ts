// @vitest-environment jsdom

import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  CARD_PRESS_REACH,
  CARD_PRESS_SELECTOR,
  CardPress,
  type CardPressEvent,
} from "./card-press.js";

/**
 * card-press.test.ts -- a card's press is a real button the keyboard and a
 * reader reach, hands on the pointer's modifiers, refuses while unavailable,
 * and, through its card, presses on what is no control while a press on a
 * control stays that control's, unless the control presses the card too.
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

/** A card holding words, a control of its own, a chip that presses the card too, and its press. */
function card(
  presses: CardPressEvent[],
  props: { reach?: (typeof CARD_PRESS_REACH)[keyof typeof CARD_PRESS_REACH]; disabled?: boolean },
): React.ReactElement {
  return createElement(
    "article",
    null,
    createElement("p", null, "Ship the release"),
    createElement("button", { type: "button", "data-own": "" }, "Copy"),
    createElement("button", { type: "button", "data-chip": "" }, "@Goal"),
    createElement(CardPress, {
      onPress: (event) => {
        presses.push(event);
      },
      reach: props.reach,
      alsoPressedBy: "[data-chip]",
      disabled: props.disabled,
      label: "Open thread",
      children: "2 replies",
    }),
  );
}

test("a card's press is a button named by its label, found by its attribute, and pressed by a click", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, {}));
  const press = container.querySelector<HTMLButtonElement>(CARD_PRESS_SELECTOR);
  expect(press?.tagName).toBe("BUTTON");
  expect(press?.getAttribute("aria-label")).toBe("Open thread");

  act(() => press?.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));

  expect(presses.map((event) => event.metaKey)).toEqual([true]);
});

test("an unavailable press refuses the pointer and the card alike", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, { reach: CARD_PRESS_REACH.CARD, disabled: true }));

  act(() => container.querySelector<HTMLButtonElement>(CARD_PRESS_SELECTOR)?.click());
  act(() => container.querySelector("p")?.click());

  expect(presses).toEqual([]);
});

test("through its card, a press on its words presses it, and one on its own control does not", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, { reach: CARD_PRESS_REACH.CARD }));

  act(() => container.querySelector("p")?.click());
  expect(presses).toHaveLength(1);

  act(() => container.querySelector<HTMLButtonElement>("[data-own]")?.click());
  expect(presses).toHaveLength(1);
});

test("through its card, a control that presses the card too presses it, even one that stops its own press", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, { reach: CARD_PRESS_REACH.CARD }));
  const chip = container.querySelector<HTMLButtonElement>("[data-chip]");
  chip?.addEventListener("click", (event) => event.stopPropagation());

  act(() => chip?.click());

  expect(presses).toHaveLength(1);
});

test("through its card, its own button is pressed once, as the keyboard's way in", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, { reach: CARD_PRESS_REACH.CARD }));

  act(() => container.querySelector<HTMLButtonElement>(CARD_PRESS_SELECTOR)?.click());

  expect(presses).toHaveLength(1);
});

test("over its card, a click elsewhere in the card is no press, since the press lies over it", () => {
  const presses: CardPressEvent[] = [];
  const container = draw(card(presses, {}));

  act(() => container.querySelector("p")?.click());

  expect(presses).toEqual([]);
});

test("its element reaches what focuses it", () => {
  const ref = createRef<HTMLButtonElement>();
  const container = draw(
    createElement(CardPress, { onPress: () => undefined, ref, children: "Task" }),
  );
  expect(ref.current).toBe(container.querySelector("button"));
});
