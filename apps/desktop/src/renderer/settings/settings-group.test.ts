// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SettingsGroup } from "./settings-group";

/**
 * A group as a reader meets it: a named group is a region its heading names,
 * so moving by landmark says what the rows are for before reaching them,
 * and a nameless group adds no heading for the page's title to repeat.
 */

const mounted: Root[] = [];

function mount(title?: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const row = createElement("div", { className: "settings-row" }, "Microphone");
  const props = title === undefined ? { children: row } : { title, children: row };
  act(() => root.render(createElement(SettingsGroup, props)));
  return container;
}

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("a named group is a region its heading names, holding its rows", () => {
  const group = mount("Permissions").querySelector("section") ?? assert.fail("no group");
  const heading = document.getElementById(group.getAttribute("aria-labelledby") ?? "");
  assert.equal(heading?.textContent, "Permissions");
  assert.match(group.textContent ?? "", /Microphone/u);
});

test("a nameless group draws no heading and names no region", () => {
  const group = mount().querySelector("section") ?? assert.fail("no group");
  assert.equal(group.querySelector("h2"), null);
  assert.equal(group.getAttribute("aria-labelledby"), null);
});
