// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { NAV_CURRENT, NavItem } from "../nav-item/nav-item.js";
import { TABS_GROUND, Tab, Tabs } from "./tabs.js";

/**
 * tabs-frame.test.ts -- a strip standing on the window's frame lifts its
 * chosen tab as the sidebar lifts the place standing open, in the sheet's
 * ground by a hairline and a soft shadow, so the two choose alike; a strip
 * on a column's ground keeps its fill. jsdom drops what a cascade layer
 * holds, so each look is read from the sheets' text: the last rule reaching
 * the element that declares the property, every rule here being of one
 * specificity's step over the last. Synthetic throughout.
 */

const ignore = () => undefined;

/** Every rule of the two sheets, its selector and declarations, in order. */
const RULES = ["./tabs.css", "../nav-item/nav-item.css"].flatMap((name) => {
  const text = readFileSync(new URL(name, import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim(),
    body,
  }));
});

/** What the last rule reaching `element` declares for `property`, its spaces collapsed, or none. */
function declared(element: Element, property: string): string | undefined {
  const values = RULES.flatMap(({ selector, body }) => {
    let reaches = false;
    try {
      reaches = element.matches(selector);
    } catch {}
    const value = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`).exec(body)?.[1];
    return reaches && value !== undefined ? [value.replace(/\s+/g, " ").trim()] : [];
  });
  return values.at(-1);
}

afterEach(() => {
  document.body.replaceChildren();
});

/** The chosen tab of a strip of two on `ground`. */
function chosenTab(ground: (typeof TABS_GROUND)[keyof typeof TABS_GROUND]): Element {
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = renderToStaticMarkup(
    createElement(Tabs, {
      label: "Task",
      ground,
      children: ["Plan", "Agent"].map((label, at) =>
        createElement(Tab, {
          key: label,
          icon: createElement("svg"),
          label,
          selected: at === 0,
          onSelect: ignore,
        }),
      ),
    }),
  );
  const tab = host.querySelector('.luke-tab[data-selected="true"]');
  assert.ok(tab !== null);
  return tab;
}

/** The place standing open in the sidebar. */
function currentPlace(): Element {
  const host = document.body.appendChild(document.createElement("div"));
  host.innerHTML = renderToStaticMarkup(
    createElement(NavItem, { current: NAV_CURRENT.PAGE, children: "Inbox" }),
  );
  const place = host.querySelector(".luke-nav-item");
  assert.ok(place !== null);
  return place;
}

test("on the frame the chosen tab is lifted as the sidebar's place standing open is", () => {
  const tab = chosenTab(TABS_GROUND.FRAME);
  const place = currentPlace();
  assert.equal(declared(tab, "background"), "var(--luke-color-ground)");
  assert.equal(declared(tab, "background"), declared(place, "background"));
  assert.ok(declared(tab, "box-shadow") !== undefined);
  assert.equal(declared(tab, "box-shadow"), declared(place, "box-shadow"));
});

test("on a column's ground the chosen tab keeps its fill and casts no shadow", () => {
  const tab = chosenTab(TABS_GROUND.GROUND);
  assert.equal(declared(tab, "box-shadow"), undefined);
  assert.match(declared(tab, "background") ?? "", /--luke-color-fill-strong/);
});
