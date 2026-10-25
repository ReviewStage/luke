// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * plan-document-inset.test.ts -- a plan's document gives back half its inset
 * at its start under 480px of room, as every page does, and keeps its end's,
 * where the comment gutter stands. jsdom lays nothing out and drops a
 * shorthand drawn from a custom property, so a side the narrow room sets is
 * read as the declaration it names, and a side it leaves is read against the
 * same side in a wide column.
 */

/** Half the page's inset, which a narrow room gives back. */
const NARROW = "var(--luke-page-inset-narrow)";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** The document body's start and end padding in a desktop column `width` wide. */
function insetAt(width: number): { start: string; end: string } {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  layContainersAt(
    { "plan-document": width },
    { only: ["@luke/ui/tokens.css", "./tasks.css", "./desktop.css"] },
  );
  const column = document.body.appendChild(document.createElement("div"));
  column.className = "desktop-document";
  const body = column.appendChild(document.createElement("div"));
  body.className = "plan-document-body";
  const style = getComputedStyle(body);
  return { start: style.paddingLeft, end: style.paddingRight };
}

test("a plan in a narrow column starts at half the page's inset", () => {
  assert.equal(insetAt(390).start, NARROW);
});

test("a plan in a wide column keeps the page's whole inset at its start", () => {
  assert.notEqual(insetAt(720).start, NARROW);
});

test("a plan in a narrow column keeps its end's inset, where the comment gutter stands", () => {
  const wide = insetAt(720).end;
  document.head.replaceChildren();
  document.body.replaceChildren();
  assert.equal(insetAt(390).end, wide);
});
