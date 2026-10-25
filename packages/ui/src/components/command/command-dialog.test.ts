// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import {
  COMMAND_FILTER,
  CommandDialog,
  type CommandDialogProps,
  type CommandGroup,
} from "./command-dialog.js";

/**
 * command-dialog.test.ts -- a palette opened from a button takes the caret
 * in its field; typing narrows its rows to the ones whose words match, and
 * says so where none do; ↑ ↓ and Return choose a row, and a press chooses
 * one too; its groups stand under their headings, a group's note after its
 * rows; a list still read says it is reading; Escape puts it away and hands
 * focus back to the button, with no key reaching the window behind; and the
 * window's one column may shrink, so a wide row never widens the card.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Note that jsdom lays nothing out: cmdk scrolls its lit row into view and measures its list, so both do nothing here.
  Element.prototype.scrollIntoView = () => undefined;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** The rows chosen, by name, and the keys and presses the window behind the palette heard. */
interface Heard {
  chosen: string[];
  keys: string[];
  presses: number;
}

/** Two groups of rows, each row saying it was chosen. */
function groupsFor(heard: Heard): CommandGroup[] {
  const row = (id: string, words: string) => ({
    id,
    label: words,
    words,
    onSelect: () => heard.chosen.push(words),
  });
  return [
    {
      id: "tasks",
      label: "Tasks",
      items: [row("t1", "Ship the release"), row("t2", "Fix the login page")],
      note: "Older tasks could not be read.",
    },
    {
      id: "actions",
      label: "Actions",
      items: [row("a1", "New task"), row("a2", "Open settings")],
    },
  ];
}

/** A window holding the button that opens the palette over `groups`, listening for keys that leak out. */
function Owner({
  heard,
  groups,
  extra,
}: {
  heard: Heard;
  groups: readonly CommandGroup[];
  extra: Partial<CommandDialogProps> | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    {
      onKeyDown: (event: React.KeyboardEvent) => heard.keys.push(event.key),
      onClick: (event: React.MouseEvent) => {
        if (event.target instanceof Element && event.target.closest("button") === null) {
          heard.presses += 1;
        }
      },
    },
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Search"),
    createElement(CommandDialog, {
      open,
      onOpenChange: setOpen,
      label: "Command palette",
      placeholder: "Search",
      groups,
      ...extra,
    }),
  );
}

/** The window drawn and the palette opened from its button. */
function openPalette(
  groups: (heard: Heard) => readonly CommandGroup[] = groupsFor,
  extra?: Partial<CommandDialogProps>,
): Heard {
  const heard: Heard = { chosen: [], keys: [], presses: 0 };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Owner, { heard, groups: groups(heard), extra })));
  const opener = button("Search");
  act(() => {
    opener.focus();
    opener.click();
  });
  return heard;
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((each) => each.textContent === name);
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function field(): HTMLInputElement {
  const found = dialog()?.querySelector<HTMLInputElement>("input");
  if (found === null || found === undefined) throw new Error("no field");
  return found;
}

/** The rows standing, by their words, in the order drawn. */
function rows(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent ?? "");
}

/** The row lit now. */
function lit(): string | undefined {
  return document.querySelector('[role="option"][aria-selected="true"]')?.textContent ?? undefined;
}

function type(value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("the palette opens on every row with the caret in its field", () => {
  openPalette();
  expect(dialog()?.getAttribute("aria-label")).toBe("Command palette");
  expect(document.activeElement).toBe(field());
  expect(rows()).toEqual(["Ship the release", "Fix the login page", "New task", "Open settings"]);
});

test("typing narrows the rows to the ones whose words match", () => {
  openPalette();
  type("login");
  expect(rows()).toEqual(["Fix the login page"]);
  type("set");
  expect(rows()).toEqual(["Open settings"]);
});

test("Return chooses the best row the words typed found", () => {
  const heard = openPalette();
  type("new");
  expect(lit()).toBe("New task");
  press("Enter");
  expect(heard.chosen).toEqual(["New task"]);
});

test("where nothing matches the list says so", () => {
  openPalette((heard) => groupsFor(heard).map(({ note: _note, ...group }) => group));
  type("zzzz");
  expect(rows()).toEqual([]);
  expect(dialog()?.textContent).toContain("No results match");
});

test("the arrows move the lit row, wrapping, and Return chooses it", () => {
  const heard = openPalette();
  expect(lit()).toBe("Ship the release");
  press("ArrowDown");
  press("ArrowDown");
  expect(lit()).toBe("New task");
  press("Enter");
  expect(heard.chosen).toEqual(["New task"]);
  press("ArrowUp");
  press("ArrowUp");
  press("ArrowUp");
  expect(lit()).toBe("Open settings");
  press("Enter");
  expect(heard.chosen).toEqual(["New task", "Open settings"]);
});

test("a press on a row chooses it", () => {
  const heard = openPalette();
  const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (each) => each.textContent === "Open settings",
  );
  act(() => row?.click());
  expect(heard.chosen).toEqual(["Open settings"]);
  expect(heard.presses).toBe(0);
});

test("each group stands under its heading with its note after its rows", () => {
  openPalette();
  const groups = [...document.querySelectorAll<HTMLElement>('[role="group"]')];
  const named = groups.map((group) => {
    const heading = document.getElementById(group.getAttribute("aria-labelledby") ?? "");
    return [heading?.textContent, [...group.querySelectorAll('[role="option"]')].length];
  });
  expect(named).toEqual([
    ["Tasks", 2],
    ["Actions", 2],
  ]);
  expect(groups[0]?.textContent?.endsWith("Older tasks could not be read.")).toBe(true);
});

test("a group's note stands whatever is typed, in place of the no-match line", () => {
  openPalette((heard) => [
    { id: "failed", label: "Inbox", items: [], note: "Your items could not be read." },
    ...groupsFor(heard).slice(1),
  ]);
  expect(dialog()?.textContent).toContain("Your items could not be read.");
  type("zzzz");
  expect(rows()).toEqual([]);
  expect(dialog()?.textContent).toContain("Your items could not be read.");
  expect(dialog()?.textContent).not.toContain("No results match");
});

test("a list still being read says so rather than that nothing matches", () => {
  openPalette(() => [], { loading: "Reading tasks" });
  const status = dialog()?.querySelector('[role="status"]');
  expect(status?.textContent).toBe("Reading tasks");
  expect(dialog()?.textContent).not.toContain("No results match");
});

test("rows the caller ranks itself stand as handed, whatever is typed", () => {
  openPalette(groupsFor, { filter: COMMAND_FILTER.NONE });
  type("login");
  expect(rows()).toEqual(["Ship the release", "Fix the login page", "New task", "Open settings"]);
});

test("Escape puts the palette away, hands focus back, and reaches no window behind", () => {
  const heard = openPalette();
  press("ArrowDown");
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(button("Search"));
  expect(heard.keys).toEqual([]);
});

test("the palette opens again with its words cleared", () => {
  openPalette();
  type("login");
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  act(() => button("Search").click());
  expect(field().value).toBe("");
  expect(rows()).toHaveLength(4);
});

test("the dimmed window gives the card one column that may shrink below its widest row", () => {
  openPalette();
  const room = document.querySelector<HTMLElement>('[data-slot="dialog-viewport"]');
  // Note that jsdom lays nothing out, so this holds the cause: an auto track grows to the widest row's own width, which put the card's right edge past a phone's screen.
  expect(room?.classList.contains("grid-cols-[minmax(0,1fr)]")).toBe(true);
});
