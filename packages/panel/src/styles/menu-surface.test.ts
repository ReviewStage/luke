// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  MENU_SURFACE_FLOW,
  MENU_SURFACE_INSET,
  MenuSurface,
  type MenuSurfaceFlow,
  type MenuSurfaceInset,
} from "@luke/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * menu-surface.test.ts -- every list the window hangs and keys itself
 * stands on `@luke/ui`'s menu surface, as a menu does: its ground, edge,
 * corner, and shadow are the menu's whatever the owner's class places it.
 * A searchable menu, the `@` and `/` lists, and a submenu run their content
 * edge to edge; the one press over selected words and the comment bubble
 * keep the menu's inset; a crumb's tree stays hidden until it is placed; and
 * a message's actions, a picture's tools, and the Comment press over selected
 * code float on the surface as a toolbar.
 * jsdom lays nothing out, so the sheets are laid as every app lays them
 * (`testing/container-width.ts`) and the surface is drawn as its owners draw
 * it. jsdom resolves no `var()` in a shorthand, so what the rules matching
 * the surface declare is read, the later rule's winning, as they are laid in
 * the cascade's order: the longhands the theme's utilities declare, and the
 * shadow the shadow utility hands its `box-shadow` (`--tw-shadow`).
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** Whether `element` matches `selector`; a selector jsdom cannot match, such as a `::highlight`, names no surface. */
function matching(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** What the rules laid that match `element` declare for `property`, the later rule's winning. */
function declared(element: Element, property: string): string | undefined {
  let value: string | undefined;
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !matching(element, rule.selectorText)) continue;
      const said = rule.style.getPropertyValue(property);
      if (said !== "") value = said;
    }
  }
  return value;
}

/** A surface drawn with the owner's class, inset, and flow under the laid sheets: what it declares for each property. */
function surface(
  className: string,
  inset?: MenuSurfaceInset,
  placed?: boolean,
  flow?: MenuSurfaceFlow,
): (property: string) => string | undefined {
  laid?.remove();
  document.body.replaceChildren();
  laid = layContainersAt({});
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = renderToStaticMarkup(
    createElement(MenuSurface, { className, inset, placed, flow }, "Row"),
  );
  const drawn = host.firstElementChild;
  assert.ok(drawn instanceof HTMLElement, "the surface is drawn");
  return (property) => declared(drawn, property);
}

test("a list hung by its owner wears the menu's own ground, edge, corner, and shadow", () => {
  for (const owner of [
    "searchable-menu",
    "searchable-menu mention-menu",
    "searchable-menu skill-menu",
    "task-compose-submenu",
    "file-crumb-tree",
    "find-bar",
  ]) {
    const says = surface(owner);
    assert.equal(says("background-color"), "var(--luke-color-overlay)", owner);
    assert.equal(says("border-radius"), "var(--luke-menu-radius)", owner);
    assert.equal(says("--tw-shadow"), "var(--luke-menu-shadow)", owner);
    assert.match(says("animation") ?? "", /^luke-menu-arrive .*luke-menu-drop /s, owner);
  }
});

test("a searchable list runs edge to edge, and a press offered on the surface keeps the menu's inset", () => {
  for (const owner of ["searchable-menu", "searchable-menu mention-menu", "task-compose-submenu"]) {
    assert.match(surface(owner, MENU_SURFACE_INSET.NONE)("padding") ?? "", /^0(px)?$/, owner);
  }
  for (const owner of ["file-crumb-tree"]) {
    assert.equal(surface(owner)("padding"), "var(--luke-menu-inset)", owner);
  }
});

test("a crumb's tree stays hidden until it is measured into place", () => {
  assert.equal(surface("file-crumb-tree", undefined, false)("visibility"), "hidden");
  assert.equal(surface("file-crumb-tree", undefined, true)("visibility"), undefined);
});

test("a find bar lays its field and buttons side by side on the surface, a hair apart", () => {
  const says = surface("find-bar", undefined, undefined, MENU_SURFACE_FLOW.ROW);
  assert.equal(says("flex-direction"), "row");
  assert.equal(says("align-items"), "center");
  assert.equal(says("gap"), "var(--luke-space-2)");
  assert.equal(says("padding"), "var(--luke-menu-inset)");
});

test("a toolbar floats on the menu's ground, edge, and shadow, a hair round its buttons, shown by its owner rather than arriving", () => {
  for (const owner of [
    "luke-message-actions",
    "picture-tools",
    "diff-list-offer",
    "reply-to-selection",
    "comment-bubble",
  ]) {
    const says = surface(owner, undefined, undefined, MENU_SURFACE_FLOW.TOOLBAR);
    assert.equal(says("background-color"), "var(--luke-color-overlay)", owner);
    assert.equal(says("border-width"), "1px", owner);
    assert.equal(says("border-color"), "var(--luke-color-border-strong)", owner);
    assert.equal(says("--tw-shadow"), "var(--luke-menu-shadow)", owner);
    assert.equal(says("flex-direction"), "row", owner);
    assert.equal(says("padding"), "var(--luke-space-2)", owner);
    assert.equal(says("animation"), "none", owner);
  }
});
