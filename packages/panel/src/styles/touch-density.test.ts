// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BUTTON_SIZE, IconButton } from "@luke/ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * touch-density.test.ts -- on a coarse pointer the panel is drawn at the
 * site's full density and every small target takes a finger's press, while
 * a mouse keeps what it had. A compact web root (the web app's) takes the
 * site's full roles on a touch screen, 44px controls and 16px words, so a
 * field never makes iOS zoom, and keeps its compact ones with a mouse; the
 * desktop's roles stand as they are. The tab's ×, a sidebar row's mark, a
 * section's ⋯, a toolbar's glyph button, and a resize edge each take a
 * press at least 44px across around what they draw on a touch screen, and
 * take none past their own box with a mouse. jsdom answers no media query,
 * no `var()`, and no pseudo-element, so the sheets are laid for the device
 * (`testing/container-width.ts`) and a `::before` hit area is read from the
 * rules laid that match the element, its lengths resolved from the root.
 */

/** The least a finger's press is taken across, in pixels. */
const FINGER = 44;

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-density", "data-luke-theme"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** Lays the sheets for a touch screen or a mouse under a root wearing the surface given. */
function layFor(touch: boolean, surface: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(surface)) {
    document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({}, { touch });
}

/** A role as the root resolves it. */
function role(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Every style rule laid in the document, those inside a block included. */
function styleRules(): CSSStyleRule[] {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSStyleRule) return [rule];
      return rule instanceof CSSGroupingRule ? walk(rule.cssRules) : [];
    });
  return [...document.styleSheets].flatMap((sheet) => walk(sheet.cssRules));
}

/** The declarations of the `::before` rules that match `element`, the later rule's winning. */
function before(element: Element): Map<string, string> {
  const declared = new Map<string, string>();
  for (const rule of styleRules()) {
    const matching = rule.selectorText
      .split(",")
      .map((part) => part.trim())
      .some((part) => part.endsWith("::before") && element.matches(part.slice(0, -8)));
    if (!matching) continue;
    for (const name of [...rule.style]) declared.set(name, rule.style.getPropertyValue(name));
  }
  return declared;
}

/** The least a length spans in pixels, its `var()`s read off the root and a `max()` its largest pixel term; nothing for one that names none. */
function leastPixels(length: string | undefined): number | undefined {
  if (length === undefined) return undefined;
  const resolved = length.replace(/var\((--[\w-]+)\)/g, (_, name: string) => role(name));
  const pixels = [...resolved.matchAll(/(\d+(?:\.\d+)?)px/g)].map(([, value]) => Number(value));
  return pixels.length === 0 ? undefined : Math.max(...pixels);
}

/** Whether `element` takes a press a finger's width across around what it draws: a box of its own drawn past it, so wide, and as tall unless it runs the element's height. */
function takesFinger(element: Element): boolean {
  const area = before(element);
  if (area.get("content") === undefined || area.get("position") !== "absolute") return false;
  const wide = (leastPixels(area.get("width")) ?? 0) >= FINGER;
  const tall =
    (leastPixels(area.get("height")) ?? 0) >= FINGER ||
    (area.get("top") === "0px" && area.get("bottom") === "0px") ||
    (area.get("top") === "0" && area.get("bottom") === "0");
  return wide && tall;
}

/** Draws `node` into a container wearing `className`, answering the container. */
function drawn(node: ReactNode, className = ""): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  container.className = className;
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

/** The button drawn in `container`. */
function buttonIn(container: Element): HTMLButtonElement {
  const button = container.querySelector("button");
  assert.ok(button !== null, "a button is drawn");
  return button;
}

/** The panel's small targets as their components draw them, each by what the developer calls it. */
function smallTargets(): ReadonlyMap<string, Element> {
  const compact = (label: string) =>
    createElement(IconButton, { icon: "·", label, size: BUTTON_SIZE.COMPACT });
  const tab = document.body.appendChild(document.createElement("div"));
  tab.className = "tab";
  tab.dataset.marked = "false";
  const close = drawn(compact("Close Plan"), "tab-close");
  tab.append(close);
  const edge = document.body.appendChild(document.createElement("div"));
  edge.className = "sidebar-resize";
  const sideEdge = document.body.appendChild(document.createElement("div"));
  sideEdge.className = "side-panel-resize";
  return new Map<string, Element>([
    ["the tab's ×", buttonIn(close)],
    ["a sidebar row's mark", buttonIn(drawn(compact("Pin"), "sidebar-task"))],
    [
      "a section's ⋯",
      buttonIn(drawn(createElement(IconButton, { icon: "⋯", label: "More" }), "plan-unit-more")),
    ],
    [
      "a toolbar's glyph button",
      buttonIn(
        drawn(
          createElement(IconButton, { icon: "+", label: "New tab" }),
          "desktop-toolbar-actions",
        ),
      ),
    ],
    ["the sidebar's resize edge", edge],
    ["the side panel's resize edge", sideEdge],
  ]);
}

test("a compact web root takes the site's full density on a touch screen: 44px controls and menu rows, 16px words", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  assert.equal(role("--luke-control-height"), "44px");
  assert.equal(role("--luke-menu-row-height"), "44px");
  assert.equal(role("--luke-type-body-size"), "16px");
});

test("a compact web root keeps its compact density with a mouse", () => {
  layFor(false, { "data-luke-profile": "web", "data-luke-density": "compact" });
  assert.equal(role("--luke-control-height"), "32px");
  assert.equal(role("--luke-menu-row-height"), "32px");
  assert.equal(role("--luke-type-body-size"), "14px");
});

test("the desktop with a mouse keeps its own density", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  assert.equal(role("--luke-control-height"), "30px");
  assert.equal(role("--luke-menu-row-height"), "32px");
  assert.equal(role("--luke-type-body-size"), "13px");
});

test("on a touch screen each small target takes a press a finger's width across", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  for (const [name, target] of smallTargets()) {
    assert.equal(takesFinger(target), true, `${name} takes a finger's press`);
  }
});

test("with a mouse no small target takes a press past what it draws", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  for (const [name, target] of smallTargets()) {
    assert.equal(before(target).get("content"), undefined, `${name} draws no hit area`);
  }
});
