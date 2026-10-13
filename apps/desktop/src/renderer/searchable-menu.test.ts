// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { relayout } from "#testing/resize-observer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { GitHubMark } from "./account-marks";
import { type FootRow, type MenuRow, SearchableMenu } from "./searchable-menu";

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

/** A pinned GitHub row, every press recorded. */
function gitHubFoot(presses: number[] = []): FootRow[] {
  return [{ id: "github", label: "GitHub", onPress: () => presses.push(1) }];
}

/** Forty repositories, more than the bounded list shows at once. */
const MANY: readonly MenuRow[] = Array.from({ length: 40 }, (_, index) => ({
  id: `acme/repo-${index}`,
  label: `acme/repo-${index}`,
  icon: createElement(GitHubMark),
}));

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  const sheet = document.createElement("style");
  sheet.textContent = css;
  document.head.append(sheet);
});

afterEach(() => {
  vi.restoreAllMocks();
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
    highlighted: () =>
      container.querySelector(
        "[role=option][aria-selected='true'], .plan-compose-menu-foot [data-highlighted='true']",
      )?.textContent,
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

/** Types into the search the way a key press does, through the setter React watches. */
function type(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Moves the pointer over an element. */
function hover(element: Element | undefined): void {
  act(() => element?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
}

/** The pixel count a computed length names. */
function px(length: string): number {
  assert.match(length, /^\d+(\.\d+)?px$/u, `${length} is a length in pixels`);
  return Number.parseFloat(length);
}

test("a row is one height whether forty rows match or one: the list is no flex column and a row flexes in no column it stands in", () => {
  const menu = mount({ rows: MANY, value: undefined });
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  const list = menu.find(".plan-compose-menu-list");
  assert.equal(menu.rows().length, 40);
  const tall = menu.rows().map((row) => getComputedStyle(row));
  type(field, "repo-7");
  assert.equal(menu.rows().length, 1);
  const [one] = menu.rows().map((row) => getComputedStyle(row));
  assert.ok(one);
  assert.equal(px(one.height), px(tall[0]?.height ?? ""));
  assert.ok(
    tall.every((row) => row.height === one.height),
    "every row is the same height",
  );
  // Note that the height alone is not the whole invariant, because a flex
  // column bounded by a max-height shrinks its items below the height they
  // ask for, so neither the list nor the row may let that happen.
  assert.notEqual(getComputedStyle(list).display, "flex", "the list distributes no space");
  assert.equal(one.flexShrink, "0", "a row shrinks in no column");
  assert.equal(one.flexGrow, "0", "a row grows in no column");
});

test("the check stands in an end slot every row draws at one width, so a name ends where every other does", () => {
  const menu = mount();
  const slots = menu.rows().map((row) => row.querySelector(".plan-compose-menu-end"));
  assert.equal(slots.length, ROWS.length);
  for (const slot of slots) {
    assert.ok(slot, "every row has the slot, checked or not");
    const style = getComputedStyle(slot);
    assert.equal(style.width, "16px");
    assert.equal(style.height, "16px");
    assert.equal(style.flexShrink, "0");
  }
  const checked = menu.rows().find((row) => row.getAttribute("aria-current") === "true");
  const check = checked?.querySelector(".plan-compose-menu-end svg.credential-check");
  assert.ok(check, "the check stands in the chosen row's slot");
  assert.equal(getComputedStyle(check).width, "16px");
  const unchecked = menu.rows().find((row) => row.getAttribute("aria-current") !== "true");
  assert.equal(unchecked?.querySelector(".plan-compose-menu-end")?.childElementCount, 0);
});

test("a search that matches nothing leaves one quiet line at a row's height or more, never a sliver", () => {
  const menu = mount();
  const rowHeight = px(getComputedStyle(menu.rows()[0] ?? menu.container).height);
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "nothing here");
  const note = menu.find(".plan-compose-menu-note");
  assert.equal(note.textContent, "No repositories match");
  assert.ok(px(getComputedStyle(note).minHeight) >= rowHeight, "at least a row tall");
  assert.equal(getComputedStyle(note).textAlign, "center");
});

test("the menu keeps its width while the search narrows the list", () => {
  const menu = mount({ rows: MANY, value: undefined });
  const root = menu.find(".plan-compose-menu");
  const width = getComputedStyle(root).width;
  px(width);
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "repo-3");
  assert.equal(getComputedStyle(root).width, width);
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "nothing here");
  assert.equal(getComputedStyle(root).width, width);
});

test("a pinned row joins the one highlight: the pointer over it leaves the list's row behind, the arrows reach it past the last row, and Enter presses it", () => {
  const presses: number[] = [];
  const menu = mount({ foot: gitHubFoot(presses) });
  const gitHub = menu.find<HTMLButtonElement>(".plan-compose-menu-foot button");
  const [, , site] = menu.rows();
  hover(site);
  assert.equal(menu.highlighted(), "acme/site");
  hover(gitHub);
  assert.equal(menu.highlighted(), "GitHub");
  assert.equal(menu.container.querySelector("[role=option][aria-selected='true']"), null);
  hover(site);
  assert.equal(menu.highlighted(), "acme/site");
  assert.equal(gitHub.dataset["highlighted"], undefined);
  press("ArrowDown");
  assert.equal(
    menu.highlighted(),
    "GitHub",
    "the arrows go on from the last row to the pinned one",
  );
  press("ArrowDown");
  assert.equal(menu.highlighted(), "acme/relay", "and wrap past it");
  press("ArrowUp");
  assert.equal(menu.highlighted(), "GitHub");
  press("Enter");
  assert.deepEqual(presses, [1]);
  assert.deepEqual(menu.picked, []);
});

/** A pinned Effort row over three efforts, high chosen, every pick recorded. */
function effortFoot(picks: string[]): FootRow[] {
  return [
    {
      id: "effort",
      label: "Effort",
      detail: "High",
      submenu: {
        label: "Effort",
        rows: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
          { id: "max", label: "Max" },
        ],
        value: "high",
        onPick: (id) => picks.push(id),
      },
    },
  ];
}

const submenuOf = (menu: ReturnType<typeof mount>) =>
  menu.container.querySelector<HTMLElement>(".plan-compose-submenu");

const subRows = (menu: ReturnType<typeof mount>) =>
  [...(submenuOf(menu)?.querySelectorAll<HTMLElement>("[role=option]") ?? [])].map((row) => [
    row.textContent,
    row.getAttribute("aria-selected"),
    row.querySelector("svg.credential-check") !== null,
  ]);

test("a pinned row with a submenu names its value and opens the submenu on Right, the arrows then moving inside it and Enter picking", () => {
  const picks: string[] = [];
  const menu = mount({ foot: effortFoot(picks), value: undefined });
  const effort = menu.find<HTMLButtonElement>(".plan-compose-menu-foot button");
  assert.equal(effort.querySelector(".plan-compose-menu-name")?.textContent, "Effort");
  assert.equal(effort.querySelector(".plan-compose-menu-detail")?.textContent, "High");
  assert.ok(effort.querySelector(".plan-compose-menu-end svg"), "a chevron in the end slot");
  assert.equal(submenuOf(menu), null);
  press("ArrowUp");
  assert.equal(menu.highlighted(), "EffortHigh");
  press("ArrowRight");
  const submenu = submenuOf(menu);
  assert.ok(submenu, "Right opens the submenu");
  assert.equal(submenu.getAttribute("aria-label"), "Effort");
  assert.equal(effort.getAttribute("aria-expanded"), "true");
  assert.deepEqual(subRows(menu), [
    ["Low", "false", false],
    ["High", "true", true],
    ["Max", "false", false],
  ]);
  assert.ok(document.activeElement === menu.find("input[role=combobox]"), "the field keeps focus");
  press("ArrowDown");
  assert.deepEqual(
    subRows(menu).map((row) => row[1]),
    ["false", "false", "true"],
  );
  press("Enter");
  assert.deepEqual(picks, ["max"]);
  assert.deepEqual(menu.picked, [], "the menu's own pick is not asked");
});

test("Left and Escape close only the submenu, leaving the highlight on its row; the pointer opens it and a press in it picks", () => {
  const picks: string[] = [];
  const menu = mount({ foot: effortFoot(picks) });
  const effort = menu.find<HTMLButtonElement>(".plan-compose-menu-foot button");
  hover(effort);
  assert.ok(submenuOf(menu), "the pointer over the row opens the submenu");
  assert.equal(menu.highlighted(), "EffortHigh");
  press("ArrowLeft");
  assert.equal(submenuOf(menu), null, "Left closes it");
  assert.equal(menu.highlighted(), "EffortHigh");
  press("ArrowRight");
  assert.ok(submenuOf(menu));
  press("Escape");
  assert.equal(submenuOf(menu), null, "Escape closes it");
  assert.deepEqual(menu.closes, [], "and not the menu");
  assert.equal(menu.highlighted(), "EffortHigh");
  press("Escape");
  assert.deepEqual(menu.closes, [1], "a second Escape closes the menu");

  act(() => effort.click());
  const [low] = submenuOf(menu)?.querySelectorAll<HTMLElement>("[role=option]") ?? [];
  hover(low);
  assert.deepEqual(
    subRows(menu).map((row) => row[1]),
    ["true", "false", "false"],
  );
  const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => low?.dispatchEvent(pressed));
  assert.equal(pressed.defaultPrevented, true, "the press leaves focus in the field");
  act(() => low?.click());
  assert.deepEqual(picks, ["low"]);
  // The highlight moving back to a listed row takes the submenu with it.
  hover(menu.rows()[0]);
  assert.equal(submenuOf(menu), null);
  assert.equal(menu.highlighted(), "acme/relay");
});

test("the submenu stands to the right of the menu and down from its row, turning left or standing up where the window ends before it does", () => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 600,
  });
  const measure = HTMLElement.prototype.getBoundingClientRect;
  let right = 700;
  let bottom = 500;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("plan-compose-submenu")
      ? new DOMRect(right - 200, bottom - 120, 200, 120)
      : measure.call(this);
  };
  try {
    const menu = mount({ foot: effortFoot([]), value: undefined });
    press("ArrowUp");
    press("ArrowRight");
    assert.equal(submenuOf(menu)?.dataset["side"], "right");
    assert.equal(submenuOf(menu)?.dataset["stand"], "down");
    press("ArrowLeft");
    right = 900;
    press("ArrowRight");
    assert.equal(submenuOf(menu)?.dataset["side"], "left");
    assert.equal(submenuOf(menu)?.dataset["stand"], "down");
    press("ArrowLeft");
    right = 700;
    bottom = 700;
    press("ArrowRight");
    assert.equal(submenuOf(menu)?.dataset["side"], "right");
    assert.equal(submenuOf(menu)?.dataset["stand"], "up", "stands up from the row's foot");
  } finally {
    HTMLElement.prototype.getBoundingClientRect = measure;
  }
});

test("a submenu the pointer moves to from another row's is measured again, so a taller one stands up where the window ends before it", () => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 600,
  });
  const measure = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    // The context submenu carries a note under its rows and runs past the window's foot.
    const tall = this.classList.contains("plan-compose-submenu") && this.textContent.includes("1M");
    return this.classList.contains("plan-compose-submenu")
      ? new DOMRect(500, 440, 200, tall ? 200 : 120)
      : measure.call(this);
  };
  try {
    const foot: FootRow[] = [
      ...effortFoot([]),
      {
        id: "context",
        label: "Context",
        detail: "1M",
        submenu: {
          label: "Context",
          rows: [
            { id: "standard", label: "272K" },
            { id: "long", label: "1M" },
          ],
          value: "long",
          note: "On 1M, prompts over 272K tokens cost more.",
          onPick: () => undefined,
        },
      },
    ];
    const menu = mount({ foot, value: undefined });
    const [effort, context] = menu.container.querySelectorAll<HTMLButtonElement>(
      ".plan-compose-menu-foot button",
    );
    hover(effort);
    assert.equal(submenuOf(menu)?.dataset["stand"], "down");
    hover(context);
    assert.equal(submenuOf(menu)?.textContent.includes("1M"), true);
    assert.equal(submenuOf(menu)?.dataset["stand"], "up");
  } finally {
    HTMLElement.prototype.getBoundingClientRect = measure;
  }
});

test("every icon in the menu has a size from the sheet, so none fills the composer", () => {
  const menu = mount({ foot: gitHubFoot() });
  const icons = [...menu.container.querySelectorAll("svg")];
  assert.ok(icons.length >= ROWS.length + 2, "the search glyph, each row's mark, and the check");
  for (const icon of icons) {
    const { width, height } = getComputedStyle(icon);
    assert.match(width, /^\d+px$/u, `${icon.getAttribute("class")} has a width`);
    assert.equal(height, width, `${icon.getAttribute("class")} is square`);
  }
  assert.equal(getComputedStyle(menu.find(".plan-compose-menu-search svg")).width, "16px");
});

test("the list scrolls past a bounded height, inside itself and never sideways, and the foot stands outside it", () => {
  const menu = mount({ foot: gitHubFoot() });
  const list = menu.find(".plan-compose-menu-list");
  const style = getComputedStyle(list);
  assert.match(style.maxHeight, /^\d+px$/u, "the list has a bound");
  assert.equal(style.overflowY, "auto");
  assert.equal(style.overflowX, "hidden");
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
  // The token is each bar's least height, which is its height while its
  // one row of tabs and buttons stands no taller.
  const toolbarHeight = getComputedStyle(toolbar).minHeight;
  assert.match(toolbarHeight, /^var\(--desktop-bar-height\)$/u);
  assert.equal(getComputedStyle(bar).minHeight, toolbarHeight);
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

test("a row kept for a search is not listed until something is typed, and then is found like any other", () => {
  const menu = mount({
    rows: [...ROWS, { id: "acme/archive", label: "acme/archive", searchOnly: true }],
  });
  const names = () => menu.rows().map((row) => row.textContent);
  assert.deepEqual(names(), ["acme/relay", "acme/billing", "acme/site"]);
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "acme");
  assert.deepEqual(names(), ["acme/relay", "acme/billing", "acme/site", "acme/archive"]);
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "");
  assert.deepEqual(names(), ["acme/relay", "acme/billing", "acme/site"]);
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

test("a switch row turns on a press or Enter without closing anything, and a muted one turns nothing", () => {
  const turns: number[] = [];
  let on = false;
  const menu = mount({
    value: undefined,
    foot: [
      { id: "fast", label: "Fast", toggle: { on, onToggle: () => turns.push(1) } },
      {
        id: "muted",
        label: "Muted",
        toggle: { on: false, onToggle: () => turns.push(2) },
        disabled: "No fast version of this one",
      },
    ],
  });
  const [fast, muted] = menu.container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
  assert.ok(fast && muted);
  assert.equal(fast.getAttribute("aria-checked"), "false");
  assert.ok(fast.querySelector(".switch .switch-thumb"), "the panel's own switch at the row's end");
  act(() => fast.click());
  assert.deepEqual(turns, [1]);
  assert.deepEqual(menu.closes, []);
  assert.deepEqual(menu.picked, []);
  on = true;
  menu.restand({
    foot: [{ id: "fast", label: "Fast", toggle: { on, onToggle: () => turns.push(1) } }],
  });
  assert.equal(fast.getAttribute("aria-checked"), "true");
  press("ArrowUp");
  assert.equal(menu.highlighted(), "Fast");
  press("Enter");
  assert.deepEqual(turns, [1, 1]);
  assert.deepEqual(menu.closes, []);

  assert.equal(muted.getAttribute("aria-disabled"), "true");
  act(() => muted.click());
  assert.deepEqual(turns, [1, 1], "a muted row turns nothing");
});

test("a muted pinned row is passed over by the arrows and takes no highlight from the pointer, so it is never a dead stop", () => {
  const menu = mount({
    value: undefined,
    foot: [
      { id: "effort", label: "Effort", detail: "High", onPress: () => undefined },
      {
        id: "fast",
        label: "Fast",
        toggle: { on: false, onToggle: () => undefined },
        disabled: "No fast version of this one",
      },
    ],
  });
  const muted = menu.find<HTMLButtonElement>('[role="switch"]');
  press("ArrowUp");
  assert.equal(menu.highlighted(), "EffortHigh", "Up from the first row passes the muted row");
  press("ArrowDown");
  assert.equal(
    menu.highlighted(),
    "acme/relay",
    "and Down from the last pressable row wraps past it",
  );
  hover(muted);
  assert.equal(menu.highlighted(), "acme/relay", "the pointer over it moves nothing");
  assert.equal(muted.dataset["highlighted"], undefined);
});

test("a row that cannot be picked is dimmed and says why at its end, the highlight starts past it, and neither the arrows, the pointer, a press, nor Enter takes it", () => {
  const menu = mount({
    value: undefined,
    rows: ROWS.map((row, index) => (index === 0 ? { ...row, disabled: "Open" } : row)),
  });
  const [relay] = menu.rows();
  assert.ok(relay);
  assert.equal(relay.getAttribute("aria-disabled"), "true");
  assert.equal(relay.querySelector(".plan-compose-menu-hint")?.textContent, "Open");
  assert.ok(Number(getComputedStyle(relay).opacity) < 1, "the row is dimmed");
  assert.equal(menu.highlighted(), "acme/billing", "the first row that can be picked");

  press("ArrowUp");
  assert.equal(menu.highlighted(), "acme/site", "Up from the first pickable row wraps past it");
  press("ArrowDown");
  assert.equal(menu.highlighted(), "acme/billing", "Down from the last wraps past it");
  hover(relay);
  assert.equal(menu.highlighted(), "acme/billing", "the pointer over it moves nothing");
  act(() => relay.click());
  assert.deepEqual(menu.picked, []);

  type(menu.find<HTMLInputElement>("input[role=combobox]"), "relay");
  assert.equal(menu.highlighted(), undefined, "a match that cannot be picked takes no highlight");
  press("Enter");
  assert.deepEqual(menu.picked, []);
});

test("a row's shortcut is printed at its end, and rows sharing a section stand under its heading, which goes with them when the search matches none", () => {
  const menu = mount({
    value: undefined,
    rows: [
      { ...ROWS[0], id: "relay", label: "acme/relay", section: "Recent" },
      { ...ROWS[1], id: "billing", label: "acme/billing", section: "Recent" },
      {
        ...ROWS[2],
        id: "site",
        label: "acme/site",
        section: "Everything",
        command: APP_COMMAND.TOGGLE_SIDE_PANEL,
      },
    ],
  });
  const groups = () =>
    [...menu.container.querySelectorAll<HTMLElement>("[role=listbox] > [role=group]")].map(
      (group) => [
        group.getAttribute("aria-label"),
        group.querySelector(".plan-compose-menu-section")?.textContent,
        [...group.querySelectorAll("[role=option]")].map(
          (row) => row.querySelector(".plan-compose-menu-name")?.textContent,
        ),
      ],
    );
  assert.deepEqual(groups(), [
    ["Recent", "Recent", ["acme/relay", "acme/billing"]],
    ["Everything", "Everything", ["acme/site"]],
  ]);
  const site = menu.rows()[2];
  assert.equal(site?.querySelector(".plan-compose-menu-hint")?.textContent, "⌥⌘B");

  press("ArrowUp");
  assert.equal(menu.highlighted(), "acme/site⌥⌘B", "the arrows run on across the headings");
  type(menu.find<HTMLInputElement>("input[role=combobox]"), "site");
  assert.deepEqual(groups(), [["Everything", "Everything", ["acme/site"]]]);
});

test("a row the highlight was moved to gives it up once it can no longer be picked, to the first that can", () => {
  const menu = mount({ value: undefined });
  press("ArrowDown");
  assert.equal(menu.highlighted(), "acme/billing");
  menu.restand({
    rows: ROWS.map((row) => (row.id === "acme/billing" ? { ...row, disabled: "Open" } : row)),
  });
  assert.equal(menu.highlighted(), "acme/relay");
  press("Enter");
  assert.deepEqual(menu.picked, ["acme/relay"]);
});

test("a name or a detail cut short by the menu's width is marked to fade at its end, and words shown whole are not", () => {
  const long = "acme/a-repository-named-at-length-past-the-menu";
  const folder = "src/server/hosted/store/a/deep/folder";
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.textContent === long || this.textContent === folder ? 600 : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.textContent === long || this.textContent === folder ? 160 : 0;
  });
  const menu = mount({
    rows: [...ROWS, { id: long, label: long, detail: folder }],
  });
  act(() => relayout());
  const marks = menu
    .rows()
    .map((row) => [
      row.querySelector(".plan-compose-menu-name")?.getAttribute("data-overflow"),
      row.querySelector(".plan-compose-menu-detail")?.getAttribute("data-overflow"),
    ]);

  assert.deepEqual(marks, [
    ["false", undefined],
    ["false", undefined],
    ["false", undefined],
    ["true", "true"],
  ]);
  const fade = getComputedStyle(menu.find('.plan-compose-menu-name[data-overflow="true"]'));
  assert.equal(fade.textOverflow, "clip", "a fade, not an ellipsis");
});

/** The row the focused field or list names to assistive technology, read by its words; none where it names nothing. */
function named(): string | undefined {
  const id = document.activeElement?.getAttribute("aria-activedescendant");
  if (id === null || id === undefined) return undefined;
  const row = document.getElementById(id);
  assert.ok(row, "the id names an element in the document");
  return row.textContent ?? undefined;
}

test("the field names the highlighted row to a reader as the arrows, the pointer, and a search move it, each row by an id of its own that the highlight moving leaves alone", () => {
  const picks: string[] = [];
  const menu = mount({ foot: effortFoot(picks) });
  const field = menu.find<HTMLInputElement>("input[role=combobox]");
  const ids = () => menu.rows().map((row) => row.id);
  const first = ids();
  assert.equal(
    new Set(first.filter(Boolean)).size,
    ROWS.length,
    "every row has an id, none shared",
  );
  assert.equal(named(), "acme/billing", "the chosen row, named as the menu opens");

  press("ArrowDown");
  assert.equal(named(), "acme/site");
  hover(menu.rows()[0]);
  assert.equal(named(), "acme/relay");
  assert.deepEqual(ids(), first, "a row keeps its id as the highlight moves");

  press("ArrowUp");
  assert.equal(named(), "EffortHigh", "a pinned row is named too");
  press("ArrowRight");
  assert.equal(named(), "High", "inside an open submenu, its highlighted row");
  press("ArrowLeft");
  assert.equal(named(), "EffortHigh");

  type(field, "zzz");
  assert.equal(named(), undefined, "nothing is named while nothing matches");
  type(field, "site");
  assert.equal(named(), "acme/site");
});

test("with no field the list, holding focus, names the highlighted row", () => {
  mount({ placeholder: undefined });
  assert.equal(named(), "acme/billing");
  press("ArrowUp");
  assert.equal(named(), "acme/relay");
});

test("Home and End take the highlight to the first and the last row that may be picked, pinned rows included, and inside an open submenu to its own first and last", () => {
  const picks: string[] = [];
  const menu = mount({
    rows: ROWS.map((row, index) => (index === 0 ? { ...row, disabled: "Open" } : row)),
    foot: [...effortFoot(picks), { id: "github", label: "GitHub", disabled: "Not connected" }],
  });
  press("End");
  assert.equal(menu.highlighted(), "EffortHigh", "the last row past the muted one");
  press("Home");
  assert.equal(menu.highlighted(), "acme/billing", "the first row past the muted one");

  press("End");
  press("ArrowRight");
  press("Home");
  assert.deepEqual(
    subRows(menu).map((row) => row[1]),
    ["true", "false", "false"],
  );
  press("End");
  assert.deepEqual(
    subRows(menu).map((row) => row[1]),
    ["false", "false", "true"],
  );
  press("Enter");
  assert.deepEqual(picks, ["max"]);
});

test("Home and End in the field move the highlight rather than the caret", () => {
  mount();
  const home = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
  act(() => document.activeElement?.dispatchEvent(home));
  assert.equal(home.defaultPrevented, true);
  assert.equal(named(), "acme/relay");
});
