// @vitest-environment jsdom

import assert from "node:assert/strict";
import { GROUP_ACTIONS, type GroupActions, GroupHeader } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * sidebar-status-filter.test.ts -- the Tasks head's buttons, its status filter
 * among them, stand at rest with a mouse, though the head is neither hovered
 * nor holding focus, where a group's other actions wait for the pointer.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let laid: HTMLStyleElement | undefined;
const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** `element`'s opacity as a browser computes it, a number: jsdom echoes a percentage as it was declared, as Tailwind's `opacity-100` declares `100%`. */
function opacityOf(element: Element): string {
  const declared = getComputedStyle(element).opacity;
  return declared.endsWith("%") ? String(Number.parseFloat(declared) / 100) : declared;
}

/** A group head's actions, drawn as `GroupHeader` draws them, with a status filter in them, neither hovered nor holding focus, standing as `shown` says. */
function actions(shown: GroupActions): HTMLElement {
  laid = layContainersAt({}, { touch: false });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const filter = createElement(
    "span",
    { className: "sidebar-status-filter" },
    createElement("button", { type: "button" }, "Status"),
  );
  act(() =>
    root.render(
      createElement(GroupHeader, { label: "Tasks", actions: filter, actionsShown: shown }),
    ),
  );
  return (
    container.querySelector<HTMLElement>(".luke-group-header-actions") ?? assert.fail("actions")
  );
}

test("the Tasks head's status filter stands while the sidebar is neither hovered nor focused", () => {
  const stand = actions(GROUP_ACTIONS.AT_REST);
  assert.equal(opacityOf(stand), "1");
  const filter = stand.querySelector(".sidebar-status-filter") ?? assert.fail("a status filter");
  assert.notEqual(getComputedStyle(filter).display, "none");
});

test("a group's other actions wait for the pointer", () => {
  assert.equal(opacityOf(actions(GROUP_ACTIONS.ON_HOVER)), "0");
});
