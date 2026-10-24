// @vitest-environment jsdom

import assert from "node:assert/strict";
import { IconButton, LIST_ROW_ACTIONS, LIST_ROW_META, List, ListRow } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * list-row-hover-room.test.ts -- where there is a hover, a row whose acts
 * come in on hover, as an Inbox item's or a sidebar task's, keeps no room
 * for them at rest, so its title runs to its metadata: its acts and its ⋯
 * stand out of the row's flow until the row is in hand, and take their room
 * once it is, its title cut anew before them. On a screen with no hover,
 * where no row is ever in hand, the acts keep their room as before. jsdom
 * lays nothing out and matches no `:hover`, so the sheets are laid for a
 * mouse or a touch screen (`testing/container-width.ts`), a hover is read
 * off a `data-hovered` mark standing in for it, and the position each part
 * is given is read.
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

/** A mail-style row with one act on hover and a ⋯, drawn for a mouse or a touch screen; answers its item, its acts, and its ⋯. */
function hoverRow(touch: boolean) {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({}, { touch });
  laid.textContent = (laid.textContent ?? "").replaceAll(":hover", "[data-hovered]");
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        List,
        null,
        createElement(ListRow, {
          title: "Sheet's top row: room for the lights",
          meta: "6m",
          metaAt: LIST_ROW_META.TITLE,
          actionsAt: LIST_ROW_ACTIONS.HOVER,
          actions: createElement(IconButton, { icon: "✓", label: "Mark read" }),
          menu: { thing: "Item", groups: [[{ label: "Copy link", onSelect: () => undefined }]] },
          onPress: () => undefined,
        }),
      ),
    ),
  );
  const part = (selector: string) => container.querySelector(selector) ?? assert.fail(selector);
  return {
    item: part(".luke-list-row"),
    acts: part(".luke-list-row-actions"),
    more: part(".luke-list-row-more"),
  };
}

test("with a mouse, a row's acts on hover and its ⋯ stand out of its flow at rest, so its title runs to its metadata", () => {
  const { acts, more } = hoverRow(false);

  assert.equal(getComputedStyle(acts).position, "absolute");
  assert.equal(getComputedStyle(more).position, "absolute");
});

test("with a mouse, the row in hand takes its acts' and its ⋯'s room, its title cut anew before them", () => {
  const { item, acts, more } = hoverRow(false);
  item.setAttribute("data-hovered", "");

  assert.notEqual(getComputedStyle(acts).position, "absolute");
  assert.notEqual(getComputedStyle(more).position, "absolute");
});

test("on a touch screen, where no row is in hand, a row's acts on hover keep their room", () => {
  const { acts } = hoverRow(true);

  assert.notEqual(getComputedStyle(acts).position, "absolute");
});
