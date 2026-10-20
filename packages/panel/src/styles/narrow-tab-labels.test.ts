// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-tab-labels.test.ts -- a phone's tabs and crumbs say what they are. On the
 * desktop a tab other than the chosen one narrower than 72px turns to its
 * glyph, its hint naming it under the pointer; a phone has no pointer to
 * hover, and two agents' glyphs look alike, so in a narrow room every tab
 * keeps its label and the strip scrolls instead. jsdom lays nothing out, so
 * the sheets are laid for a tab container that narrow
 * (`testing/container-width.ts`) and the strip is built in the markup
 * `tab-strip.tsx` draws. An Inbox item's crumbs, squeezed beside its bar's
 * buttons to a glyph and a letter, take a line of their own there.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A strip of two tabs in a shell of the room given, the first chosen, each 62px wide, answering the second's label. */
function unchosenLabel(room: string): HTMLElement {
  laid = layContainersAt({ tab: 62 }, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const strip = shell.appendChild(document.createElement("div"));
  strip.className = "tab-strip";
  const labels = ["Call", "Refresh tokens before expiry"].map((name, at) => {
    const tab = strip.appendChild(document.createElement("div"));
    tab.className = "tab";
    tab.dataset.selected = String(at === 0);
    const button = tab.appendChild(document.createElement("span"));
    button.className = "tab-button";
    button.setAttribute("role", "tab");
    const label = button.appendChild(document.createElement("span"));
    label.className = "tab-label";
    label.textContent = name;
    return label;
  });
  return labels[1] ?? assert.fail("the second tab's label");
}

test("in a narrow room a tab other than the chosen one keeps its label however narrow it stands", () => {
  assert.ok(shown(unchosenLabel("narrow")));
});

test("on the desktop's width a tab other than the chosen one narrower than 72px stands as its glyph alone", () => {
  assert.ok(!shown(unchosenLabel("wide")));
});

/** An Inbox item's bar at a phone's width, in a shell of the room given: the way back, the crumbs, and the Resolve, answering the crumbs. */
function itemCrumbs(room: string): HTMLElement {
  laid = layContainersAt({ "inbox-item": 390 }, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const pane = shell.appendChild(document.createElement("section"));
  pane.className = "inbox-view-items";
  const bar = pane.appendChild(document.createElement("header"));
  bar.className = "desktop-toolbar";
  bar.appendChild(document.createElement("button")).textContent = "Inbox";
  const crumbs = bar.appendChild(document.createElement("div"));
  crumbs.className = "inbox-crumbs";
  bar.appendChild(document.createElement("button")).textContent = "Resolve";
  return crumbs;
}

test("in a narrow room an Inbox item's crumbs take a line of their own under the way back and the Resolve, so they are not squeezed to a letter", () => {
  const crumbs = itemCrumbs("narrow");
  assert.equal(getComputedStyle(crumbs).flexBasis, "100%");
  assert.equal(getComputedStyle(crumbs).order, "1");
});

test("on the desktop's width an Inbox item's crumbs stand in its bar's one row, at any width the bar holds them", () => {
  assert.notEqual(getComputedStyle(itemCrumbs("wide")).flexBasis, "100%");
});
