// @vitest-environment jsdom

import assert from "node:assert/strict";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Tooltip } from "./tooltip";

/**
 * tooltip.test.ts -- a card hung beside a row that names its row hangs past
 * the row's end, not its control's, so a control that gives its end up to
 * the row's acts on hover never puts the card over the row.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Gives `element` a fixed box, as layout would, since jsdom lays nothing out. */
function boxed(element: Element, left: number, right: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 10, right - left, 28);
}

/** A row whose press hangs a card beside it, the row named as its region, with acts after the press. */
function Row(): React.JSX.Element {
  const item = useRef<HTMLLIElement>(null);
  return createElement(
    "li",
    { ref: item, "data-row": "" },
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "Fix the refresh"),
      cardBeside: true,
      cardRegion: item,
      children: createElement(
        "button",
        { type: "button", "data-press": "", "aria-describedby": undefined },
        "Fix the refresh",
      ),
    }),
    createElement("button", { type: "button" }, "Archive"),
  );
}

test("a card hung from a row hangs past the row's end, not its press's, which the row's acts cut short", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Row))));
  const row = container.querySelector("[data-row]");
  const press = container.querySelector("[data-press]");
  assert.ok(row && press);
  boxed(row, 8, 260);
  boxed(press, 8, 200);

  act(() => {
    press.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card");
  assert.ok(card, "the card hangs");
  assert.equal(card.dataset.side, "end");
  assert.ok(
    Number.parseFloat(card.style.left) > 260,
    `the card stands past the row's end, at ${card.style.left}`,
  );
});
