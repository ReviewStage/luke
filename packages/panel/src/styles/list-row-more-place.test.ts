// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_META,
  List,
  ListRow,
  type ListRowActions,
} from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * list-row-more-place.test.ts -- every row that offers a menu keeps its ⋯ in
 * a track of its own, last, whatever its acts are: a row whose acts come in
 * on hover, as an Inbox item's or a sidebar task's, stands the acts in its
 * end's place and the ⋯ beside it, as a row with a menu and no acts, a row
 * whose acts always stand, and every row on a screen with no hover do, so
 * the metadata of every row in a list ends the same distance from the row's
 * end. jsdom lays
 * nothing out, so the sheets are laid for a mouse or a touch screen
 * (`testing/container-width.ts`) and the track each part is given is read.
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

/** A mail-style row with a ⋯ and one act, on hover or always, or with a ⋯ alone; answers the tracks its end, its acts, and its ⋯ are given. */
function tracks(actionsAt: ListRowActions, touch: boolean, acted = true) {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({}, { touch });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        List,
        null,
        createElement(ListRow, {
          title: "Retry the webhook?",
          description: "Choice · 2 options",
          meta: "2h",
          metaAt: LIST_ROW_META.TITLE,
          actionsAt,
          actions: acted ? createElement(IconButton, { icon: "✓", label: "Mark read" }) : undefined,
          menu: { thing: "Item", groups: [[{ label: "Copy link", onSelect: () => undefined }]] },
          onPress: () => undefined,
        }),
      ),
    ),
  );
  const column = (selector: string) =>
    getComputedStyle(container.querySelector(selector) ?? assert.fail(selector)).gridColumn;
  return {
    end: column(".luke-list-row-end"),
    acts: acted ? column(".luke-list-row-actions") : undefined,
    more: column(".luke-list-row-more"),
  };
}

test("with a mouse, a row whose acts come in on hover keeps its ⋯ in its own track, beside the end its acts stand in", () => {
  const { end, acts, more } = tracks(LIST_ROW_ACTIONS.HOVER, false);

  assert.equal(acts, end, "the acts stand in the end's place");
  assert.equal(more, "more", "the ⋯ keeps its track, as a row with no acts does");
});

test("with a mouse, a row that offers a menu and no acts keeps its ⋯ in its own track, beside the end nothing steps in for", () => {
  const { end, more } = tracks(LIST_ROW_ACTIONS.HOVER, false, false);

  assert.notEqual(more, end);
  assert.equal(more, "more");
});

test("a row whose acts always stand keeps its ⋯ in its own track beside them", () => {
  const { acts, more } = tracks(LIST_ROW_ACTIONS.ALWAYS, false);

  assert.equal(acts, "acts");
  assert.equal(more, "more");
});

test("on a touch screen, where the ⋯ is always shown, a row whose acts come in on hover keeps its ⋯ in its own track", () => {
  const { end, more } = tracks(LIST_ROW_ACTIONS.HOVER, true);

  assert.notEqual(more, end);
  assert.equal(more, "more");
});
