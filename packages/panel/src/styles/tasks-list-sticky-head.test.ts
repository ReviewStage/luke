// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  COLLECTION_STATE,
  CollectionPage,
  GROUP_HEAD,
  GroupHeader,
  PAGE_FRAME,
  PAGE_WIDTH,
} from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * tasks-list-sticky-head.test.ts -- a Tasks List group's head sticks flush
 * under the window's toolbar while its rows scroll beneath it, with no rule
 * under its band. A sticky box sticks inside its scroller's padding, so a
 * gap the page opens under the toolbar on its scroller would leave the rows
 * showing above a stuck head; the gap is the content's. jsdom lays nothing
 * out, so the sheets are laid (`testing/container-width.ts`), the page is
 * `CollectionPage` itself, and the group inside it is built in the markup
 * `tasks-list.tsx` draws, its head drawn by `GroupHeader` itself.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let laid: HTMLStyleElement | undefined;
const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** The `border-bottom` the rules matching `element` declare, the later rule's winning; jsdom computes no shorthand drawn in a token. */
function declaredBorderBottom(element: Element): string {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSStyleRule) return [rule];
      return rule instanceof CSSGroupingRule ? walk(rule.cssRules) : [];
    });
  let border = "";
  for (const rule of [...document.styleSheets].flatMap((sheet) => walk(sheet.cssRules))) {
    const declared = rule.style.getPropertyValue("border-bottom");
    if (declared !== "" && element.matches(rule.selectorText)) border = declared;
  }
  return border;
}

/** The one element of the class given under `parent`. */
function only(parent: ParentNode, className: string): HTMLElement {
  const found = parent.querySelector<HTMLElement>(`.${className}`);
  assert.ok(found, `the page draws a ${className}`);
  return found;
}

/** The List under the toolbar with no filters, answering its scroller, its content, and a group's head. */
function list() {
  laid = layContainersAt({});
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        CollectionPage,
        {
          frame: PAGE_FRAME.TOOLBAR,
          width: PAGE_WIDTH.FULL,
          label: "Tasks",
          toolbar: createElement("header", { className: "luke-toolbar" }),
          state: COLLECTION_STATE.READY,
          loadingLabel: "Loading tasks",
        },
        createElement(
          "div",
          { className: "tasks-list" },
          createElement(
            "section",
            { className: "tasks-list-group" },
            createElement(GroupHeader, {
              label: "Doing",
              head: GROUP_HEAD.STICKS,
              children: "Fix the sign-in loop",
            }),
          ),
        ),
      ),
    ),
  );
  return {
    scroll: only(host, "luke-collection-page-scroll"),
    content: only(host, "luke-collection-page-content"),
    head: only(host, "luke-group-header-head"),
  };
}

test("a group's head sticks at the very top of the scroller, the gap under the toolbar opening inside the content", () => {
  const { scroll, content, head } = list();
  assert.equal(getComputedStyle(head).position, "sticky");
  assert.equal(getComputedStyle(head).top, "0px");
  assert.equal(Number.parseFloat(getComputedStyle(scroll).paddingTop), 0);
  assert.equal(getComputedStyle(content).paddingTop, "var(--luke-section-gap)");
});

test("a group's head draws no rule under its band", () => {
  const { head } = list();
  assert.equal(declaredBorderBottom(head), "");
});
