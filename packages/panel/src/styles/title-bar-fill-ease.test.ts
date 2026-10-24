// @vitest-environment jsdom

import assert from "node:assert/strict";
import { IconButton } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * title-bar-fill-ease.test.ts -- a title-bar button under the pointer eases
 * its fill in with the opaque ground under it, so it never flashes the
 * fill's light over the frosted bar before the ground arrives. The fill is
 * drawn as a gradient over `--luke-button-ground`, which no transition
 * reaches, so it eases only as a registered colour the button's transition
 * lists. The sheets are laid (`testing/container-width.ts`), the sidebar's
 * toggle is drawn in the title bar, and what its transition eases and how
 * its fill is registered are read. jsdom drops an `@property` rule, so the
 * registration is read from the laid sheets' text.
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

/** The sidebar's toggle, drawn in the desktop's title bar over the open sidebar. */
function titleBarToggle(): HTMLButtonElement {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.sidebarCollapsed = "false";
  const controls = shell.appendChild(document.createElement("div"));
  controls.className = "title-bar-controls";
  const root = createRoot(controls);
  roots.push(root);
  act(() =>
    root.render(
      createElement(IconButton, { icon: "▯", label: "Hide sidebar", onClick: () => undefined }),
    ),
  );
  const button = controls.querySelector("button");
  assert.ok(button instanceof HTMLButtonElement, "the toggle is a button");
  return button;
}

test("a title-bar button's fill eases in with its ground rather than landing over the bar", () => {
  const button = titleBarToggle();
  const eased = getComputedStyle(button)
    .transitionProperty.split(",")
    .map((each) => each.trim());
  const registered = /@property --luke-button-fill\s*\{([^}]*)\}/.exec(laid?.textContent ?? "");

  assert.notEqual(getComputedStyle(button).getPropertyValue("--luke-button-ground").trim(), "");
  assert.ok(eased.includes("background-color"), "the ground eases");
  assert.ok(eased.includes("--luke-button-fill"), "the fill eases beside it");
  assert.match(registered?.[1] ?? "", /syntax:\s*"<color>"/, "the fill is a colour that can ease");
});
