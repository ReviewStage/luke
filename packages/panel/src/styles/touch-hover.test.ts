// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_META,
  List,
  ListRow,
  type ListRowMeta,
  NAV_COUNT_SHOWN,
  NavItem,
} from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt, shown } from "../testing/container-width.js";

/**
 * touch-hover.test.ts -- on a screen with no hover, no `:hover` rule the
 * panel lays shows or hides anything, so a tap is never spent as a hover.
 *
 * iOS Safari plays a tap first as a hover, and where that hover changes
 * what is shown, a control coming in from `display: none`, `visibility:
 * hidden` or no opacity, it fires no click: the tap is spent showing the
 * control and only a second tap presses. So a reveal that is the pointer's
 * alone is written under `@media (hover: hover)`, and on a touch screen
 * the control stands at rest or not at all. The sheets are laid for a
 * touch screen (`testing/container-width.ts`), and every style rule still
 * standing whose selector reads the pointer's hover, `:hover` or
 * `:not(:hover)`, is read for a property that shows or hides, in any
 * media, support, or layer block around it. Then the rows a phone's
 * sidebar is made of, a task's, an agent's and a place's, are drawn
 * hovered, read off a mark that stands in for `:hover`, which jsdom never
 * matches: on a touch screen each draws as at rest, and with a mouse its
 * acts and its chord still come in.
 */

/** What a rule sets that shows or hides what it matches, or lets a press reach it. */
const SHOWING = [
  "display",
  "visibility",
  "opacity",
  "content",
  "pointer-events",
  "max-height",
  "max-width",
  "width",
  "height",
] as const;

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
});

/** Every style rule in `rules`, those in a grouping block among them, each as it is written. */
function styleRules(rules: CSSRuleList): CSSStyleRule[] {
  return [...rules].flatMap((rule) => {
    if (rule instanceof CSSStyleRule) return [rule];
    return "cssRules" in rule && rule.cssRules instanceof CSSRuleList
      ? styleRules(rule.cssRules)
      : [];
  });
}

test("on a touch screen no rule a hover matches shows or hides anything, so a first tap presses rather than hovers", () => {
  laid = layContainersAt({}, { touch: true });
  const sheet = laid.sheet ?? assert.fail("the laid sheets");
  const hovered = styleRules(sheet.cssRules).filter((rule) => rule.selectorText.includes(":hover"));
  assert.ok(hovered.length > 0, "the sheets hover something, a row's fill");

  const revealing = hovered.flatMap((rule) => {
    const set = SHOWING.filter((property) => rule.style.getPropertyValue(property) !== "");
    return set.length === 0
      ? []
      : [`${rule.selectorText.replace(/\s+/g, " ")} { ${set.join(", ")} }`];
  });

  assert.deepEqual(revealing, []);
});

/** Lays the sheets for a touch screen or a mouse, a hover read off a `data-hovered` mark, since jsdom matches no `:hover`. */
function layHoverable(touch: boolean): void {
  laid = layContainersAt({}, { touch });
  laid.textContent = (laid.textContent ?? "").replaceAll(":hover", "[data-hovered]");
}

/** Hovers `element` as a pointer resting on it does: it and every box around it. */
function hover(element: Element): void {
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    at.setAttribute("data-hovered", "");
  }
}

/** Draws `node` into the document, answering its container. */
function draw(node: ReturnType<typeof createElement>): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

/** A row offering Archive to the row in hand, not the open one, its acts and its metadata, hovered. */
function hoveredRow(metaAt: ListRowMeta) {
  const container = draw(
    createElement(
      List,
      null,
      createElement(ListRow, {
        title: "Fix token refresh on mobile Safari",
        meta: "21m",
        metaAt,
        onPress: () => undefined,
        actionsAt: LIST_ROW_ACTIONS.HOVER,
        actions: createElement(IconButton, { icon: "×", label: "Archive" }),
      }),
    ),
  );
  const part = (selector: string) => container.querySelector(selector) ?? assert.fail(selector);
  hover(part(".luke-list-row"));
  return { actions: part(".luke-list-row-actions"), meta: part(".luke-list-row-meta") };
}

/** Whether a row's acts are drawn to be seen and pressed. */
function offered(actions: Element): boolean {
  const style = getComputedStyle(actions);
  return style.opacity === "1" && style.pointerEvents !== "none";
}

/** Whether a row's metadata is drawn to be read. */
function readable(meta: Element): boolean {
  const style = getComputedStyle(meta);
  return style.display !== "none" && style.visibility !== "hidden";
}

for (const metaAt of [LIST_ROW_META.MIDDLE, LIST_ROW_META.TITLE]) {
  test(`on a touch screen a list row a tap leaves hovered, its metadata at its ${metaAt}, draws as at rest, so the tap opens it`, () => {
    layHoverable(true);
    const row = hoveredRow(metaAt);

    assert.ok(!offered(row.actions));
    assert.ok(readable(row.meta));
  });

  test(`with a mouse a hovered list row, its metadata at its ${metaAt}, still brings its acts in the metadata's place`, () => {
    layHoverable(false);
    const row = hoveredRow(metaAt);

    assert.ok(offered(row.actions));
    assert.ok(!readable(row.meta));
  });
}

/** A sidebar task row's time, in the row's markup, its row hovered. */
function hoveredTaskTime(): Element {
  const container = draw(
    createElement(
      "li",
      { className: "sidebar-task-item" },
      createElement(
        "div",
        { className: "sidebar-task" },
        createElement("span", { className: "sidebar-task-time" }, "21m"),
      ),
    ),
  );
  const time = container.querySelector(".sidebar-task-time") ?? assert.fail("the time");
  hover(time);
  return time;
}

test("on a touch screen a sidebar task row a tap leaves hovered keeps its time", () => {
  layHoverable(true);
  assert.ok(readable(hoveredTaskTime()));
});

test("with a mouse a hovered sidebar task row gives its time's place to Pin and Archive", () => {
  layHoverable(false);
  assert.ok(!readable(hoveredTaskTime()));
});

/** A place's row whose count stands only under the pointer, and its chord, hovered. */
function hoveredPlace() {
  const container = draw(
    createElement(NavItem, {
      count: { value: 3, shown: NAV_COUNT_SHOWN.ON_HOVER },
      shortcut: "⌘1",
      onClick: () => undefined,
      children: "Inbox",
    }),
  );
  const part = (selector: string) => container.querySelector(selector) ?? assert.fail(selector);
  hover(part(".luke-nav-item"));
  return { count: part(".luke-nav-item-count"), chord: part(".luke-nav-item-shortcut") };
}

test("on a touch screen a place's row a tap leaves hovered brings neither its count nor its chord", () => {
  layHoverable(true);
  const place = hoveredPlace();

  assert.equal(getComputedStyle(place.count).opacity, "0");
  assert.ok(!shown(place.chord) || getComputedStyle(place.chord).opacity === "0");
});

test("with a mouse a hovered place's row brings its chord", () => {
  layHoverable(false);
  const place = hoveredPlace();

  assert.ok(shown(place.chord));
  assert.equal(getComputedStyle(place.chord).opacity, "1");
});
