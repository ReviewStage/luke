// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { GitHubMark } from "./account-marks";
import { type MenuRow, SearchableMenu } from "./searchable-menu";

/**
 * The menu's own behaviour, and the rules of desktop.css it stands on,
 * which jsdom does not load: the sheet is put in the document, so what a
 * rule sizes resolves and what no rule sizes answers `auto`, which is how a
 * glyph with no size of its own came to fill the composer.
 */

const css = readFileSync(join(import.meta.dirname, "styles", "desktop.css"), "utf8");

const ROWS: readonly MenuRow[] = [
  { id: "acme/relay", label: "acme/relay", icon: createElement(GitHubMark) },
  { id: "acme/billing", label: "acme/billing", icon: createElement(GitHubMark) },
  { id: "acme/site", label: "acme/site", icon: createElement(GitHubMark), terms: ["web"] },
];

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  const sheet = document.createElement("style");
  sheet.textContent = css;
  document.head.append(sheet);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

/** A menu over three repositories, every pick and close recorded. */
function mount(patch: Partial<Parameters<typeof SearchableMenu>[0]> = {}) {
  const picked: string[] = [];
  const closes: number[] = [];
  const container = document.createElement("div");
  container.className = "repository-chip";
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  let props: Parameters<typeof SearchableMenu>[0] = {
    id: "menu",
    label: "Repository",
    placeholder: "Search repositories",
    rows: ROWS,
    value: "acme/billing",
    noMatch: "No repositories match",
    onPick: (id) => picked.push(id),
    onClose: () => closes.push(1),
    onLeave: () => undefined,
    ...patch,
  };
  const render = () => act(() => root.render(createElement(SearchableMenu, props)));
  render();
  const find = <Element extends HTMLElement>(selector: string): Element => {
    const found = container.querySelector<Element>(selector);
    assert.ok(found, `the menu draws ${selector}`);
    return found;
  };
  return {
    container,
    picked,
    closes,
    find,
    rows: () => [...container.querySelectorAll<HTMLElement>("[role=option]")],
    highlighted: () => container.querySelector("[role=option][aria-selected='true']")?.textContent,
    restand: (next: Partial<Parameters<typeof SearchableMenu>[0]>) => {
      props = { ...props, ...next };
      render();
    },
  };
}

function press(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

test("every icon in the menu has a size from the sheet, so none fills the composer", () => {
  const menu = mount({ foot: createElement("button", { type: "button" }, "GitHub") });
  const icons = [...menu.container.querySelectorAll("svg")];
  assert.ok(icons.length >= ROWS.length + 2, "the search glyph, each row's mark, and the check");
  for (const icon of icons) {
    const { width, height } = getComputedStyle(icon);
    assert.match(width, /^\d+px$/u, `${icon.getAttribute("class")} has a width`);
    assert.equal(height, width, `${icon.getAttribute("class")} is square`);
  }
  assert.equal(getComputedStyle(menu.find(".plan-compose-menu-search svg")).width, "16px");
});

test("the list scrolls past a bounded height, inside itself, and the foot stands outside it", () => {
  const menu = mount({ foot: createElement("button", { type: "button" }, "GitHub") });
  const list = menu.find(".plan-compose-menu-list");
  const style = getComputedStyle(list);
  assert.match(style.maxHeight, /^\d+px$/u, "the list has a bound");
  assert.equal(style.overflowY, "auto");
  assert.equal(style.overscrollBehavior, "contain");
  const foot = menu.find(".plan-compose-menu-foot");
  assert.ok(!list.contains(foot), "the foot is pinned outside the list");
  assert.equal(foot.previousElementSibling, list);
  assert.equal(getComputedStyle(menu.find(".plan-compose-menu")).padding, "0px");
});

test("the plan's toolbar and the side panel's bar take their height from one token", () => {
  const toolbar = document.createElement("header");
  toolbar.className = "desktop-toolbar";
  const bar = document.createElement("div");
  bar.className = "side-panel-bar";
  document.body.append(toolbar, bar);
  const toolbarHeight = getComputedStyle(toolbar).height;
  assert.match(toolbarHeight, /^var\(--desktop-bar-height\)$/u);
  assert.equal(getComputedStyle(bar).height, toolbarHeight);
});

test("the highlight starts on the chosen row, the arrows move it with the field keeping focus, and Enter picks it", () => {
  const menu = mount();
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  assert.ok(document.activeElement === field, "the field holds focus");
  assert.equal(menu.highlighted(), "acme/billing");
  press("ArrowDown");
  assert.equal(menu.highlighted(), "acme/site");
  assert.ok(document.activeElement === field, "the field keeps focus");
  press("ArrowDown");
  assert.equal(menu.highlighted(), "acme/relay", "the arrows wrap");
  press("Enter");
  assert.deepEqual(menu.picked, ["acme/relay"]);
  press("Escape");
  assert.deepEqual(menu.closes, [1]);
});

test("a value that arrives after the menu opened takes the highlight, unless the arrows have moved it", () => {
  const late = mount({ value: undefined });
  assert.equal(late.highlighted(), "acme/relay");
  late.restand({ value: "acme/site" });
  assert.equal(late.highlighted(), "acme/site");
  press("Enter");
  assert.deepEqual(late.picked, ["acme/site"]);

  const moved = mount({ value: undefined });
  press("ArrowDown");
  moved.restand({ value: "acme/site" });
  assert.equal(moved.highlighted(), "acme/billing", "the arrows' choice stands");
});

test("Enter with nothing to pick stays in the menu rather than reaching the form around it", () => {
  const menu = mount();
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, "nothing here");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => field.dispatchEvent(enter));
  assert.equal(enter.defaultPrevented, true, "Enter goes no further than the menu");
  assert.deepEqual(menu.picked, []);
});

test("a pointer over a row moves the same highlight, and a press on a row picks it without taking focus", () => {
  const menu = mount();
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  const [relay] = menu.rows();
  act(() => relay?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
  assert.equal(menu.highlighted(), "acme/relay");
  const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => relay?.dispatchEvent(pressed));
  assert.equal(pressed.defaultPrevented, true, "the press leaves focus where it is");
  act(() => relay?.click());
  assert.deepEqual(menu.picked, ["acme/relay"]);
  assert.ok(document.activeElement === field);
});

test("a query matches a row's label or its terms, every word of it, and the chosen row keeps its check", () => {
  const menu = mount();
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = (words: string) =>
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("web");
  assert.deepEqual(
    menu.rows().map((row) => row.textContent),
    ["acme/site"],
  );
  type("ACME bill");
  assert.deepEqual(
    menu.rows().map((row) => row.textContent),
    ["acme/billing"],
  );
  assert.equal(menu.rows()[0]?.getAttribute("aria-current"), "true");
  assert.ok(menu.rows()[0]?.querySelector("svg.credential-check"));
  type("nothing here");
  assert.deepEqual(menu.rows(), []);
  assert.equal(menu.find(".plan-compose-menu-note").textContent, "No repositories match");
});

test("with no placeholder there is no search: the list holds focus and reads the same keys", () => {
  const menu = mount({ placeholder: undefined });
  assert.equal(menu.container.querySelector("input"), null);
  const list = menu.find("[role=listbox]");
  assert.ok(document.activeElement === list, "the list holds focus");
  assert.equal(menu.highlighted(), "acme/billing");
  press("ArrowUp");
  assert.equal(menu.highlighted(), "acme/relay");
  press("Enter");
  assert.deepEqual(menu.picked, ["acme/relay"]);
});
