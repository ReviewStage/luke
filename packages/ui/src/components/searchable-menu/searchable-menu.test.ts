// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MOTION_DELAY_MS } from "@luke/brand";
import { readFailedWords } from "@luke/features/words";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  POPOVER_ALIGN,
  POPOVER_BOUNDS,
  POPOVER_WIDTH,
  type PopoverBounds,
  type PopoverWidth,
} from "../../index.js";
import { ErrorState } from "../error-state/error-state.js";
import { type FootRow, type MenuRow, MenuRowList, SearchableMenu } from "./searchable-menu.js";

/**
 * searchable-menu.test.ts -- what typing in a picker's field does and the
 * keys it reads: typing filters the rows to those every word matches, the
 * arrows pass over a row that cannot be picked and go on into the pinned
 * rows, Enter picks the one the field names to a reader, Right and Left
 * open and close a submenu, Escape closes the submenu before the menu and
 * never reaches what stands behind it, keys an input method is composing
 * with pick and move nothing, and a list too short to search reads the
 * same keys itself. A read that failed says so in the list's place with
 * Retry rather than that nothing matches. The menu hangs from its button
 * at the width its owner chose, its token's; a submenu turns left where it
 * would run past the room its menu keeps to; and a row's own end marks
 * stand at its end, drawn in place as well.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Note that jsdom lays nothing out and so scrolls nothing, and has no
// `scrollIntoView` for the menu to bring its highlight into view with.
Element.prototype.scrollIntoView ??= () => undefined;

/** Stands in for the browser's ResizeObserver, which jsdom lacks, since the popover and every row's words measure themselves. */
class StandInResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete document.documentElement.dataset.lukeProfile;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ROWS: readonly MenuRow[] = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet", disabled: "Not on this plan" },
  { id: "haiku", label: "Haiku" },
];

/** What the menu was asked to do, in order. */
interface Asked {
  readonly said: string[];
  readonly escapedPast: string[];
}

/** A pinned effort row with its submenu, and a press of its own. */
function footOf(said: string[]): FootRow[] {
  return [
    {
      id: "effort",
      label: "Effort",
      submenu: {
        label: "Effort",
        rows: [
          { id: "low", label: "Low" },
          { id: "high", label: "High" },
        ],
        value: "high",
        onPick: (id) => said.push(`effort ${id}`),
      },
    },
    { id: "github", label: "Open on GitHub", onPress: () => said.push("github") },
  ];
}

/** The menu drawn over `rows`, with a field where `placeholder` is given, in a page that hears what Escape reaches. */
function mount(
  options: {
    placeholder?: string;
    foot?: boolean;
    room?: boolean;
    rows?: readonly MenuRow[];
    note?: React.ReactNode;
    width?: PopoverWidth | undefined;
    bounds?: PopoverBounds | undefined;
  } = {},
) {
  const asked: Asked = { said: [], escapedPast: [] };
  // Note that the page listens a box above React's root, because a press
  // kept from it still reaches the root's own listeners.
  const page = document.body.appendChild(document.createElement("div"));
  const container = page.appendChild(document.createElement("div"));
  if (options.room === true) page.dataset.popoverRoom = "";
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape") asked.escapedPast.push("Escape");
  });
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(SearchableMenu, {
        id: "menu",
        label: "Model",
        placeholder: options.placeholder,
        rows: options.rows ?? ROWS,
        value: undefined,
        note: options.note,
        noMatch: "No models match",
        onPick: (id) => asked.said.push(`pick ${id}`),
        onClose: () => asked.said.push("close"),
        onLeave: () => undefined,
        foot: options.foot === true ? footOf(asked.said) : undefined,
        align: POPOVER_ALIGN.START,
        width: options.width,
        bounds: options.bounds,
      }),
    ),
  );
  return asked;
}

/** Where the keys are read: the field, or the list where there is none. */
function keys(): HTMLElement {
  return (
    document.querySelector<HTMLElement>('[role="combobox"]') ??
    document.querySelector<HTMLElement>('[role="listbox"]') ??
    assert.fail("the keys' element")
  );
}

function press(init: KeyboardEventInit): void {
  act(() => {
    keys().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** `words` typed into the field, as an input event hands them. */
function type(words: string): void {
  const field = keys() as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The words of the row the keys' element names active to a reader. */
function announced(): string | undefined {
  const id = keys().getAttribute("aria-activedescendant");
  const row = id === null ? null : document.getElementById(id);
  return row?.textContent ?? undefined;
}

/** The names of the rows the list holds now. */
function listed(): string[] {
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].map(
    (option) => option.textContent ?? "",
  );
}

test("typing keeps the rows every word matches, and the first that may be picked takes the highlight", () => {
  const asked = mount({
    placeholder: "Search models",
    rows: [
      { id: "opus", label: "Opus", terms: ["Anthropic"] },
      { id: "gpt", label: "GPT-5", terms: ["OpenAI"] },
      { id: "sonnet", label: "Sonnet", terms: ["Anthropic"], disabled: "Not on this plan" },
      { id: "haiku", label: "Haiku", terms: ["Anthropic"] },
    ],
  });
  type("anthropic");
  const anthropic = listed();
  type("anthropic ha");
  const narrowed = listed();
  type("gemini");
  const none = document.querySelector('[role="listbox"]')?.textContent;
  press({ key: "Enter" });

  assert.deepEqual(anthropic, ["Opus", "SonnetNot on this plan", "Haiku"]);
  assert.deepEqual(narrowed, ["Haiku"]);
  assert.equal(none, "No models match");
  assert.deepEqual(asked.said, []);
});

test("the arrows pass over a row that cannot be picked, wrap both ways, and Enter picks the one named", () => {
  const asked = mount({ placeholder: "Search models" });
  const first = announced();
  press({ key: "ArrowDown" });
  const passed = announced();
  press({ key: "ArrowDown" });
  const wrapped = announced();
  press({ key: "ArrowUp" });
  const back = announced();
  press({ key: "Enter" });

  assert.equal(document.activeElement, keys());
  assert.deepEqual([first, passed, wrapped, back], ["Opus", "Haiku", "Opus", "Haiku"]);
  assert.deepEqual(asked.said, ["pick haiku"]);
});

test("an Enter held with Command picks the highlighted row as a bare one does", () => {
  const asked = mount({ placeholder: "Search models" });
  press({ key: "ArrowDown" });
  press({ key: "Enter", metaKey: true });

  assert.deepEqual(asked.said, ["pick haiku"]);
});

test("a read that failed says so in the list's place with Retry, and never that nothing matches", () => {
  const retried: string[] = [];
  mount({
    placeholder: "Search repositories",
    rows: [],
    note: createElement(ErrorState, {
      onRetry: () => {
        retried.push("retry");
      },
      children: readFailedWords("your repositories"),
    }),
  });
  const list = document.querySelector('[role="listbox"]') ?? assert.fail("the list stands");
  const retry =
    [...list.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("Retry stands in the note");
  act(() => retry.click());

  assert.match(list.textContent ?? "", /Your repositories could not be read\./u);
  assert.doesNotMatch(list.textContent ?? "", /No models match/u);
  assert.deepEqual(retried, ["retry"]);
});

/**
 * The width the menu's popover is placed at under the desktop's tokens,
 * read from `profiles.css` as the window loads it, with the token's own
 * value beside it.
 */
function placedWidth(width: PopoverWidth | undefined, token: string) {
  const sheet = document.head.appendChild(document.createElement("style"));
  // Note that the sheet is found by its path, because jsdom's URL reads no file address.
  sheet.textContent = readFileSync(
    path.join(import.meta.dirname, "../../tokens/profiles.css"),
    "utf8",
  );
  document.documentElement.dataset.lukeProfile = "desktop";
  mount({ placeholder: "Search models", width });
  const layer =
    document.querySelector<HTMLElement>(".luke-anchored-popover") ?? assert.fail("it hangs");
  return {
    placed: layer.style.width,
    token: getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
  };
}

test("the width chosen sets the popover's width to its token, and none chosen is regular", () => {
  const narrow = placedWidth(POPOVER_WIDTH.NARROW, "--luke-popover-width-narrow");
  act(() => roots.pop()?.unmount());
  const wide = placedWidth(POPOVER_WIDTH.WIDE, "--luke-popover-width-wide");
  act(() => roots.pop()?.unmount());
  const unnamed = placedWidth(undefined, "--luke-popover-width-regular");

  assert.equal(narrow.placed, narrow.token);
  assert.equal(wide.placed, wide.token);
  assert.equal(unnamed.placed, unnamed.token);
  assert.notEqual(narrow.placed, wide.placed);
});

test("the arrows go on into the pinned rows, whose submenu Right opens, Left closes, and Enter picks in", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  const last = announced();
  press({ key: "ArrowUp" });
  const effort = announced();
  press({ key: "ArrowRight" });
  const inside = announced();
  const expanded = document
    .querySelector('[aria-haspopup="listbox"]')
    ?.getAttribute("aria-expanded");
  press({ key: "ArrowLeft" });
  const closed = document.querySelector('[aria-label="Effort"][role="listbox"]');
  press({ key: "ArrowRight" });
  press({ key: "ArrowUp" });
  press({ key: "Enter" });

  assert.deepEqual([last, effort, inside, expanded], ["Open on GitHub", "Effort", "High", "true"]);
  assert.equal(closed, null);
  assert.deepEqual(asked.said, ["effort low"]);
});

/** A listed row that opens a submenu of where a new tab opens, beside a row of its own. */
function browserRows(said: string[]): readonly MenuRow[] {
  return [
    { id: "board", label: "Board" },
    {
      id: "browser",
      label: "New Browser tab",
      submenu: {
        label: "Open the tab in",
        rows: [
          { id: "agent", label: "Invite expiry" },
          { id: "mac", label: "This Mac" },
        ],
        value: undefined,
        onPick: (id) => said.push(`open ${id}`),
      },
    },
  ];
}

test("a listed row with a submenu opens it on Enter or Right rather than being picked, Left closes it, and Enter picks in it", () => {
  const said: string[] = [];
  const asked = mount({ placeholder: "Search tabs", rows: browserRows(said) });
  press({ key: "ArrowDown" });
  press({ key: "Enter" });
  const inside = announced();
  press({ key: "ArrowLeft" });
  const closed = document.querySelector('[aria-label="Open the tab in"][role="listbox"]');
  press({ key: "ArrowRight" });
  press({ key: "ArrowDown" });
  press({ key: "Enter" });

  assert.equal(inside, "Invite expiry");
  assert.equal(closed, null);
  assert.deepEqual(asked.said, []);
  assert.deepEqual(said, ["open mac"]);
});

test("a search finds a listed row by the rows of its submenu", () => {
  mount({ placeholder: "Search tabs", rows: browserRows([]) });
  type("expiry");

  assert.equal(announced(), "New Browser tab");
});

test("Enter on a pinned row presses it", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  press({ key: "Enter" });

  assert.deepEqual(asked.said, ["github"]);
});

test("Escape closes an open submenu before the menu, and never reaches the page behind", () => {
  const asked = mount({ placeholder: "Search models", foot: true });
  press({ key: "ArrowUp" });
  press({ key: "ArrowUp" });
  press({ key: "ArrowRight" });
  press({ key: "Escape" });
  const submenu = document.querySelector('[aria-label="Effort"][role="listbox"]');
  press({ key: "Escape" });

  assert.equal(submenu, null);
  assert.deepEqual(asked.said, ["close"]);
  assert.deepEqual(asked.escapedPast, []);
});

test("keys an input method is composing with move nothing and pick nothing", () => {
  const asked = mount({ placeholder: "Search models" });
  press({ key: "ArrowDown", isComposing: true });
  const still = announced();
  press({ key: "Enter", isComposing: true });
  press({ key: "Escape", isComposing: true });

  assert.equal(still, "Opus");
  assert.deepEqual(asked.said, []);
  assert.deepEqual(asked.escapedPast, []);
});

test("a list too short to search holds focus, names its highlight, and reads the same keys", () => {
  const asked = mount();
  press({ key: "ArrowDown" });
  const moved = announced();
  press({ key: "Enter" });

  assert.equal(keys().getAttribute("role"), "listbox");
  assert.equal(document.activeElement, keys());
  assert.equal(moved, "Haiku");
  assert.deepEqual(asked.said, ["pick haiku"]);
});

/**
 * Where the Effort submenu stands once opened in a room `room` wide at the
 * window's left, its menu's row from `rowLeft` to `rowRight`: the side it
 * took and how far it was pushed back over the menu. jsdom lays nothing
 * out, so the window, the room, the row, and the submenu, 200px wide and
 * drawn on the right, are answered as the panel would lay them.
 */
function submenuIn(room: number, rowLeft: number, rowRight: number, bounds?: PopoverBounds) {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.popoverRoom !== undefined) return new DOMRect(0, 0, room, 800);
    if (this.classList.contains("luke-searchable-menu-branch")) {
      return new DOMRect(rowLeft, 100, rowRight - rowLeft, 32);
    }
    if (this.classList.contains("luke-searchable-menu-submenu")) {
      return new DOMRect(rowRight + 9, 100, 200, 100);
    }
    return new DOMRect(0, 0, 0, 0);
  });
  mount({ placeholder: "Search models", foot: true, room: true, bounds });
  press({ key: "ArrowUp" });
  press({ key: "ArrowUp" });
  press({ key: "ArrowRight" });
  const submenu =
    document.querySelector<HTMLElement>(".luke-searchable-menu-submenu") ?? assert.fail("it opens");
  return {
    side: submenu.dataset.side,
    shift: Number.parseFloat(submenu.style.getPropertyValue("--luke-submenu-shift")),
  };
}

test("a submenu that would run past the room its menu keeps to turns to the left, though the window has room", () => {
  assert.deepEqual(submenuIn(800, 300, 600), { side: "left", shift: 0 });
});

test("a submenu of a menu bounded by the window alone opens to the right past its marked room, where the window has room", () => {
  assert.deepEqual(submenuIn(400, 100, 350, POPOVER_BOUNDS.WINDOW), { side: "right", shift: 0 });
});

test("a submenu with room on neither side takes the side it runs past less, pushed back over the menu inside the room", () => {
  // A 340px menu at x=30 in a 390px side panel: 209px past on the right, 179px on the left.
  assert.deepEqual(submenuIn(390, 30, 370), { side: "left", shift: 179 });
});

test("a row's own end marks stand at its end, after why it cannot be picked now, and a row with none ends in nothing", () => {
  mount({
    placeholder: "Search agents",
    rows: [
      { id: "alerts", label: "Alerts", end: createElement("span", { className: "failed-mark" }) },
      {
        id: "sweep",
        label: "Nightly sweep",
        disabled: "Archived",
        end: createElement("span", { className: "actor-mark" }),
      },
      { id: "plain", label: "Plain" },
    ],
  });
  const ends = [...document.querySelectorAll('[role="option"]')].map((option) => {
    const end = option.querySelector(".luke-combobox-option-hint");
    return end === null
      ? null
      : [...end.childNodes].map((node) =>
          node instanceof HTMLElement ? `.${node.className}` : node.textContent,
        );
  });

  assert.deepEqual(ends, [[".failed-mark"], ["Archived", ".actor-mark"], null]);
});

/** The pointer arriving on `target` and resting there past the hint's wait. */
function restOn(target: Element): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
    });
  } finally {
    vi.useRealTimers();
  }
}

test("rows drawn in place wear their end marks and hang their cards while the pointer rests on them, a submenu's choices as well", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(MenuRowList, {
        label: "Open a tab",
        onPick: () => undefined,
        rows: [
          {
            id: "alerts",
            label: "Alerts",
            end: createElement("span", { className: "failed-mark" }),
            card: createElement("div", { "data-card": "alerts" }, "Alerts card"),
          },
          { id: "plain", label: "Plain" },
          {
            id: "browser",
            label: "New Browser tab",
            submenu: {
              label: "Open the tab in",
              value: undefined,
              onPick: () => undefined,
              rows: [
                {
                  id: "sweep",
                  label: "Sweep",
                  end: createElement("span", { className: "failed-mark" }),
                  card: createElement("div", { "data-card": "sweep" }, "Sweep card"),
                },
              ],
            },
          },
        ],
      }),
    ),
  );
  const rows = [...container.querySelectorAll<HTMLElement>("li, [role='listitem']")];
  const ended = rows.filter((row) => row.querySelector(".failed-mark") !== null);
  assert.equal(ended.length, 2, "the row and the submenu's choice each wear their mark");

  const named = (label: string) =>
    [...container.querySelectorAll<HTMLElement>("button")].find((button) =>
      button.textContent?.includes(label),
    ) ?? assert.fail(`${label} is drawn`);
  restOn(named("Alerts"));
  assert.equal(
    document.querySelector(".luke-tooltip-card [data-card]")?.textContent,
    "Alerts card",
  );
  restOn(named("Sweep"));
  assert.ok(
    [...document.querySelectorAll(".luke-tooltip-card [data-card]")].some(
      (card) => card.textContent === "Sweep card",
    ),
  );
});
