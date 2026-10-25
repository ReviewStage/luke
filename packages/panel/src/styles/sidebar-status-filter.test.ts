// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * sidebar-status-filter.test.ts -- the Tasks head's buttons, its status filter
 * among them, stand at rest with a mouse, though the head is neither hovered
 * nor holding focus.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A group head's actions with a status filter in them, neither hovered nor holding focus, standing as `shown` says. */
function actions(shown: string): HTMLElement {
  laid = layContainersAt({}, { touch: false });
  const head = document.body.appendChild(document.createElement("div"));
  head.className = "luke-group-header-head";
  const stand = head.appendChild(document.createElement("span"));
  stand.className = "luke-group-header-actions";
  stand.dataset.shown = shown;
  const filter = stand.appendChild(document.createElement("span"));
  filter.className = "sidebar-status-filter";
  filter.appendChild(document.createElement("button"));
  return stand;
}

test("the Tasks head's status filter stands while the sidebar is neither hovered nor focused", () => {
  const stand = actions("at-rest");
  assert.equal(getComputedStyle(stand).opacity, "1");
  const filter = stand.querySelector(".sidebar-status-filter") ?? assert.fail("a status filter");
  assert.notEqual(getComputedStyle(filter).display, "none");
});
