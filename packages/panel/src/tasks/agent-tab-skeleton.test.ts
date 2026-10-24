// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";
import { ComposerSkeleton } from "./agent-tab-skeleton.js";

/**
 * The composer's placeholder stands as the composer will: its empty field
 * in the field's own room, so the card is as tall as the box that takes its
 * place, the + at the foot's left folding away where the box's own + does,
 * and the round Send at its right. jsdom lays nothing out, so what each rule
 * declares is read (`testing/container-width.ts`).
 */

/** The composer's card widths: a wide column's, and one under the narrowest fold. */
const CARD = { WIDE: 720, NARROWEST: 200 } as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
});

/** The placeholder drawn on a card `width` pixels wide. */
function drawnAt(width: number): HTMLElement {
  layContainersAt({ composer: width });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(ComposerSkeleton)));
  return container;
}

/** The blocks at each end of the card's foot. */
function footOf(card: HTMLElement) {
  const ends = ["luke-composer-foot-tools", "luke-composer-foot-end"].map((name) => {
    const end = card.querySelector(`.luke-composer-foot-bar > .${name}`);
    assert.ok(end, `the foot holds its .${name}`);
    return [...end.querySelectorAll<HTMLElement>(".luke-skeleton")];
  });
  return { lead: ends[0] ?? [], trail: ends[1] ?? [] };
}

test("the field stands in the composer field's room, one line and its insets tall", () => {
  const field = drawnAt(CARD.WIDE).querySelector(".agent-composer-input");
  assert.ok(field);
  // The field's height is drawn from the room's block, which an editor outside it never reads.
  assert.notEqual(
    getComputedStyle(field).getPropertyValue("--agent-composer-field-block").trim(),
    "",
  );
});

test("the foot stands the + at its left and the round Send last at its right", () => {
  const { lead, trail } = footOf(drawnAt(CARD.WIDE));
  assert.equal(lead.length, 1);
  assert.ok(lead.every(shown));
  assert.equal(trail.at(-1)?.dataset.shape, "circle");
});

test("the narrowest card folds the + away, as it folds the composer's own", () => {
  const { lead, trail } = footOf(drawnAt(CARD.NARROWEST));
  assert.equal(lead.filter(shown).length, 0);
  assert.equal(trail.at(-1)?.dataset.shape, "circle");
});
