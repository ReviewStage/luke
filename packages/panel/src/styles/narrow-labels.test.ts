// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-labels.test.ts -- a phone's tabs, crumbs, Start, and bylines say
 * what they are, within the column. Under a mouse a tab other than the chosen one narrower than 72px
 * turns to its glyph, its hint naming it under the pointer, in any room; a finger has no pointer to
 * hover, and two agents' glyphs look alike, so on a touch screen every tab
 * keeps its label and the strip scrolls instead. jsdom lays nothing out, so
 * the sheets are laid for a tab container that narrow
 * (`testing/container-width.ts`) and the strip is built in the markup
 * `@luke/ui`'s Tabs draws, folding as `tab-strip.tsx` tells it for the pointer. An Inbox item's crumbs, squeezed beside its bar's
 * buttons to a glyph and a letter, take a line of their own in a bar too narrow for them, by the item's own width in any room, and Start
 * keeps its word rather than folding to ▶. A sent message's byline, ending
 * at the bubble's right edge, cuts a long sender short rather than pushing
 * it off the column's left edge, in a narrow room and on the desktop's and
 * the web's width alike, where a narrow pane is as tight as a phone.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  delete document.documentElement.dataset.lukeRoom;
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A strip of two tabs in a shell of the room given, worked by a finger or a mouse, the first chosen, each 62px wide, answering the second's label. */
function unchosenLabel(room: string, touch: boolean): HTMLElement {
  laid = layContainersAt({ "luke-tab": 62 }, { touch });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  document.documentElement.dataset.lukeRoom = room;
  const strip = shell.appendChild(document.createElement("div"));
  strip.className = "luke-tabs";
  // The strip folds as the pointer says (`tab-strip.tsx`): to labels under a finger, to glyphs under a mouse.
  strip.dataset.fold = touch ? "label" : "glyph";
  const labels = ["Call", "Refresh tokens before expiry"].map((name, at) => {
    const tab = strip.appendChild(document.createElement("div"));
    tab.className = "luke-tab";
    tab.dataset.selected = String(at === 0);
    const button = tab.appendChild(document.createElement("span"));
    button.className = "luke-tab-button";
    button.setAttribute("role", "tab");
    const label = button.appendChild(document.createElement("span"));
    label.className = "luke-tab-label";
    label.textContent = name;
    tab.dataset.closable = "true";
    tab.dataset.marked = "false";
    tab.appendChild(document.createElement("span")).className = "luke-tab-close";
    return label;
  });
  return labels[1] ?? assert.fail("the second tab's label");
}

test("on a phone a tab other than the chosen one keeps its label however narrow it stands, its × giving the label its place", () => {
  const label = unchosenLabel("narrow", true);
  assert.ok(shown(label));
  const close =
    label.closest(".luke-tab")?.querySelector(".luke-tab-close") ?? assert.fail("its ×");
  assert.equal(getComputedStyle(close).visibility, "hidden");
});

test("under a mouse a tab other than the chosen one narrower than 72px stands as its glyph alone, in a narrow room and a wide one alike", () => {
  assert.ok(!shown(unchosenLabel("wide", false)));
  document.body.replaceChildren();
  assert.ok(!shown(unchosenLabel("narrow", false)));
});

/** An Inbox item's bar as wide as given, in a shell of the room given, drawn as `Toolbar` draws one whose heading may wrap: the way back, the crumbs, and the Resolve, answering the crumbs and the way back. */
function itemBar(room: string, width: number) {
  laid = layContainersAt({ "luke-toolbar": width }, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  document.documentElement.dataset.lukeRoom = room;
  const pane = shell.appendChild(document.createElement("section"));
  pane.className = "inbox-view-items";
  const bar = pane.appendChild(document.createElement("header"));
  bar.className = "luke-toolbar inbox-item-head";
  bar.dataset.wrapHeading = "true";
  const lead = bar.appendChild(document.createElement("div"));
  lead.className = "luke-toolbar-lead";
  lead.appendChild(document.createElement("button")).textContent = "Inbox";
  const heading = bar.appendChild(document.createElement("div"));
  heading.className = "luke-toolbar-heading";
  heading.appendChild(document.createElement("div")).className = "inbox-crumbs";
  const actions = bar.appendChild(document.createElement("div"));
  actions.className = "luke-toolbar-actions";
  actions.appendChild(document.createElement("button")).textContent = "Resolve";
  return {
    ownLine:
      getComputedStyle(heading).flexBasis === "100%" && getComputedStyle(heading).order === "1",
    backFolded: getComputedStyle(lead).getPropertyValue("--luke-fold").trim() === "folded",
  };
}

test("an Inbox item a phone's width takes its crumbs onto a line of their own under the way back and the Resolve, so they are not squeezed to a letter, in a narrow room and a wide one alike", () => {
  assert.deepEqual(itemBar("narrow", 390), { ownLine: true, backFolded: false });
  document.body.replaceChildren();
  assert.deepEqual(itemBar("wide", 390), { ownLine: true, backFolded: false });
});

test("an Inbox item with room for its crumbs keeps them in its bar's one row, in a narrow room too", () => {
  assert.equal(itemBar("narrow", 520).ownLine, false);
  document.body.replaceChildren();
  assert.equal(itemBar("wide", 720).ownLine, false);
});

test("an Inbox item narrower still folds its way back to its glyph, by its own width alone", () => {
  assert.deepEqual(itemBar("wide", 340), { ownLine: true, backFolded: true });
});

/** Start in a task's bar at a phone's width, in a shell of the room given, answering how it folds. */
function startFold(room: string): string {
  laid = layContainersAt({ "luke-toolbar": 300 }, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  document.documentElement.dataset.lukeRoom = room;
  const main = shell.appendChild(document.createElement("div"));
  main.className = "desktop-task-main";
  const bar = main.appendChild(document.createElement("header"));
  bar.className = "luke-toolbar";
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
  document.documentElement.dataset.lukeRoom = room;
  const meta = shell.appendChild(document.createElement("div"));
  meta.className = "luke-message-line";
  const part = (className: string) => {
    const element = meta.appendChild(document.createElement("div"));
    element.className = className;
    return getComputedStyle(element);
  };
  return {
    actions: part("luke-message-actions"),
    sender: part("luke-message-line-sender"),
    sentAt: part("luke-message-line-time"),
  };
}

for (const room of ["narrow", "wide"]) {
  test(`in a ${room} room a sent message's byline keeps its buttons and its time inside the column, who sent it giving way to an ellipsis`, () => {
    const { actions, sender, sentAt } = byline(room);
    assert.equal(sender.minWidth, "0px", "who sent it may narrow past its name");
    assert.equal(actions.flexShrink, "0", "the buttons keep their width");
    assert.equal(sentAt.flexShrink, "0", "the time keeps its width");
  });

  test(`in a ${room} room a sender named in plain words, one the window cannot place, ends in an ellipsis rather than running past its byline`, () => {
    laid = layContainersAt({}, { touch: room === "narrow" });
    const shell = document.body.appendChild(document.createElement("div"));
    shell.className = "desktop-shell";
    shell.dataset.room = room;
    document.documentElement.dataset.lukeRoom = room;
    const words = shell
      .appendChild(document.createElement("div"))
      .appendChild(document.createElement("span"))
      .appendChild(document.createElement("span"));
    words.className = "luke-text message-sender-words";
    words.dataset.truncate = "";
    words.textContent = "a-sender-name-too-long-to-stand-beside-anything-in-its-column";
    const style = getComputedStyle(words);
    assert.deepEqual(
      [style.overflow, style.textOverflow, style.whiteSpace, style.minWidth],
      ["hidden", "ellipsis", "nowrap", "0px"],
    );
  });
}
