// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-labels.test.ts -- a phone's tabs, crumbs, Start, and bylines say
 * what they are, within the column. On the desktop a tab other than the chosen one narrower than 72px
 * turns to its glyph, its hint naming it under the pointer; a phone has no pointer to
 * hover, and two agents' glyphs look alike, so in a narrow room every tab
 * keeps its label and the strip scrolls instead. jsdom lays nothing out, so
 * the sheets are laid for a tab container that narrow
 * (`testing/container-width.ts`) and the strip is built in the markup
 * `tab-strip.tsx` draws. An Inbox item's crumbs, squeezed beside its bar's
 * buttons to a glyph and a letter, take a line of their own there, and Start
 * keeps its word rather than folding to ▶. A sent message's byline, ending
 * at the bubble's right edge, cuts a long sender short rather than pushing
 * its buttons off the column's left edge.
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
    tab.dataset.closable = "true";
    tab.dataset.marked = "false";
    tab.appendChild(document.createElement("span")).className = "tab-close";
    return label;
  });
  return labels[1] ?? assert.fail("the second tab's label");
}

test("in a narrow room a tab other than the chosen one keeps its label however narrow it stands, its × giving the label its place", () => {
  const label = unchosenLabel("narrow");
  assert.ok(shown(label));
  const close = label.closest(".tab")?.querySelector(".tab-close") ?? assert.fail("its ×");
  assert.equal(getComputedStyle(close).visibility, "hidden");
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

/** Start in a task's bar at a phone's width, in a shell of the room given, answering how it folds. */
function startFold(room: string): string {
  laid = layContainersAt({ "plan-toolbar": 300 }, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const main = shell.appendChild(document.createElement("div"));
  main.className = "desktop-task-main";
  const bar = main.appendChild(document.createElement("header"));
  bar.className = "desktop-toolbar";
  const start = bar.appendChild(document.createElement("div"));
  start.className = "start-agent";
  return getComputedStyle(start).getPropertyValue("--luke-fold").trim();
}

test("in a narrow room Start keeps its word however narrow the task's bar, since a phone has no hover to name its glyph", () => {
  assert.ok(!["folded", "bare"].includes(startFold("narrow")));
});

test("on the desktop's width Start folds to its glyph in a bar that narrow, as it did", () => {
  assert.equal(startFold("wide"), "bare");
});

/** A sent message's byline in a shell of the room given: its actions, who sent it, and when. */
function byline(room: string) {
  laid = layContainersAt({}, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  const meta = shell.appendChild(document.createElement("div"));
  meta.className = "message-meta";
  const part = (className: string) => {
    const element = meta.appendChild(document.createElement("div"));
    element.className = className;
    return getComputedStyle(element);
  };
  return {
    actions: part("message-actions"),
    sender: part("message-sender"),
    sentAt: part("message-sent-at"),
  };
}

test("in a narrow room a sent message's byline keeps its buttons and its time inside the column, who sent it giving way to an ellipsis", () => {
  const { actions, sender, sentAt } = byline("narrow");
  assert.equal(sender.minWidth, "0px", "who sent it may narrow past its name");
  assert.equal(actions.flexShrink, "0", "the buttons keep their width");
  assert.equal(sentAt.flexShrink, "0", "the time keeps its width");
});
