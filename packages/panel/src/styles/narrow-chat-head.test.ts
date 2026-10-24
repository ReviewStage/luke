// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * narrow-chat-head.test.ts -- a Chat place's head on a phone keeps a topic's
 * menu. In a narrow room the head leads with the way back and gives its
 * name the room, so what is said beside the name gives way; the topic's
 * menu at its end does not, since it is the only way to edit, archive, or
 * bring back a topic. jsdom lays nothing out, so the sheets are laid for a
 * touch screen (`testing/container-width.ts`) and the head is built in the
 * markup `chat-pane.tsx`'s `PlaceHead` draws (a `PaneBar`).
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  delete document.documentElement.dataset.lukeRoom;
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A topic's head in a shell of the room given: the way back, its name, its purpose, and its menu. */
function topicHead(room: string) {
  laid = layContainersAt({}, { touch: room === "narrow" });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  document.documentElement.dataset.lukeRoom = room;
  const section = shell.appendChild(document.createElement("section"));
  section.className = "chat-stream";
  const head = section.appendChild(document.createElement("header"));
  head.className = "luke-pane-bar";
  const lead = head.appendChild(document.createElement("div"));
  lead.className = "luke-pane-bar-lead";
  const mark = lead.appendChild(document.createElement("span"));
  mark.className = "luke-pane-bar-mark";
  const back = mark.appendChild(document.createElement("button"));
  back.setAttribute("aria-label", "Back to Chat");
  const title = lead.appendChild(document.createElement("span"));
  title.className = "luke-pane-bar-title";
  title.textContent = "#design";
  const meta = lead.appendChild(document.createElement("span"));
  meta.className = "luke-pane-bar-detail";
  meta.textContent = "Where the design is talked through";
  const actions = head.appendChild(document.createElement("div"));
  actions.className = "luke-pane-bar-actions";
  const menu = actions.appendChild(document.createElement("button"));
  menu.setAttribute("aria-label", "#design actions");
  return { back, meta, menu };
}

test("in a narrow room a topic's head keeps the way back and its menu, and its purpose gives way", () => {
  const { back, meta, menu } = topicHead("narrow");
  assert.ok(shown(back), "the way back");
  assert.ok(shown(menu), "the topic's menu");
  assert.ok(!shown(meta), "the purpose gives way");
});

test("in a wide room a topic's head shows its purpose and its menu", () => {
  const { meta, menu } = topicHead("wide");
  assert.ok(shown(meta), "the purpose");
  assert.ok(shown(menu), "the topic's menu");
});

/**
 * The padding a place's bar starts with, in a shell whose sidebar is folded, where the chat stands as one column or beside its rail: the bar is read through the title-bar buttons' clearance or not.
 */
function foldedBarStart(single: boolean): string {
  laid = layContainersAt({}, { touch: false });
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = "wide";
  document.documentElement.dataset.lukeRoom = "wide";
  shell.dataset.sidebarCollapsed = "true";
  const main = shell.appendChild(document.createElement("main"));
  main.className = "desktop-main";
  const find = main.appendChild(document.createElement("div"));
  find.className = "page-find";
  const view = find.appendChild(document.createElement("div"));
  view.className = "chat-view";
  view.dataset.single = String(single);
  const stream = view.appendChild(document.createElement("section"));
  stream.className = "chat-stream";
  const bar = stream.appendChild(document.createElement("header"));
  bar.className = "luke-pane-bar";
  return getComputedStyle(bar).paddingLeft;
}

test("a place standing alone under a folded sidebar starts its bar past the title-bar buttons, and beside its rail keeps the bar's own inset", () => {
  assert.match(foldedBarStart(true), /sidebar-toggle-clearance/u);
  document.body.replaceChildren();
  assert.doesNotMatch(foldedBarStart(false), /sidebar-toggle-clearance/u);
});
