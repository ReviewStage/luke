// @vitest-environment jsdom

import assert from "node:assert/strict";
import { List, ListRow } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * sidebar-row-ground.test.ts -- a row that swipes, an Inbox item's, rests
 * in the sidebar as clear as the rows around it that do not, so the
 * window's frosted frame shows through it as it does through them, and
 * paints the sidebar's ground under its face only while the face is out
 * over its act's button, which the ground hides. The sheets are laid
 * (`testing/container-width.ts`), a swiping row is drawn in the sidebar,
 * and its face's ground is read in each of its swipe's states, which the
 * test sets on the row as a swipe would.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** A row that swipes to mark its item read, drawn in the desktop's sidebar; answers its item and its face. */
function swipingRow() {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({});
  const sidebar = document.body.appendChild(document.createElement("div"));
  sidebar.className = "desktop-sidebar";
  const root = createRoot(sidebar);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        List,
        null,
        createElement(ListRow, {
          title: "Board cards wrap and hover per part",
          onPress: () => undefined,
          swipe: { label: "Read", icon: "✓", onAct: () => undefined },
        }),
      ),
    ),
  );
  const item = sidebar.querySelector(".luke-list-row") ?? assert.fail("the row");
  const face = sidebar.querySelector(".luke-list-row-slide") ?? assert.fail("the row's face");
  return { item, face };
}

test("a row that swipes rests clear in the sidebar, painting no ground of its own", () => {
  const { item, face } = swipingRow();

  assert.equal(item.getAttribute("data-swipe"), "rest");
  assert.equal(getComputedStyle(face).backgroundColor, "rgba(0, 0, 0, 0)");
});

test("a row's face paints the sidebar's ground while it is out, so the act's button never shows through its words", () => {
  const { item, face } = swipingRow();

  for (const state of ["moving", "open"]) {
    item.setAttribute("data-swipe", state);
    assert.match(getComputedStyle(face).backgroundColor, /--luke-list-row-ground/, state);
  }
});
