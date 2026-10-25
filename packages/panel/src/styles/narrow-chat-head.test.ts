// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * narrow-chat-head.test.ts -- a Chat place's bar in the window starts past
 * the folded sidebar's title-bar buttons only where it is the window's first
 * column, standing alone; beside its rail it keeps the bar's own inset.
 * jsdom lays nothing out, so the sheets are laid (`testing/container-width.ts`)
 * and the room the window's bar (`chat-pane.tsx`'s `PlaceHead`, a `Toolbar`)
 * stands in is read for where it tells the bar to start.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  delete document.documentElement.dataset.lukeRoom;
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/**
 * Where a place's bar starts, in a shell whose sidebar is folded, where the chat stands as one column or beside its rail: the bar is read through the title-bar buttons' clearance or not.
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
  // Note that the bar reads its start off the room it stands in (`toolbar.css`), which jsdom inherits no further once a room clears it.
  return getComputedStyle(stream).getPropertyValue("--luke-toolbar-start-at");
}

test("a place standing alone under a folded sidebar starts its bar past the title-bar buttons, and beside its rail keeps the bar's own inset", () => {
  assert.match(foldedBarStart(true), /sidebar-toggle-clearance/u);
  document.body.replaceChildren();
  assert.doesNotMatch(foldedBarStart(false), /sidebar-toggle-clearance/u);
});
