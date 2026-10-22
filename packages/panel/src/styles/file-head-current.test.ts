// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * file-head-current.test.ts -- the file Files changed's keys stand on is
 * marked as a selected card is, not ringed as a focused control: its card,
 * Pierre's file element the header stands in, draws its own edge in the
 * selected edge's ink, and the header itself wears no ring, so the card never
 * reads as double-bordered. Every other file's card keeps its edge. jsdom
 * lays nothing out and resolves no `light-dark()`, so the sheets are laid
 * (`testing/container-width.ts`), each file is built in the markup the list
 * draws (the card, Pierre's header slot, the view's kept element, and the
 * header, `changes-list.tsx`), and what the sheets declare for an element is
 * read off the rules that select it.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** A file's card in the list, its header standing or not; answers the card and its header. */
function card(list: Element, standing: boolean) {
  const container = list.appendChild(document.createElement("diffs-container"));
  const slot = container.appendChild(document.createElement("div"));
  slot.setAttribute("slot", "header-custom");
  const kept = slot.appendChild(document.createElement("div"));
  kept.className = "diff-list-head-slot";
  const head = kept.appendChild(document.createElement("div"));
  head.className = "diff-list-head";
  head.toggleAttribute("data-standing", standing);
  head.toggleAttribute("data-collapsed", true);
  return { container, head };
}

/** Whether `selector` selects `element`; a selector jsdom cannot read, a pseudo-element's, selects none of these. */
function selects(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** Every value the laid sheets declare for `property` on `element`, in the order they are laid. */
function declared(element: Element, property: string): string[] {
  const values: string[] = [];
  for (const rule of laid?.sheet?.cssRules ?? []) {
    if (!(rule instanceof CSSStyleRule) || !selects(element, rule.selectorText)) continue;
    const value = rule.style.getPropertyValue(property);
    if (value !== "") values.push(value);
  }
  return values;
}

test("the file the keys stand on draws its card's edge in the selected ink, and its header wears no ring", () => {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({});
  const list = document.body.appendChild(document.createElement("div"));
  list.className = "diff-view diff-list";
  const stood = card(list, true);
  const other = card(list, false);

  assert.deepEqual(declared(stood.container, "border-color"), [
    "var(--luke-color-border-selected)",
  ]);
  assert.deepEqual(declared(other.container, "border-color"), []);
  for (const { head } of [stood, other]) {
    assert.deepEqual(
      [...declared(head, "outline"), ...declared(head, "outline-style")],
      [],
      "no ring on the header",
    );
  }
});
