// @vitest-environment jsdom

import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { List, ListRow } from "../list-row/list-row.js";
import { type SelectionAct, SelectionBar } from "./selection-bar.js";

/**
 * selection.test.ts -- a List asked to choose rows does so as a Mac's list
 * does: ⌘-click puts a row in and takes it out, ⇧-click chooses the run
 * from the row last pressed over what was chosen before it, ⇧↑↓ grow and
 * shrink the run from the row in hand and stop at the ends, ⌘A chooses
 * every row, and Esc none, going no further; an unavailable row is never
 * chosen by any of them, and a plain press still opens its row and
 * chooses nothing. A set its owner clears starts the next run afresh. A
 * list not asked opens its row on a ⌘-click as it always has. The bar
 * over the list says how many are chosen, does its acts, drops an act's
 * menu, and clears on Clear and on Esc; with none chosen it draws nothing.
 * Synthetic places.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PLACES = ["Inbox", "Tasks", "Chat", "Automations", "Settings"] as const;

const roots: Root[] = [];

/** What hears keys on the document, taken down after each test. */
const listening: ((event: KeyboardEvent) => void)[] = [];

// Note that every row measures its title, so each test draws beside a
// ResizeObserver, which jsdom lacks.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const each of listening.splice(0)) document.removeEventListener("keydown", each);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Draws `element` into a container in the document and hands the container back. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/**
 * Places whose rows are chosen, those named in `off` unavailable; the
 * chosen ones and each place opened are listed after the list, and a
 * button beside it clears the set as its owner would.
 */
function Choosing({
  off = [],
  chosen = [],
}: {
  off?: readonly string[];
  chosen?: readonly string[];
}): React.JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(chosen));
  const [opened, setOpened] = useState<string[]>([]);
  return createElement(
    Fragment,
    null,
    createElement(List, {
      label: "Places",
      selection: { selected, onChange: setSelected },
      children: PLACES.map((name) =>
        createElement(ListRow, {
          key: name,
          selectKey: name,
          title: name,
          disabled: off.includes(name),
          onPress: () => setOpened((all) => [...all, name]),
        }),
      ),
    }),
    createElement("output", { "data-chosen": "" }, [...selected].sort().join(",")),
    createElement("output", { "data-opened": "" }, opened.join(",")),
    createElement(
      "button",
      { type: "button", onClick: () => setSelected(new Set()) },
      "Owner clears",
    ),
  );
}

/** The keys that reach the document, past whatever stands in front of it. */
function heardBehind(): string[] {
  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event.key);
  listening.push(hear);
  document.addEventListener("keydown", hear);
  return heard;
}

/** The button whose words or label are `name`. */
function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

/** The places chosen now, in alphabetical order. */
function chosen(within: HTMLElement): string {
  return within.querySelector("[data-chosen]")?.textContent ?? "";
}

/** The places opened so far, in the order opened. */
function opened(within: HTMLElement): string {
  return within.querySelector("[data-opened]")?.textContent ?? "";
}

/** Clicks `target` with `held` modifiers, as the pointer would. */
function click(target: HTMLElement, held: MouseEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...held }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...held }));
  });
}

/** Presses `name` on whatever holds the focus, answering whether something took it. */
function key(name: string, held: KeyboardEventInit = {}): boolean {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...held,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

test("⌘-click puts a row in the selection and takes it out again, without opening it", () => {
  const container = draw(createElement(Choosing));
  click(button(container, "Tasks"), { metaKey: true });
  click(button(container, "Settings"), { metaKey: true });
  expect(chosen(container)).toBe("Settings,Tasks");
  click(button(container, "Tasks"), { metaKey: true });
  expect(chosen(container)).toBe("Settings");
  expect(opened(container)).toBe("");
});

test("a chosen row is filled and described as selected; one not chosen is neither", () => {
  const container = draw(createElement(Choosing, { chosen: ["Chat"] }));
  const chat = button(container, "Chat");
  expect(chat.getAttribute("aria-description")).toBe("Selected");
  expect(chat.closest("li")?.getAttribute("data-selected")).toBe("true");
  const inbox = button(container, "Inbox");
  expect(inbox.getAttribute("aria-description")).toBeNull();
  expect(inbox.closest("li")?.getAttribute("data-selected")).toBeNull();
});

test("a plain click opens its row as it always has, and leaves the selection as it stands", () => {
  const container = draw(createElement(Choosing, { chosen: ["Inbox"] }));
  click(button(container, "Chat"));
  expect(opened(container)).toBe("Chat");
  expect(chosen(container)).toBe("Inbox");
});

test("⇧-click chooses the run from the row last pressed, and a second ⇧-click swaps it for another", () => {
  const container = draw(createElement(Choosing));
  click(button(container, "Tasks"));
  click(button(container, "Automations"), { shiftKey: true });
  expect(chosen(container)).toBe("Automations,Chat,Tasks");
  click(button(container, "Inbox"), { shiftKey: true });
  expect(chosen(container)).toBe("Inbox,Tasks");
  expect(opened(container)).toBe("Tasks");
});

test("⇧-click lays its run over what was chosen before the row it runs from", () => {
  const container = draw(createElement(Choosing));
  click(button(container, "Inbox"), { metaKey: true });
  click(button(container, "Chat"), { metaKey: true });
  click(button(container, "Settings"), { shiftKey: true });
  expect(chosen(container)).toBe("Automations,Chat,Inbox,Settings");
});

test("an unavailable row is never chosen, though a run passes over it", () => {
  const container = draw(createElement(Choosing, { off: ["Chat"] }));
  click(button(container, "Inbox"), { metaKey: true });
  click(button(container, "Automations"), { shiftKey: true });
  expect(chosen(container)).toBe("Automations,Inbox,Tasks");
  click(button(container, "Chat"), { metaKey: true });
  expect(chosen(container)).toBe("Automations,Inbox,Tasks");
});

test("⌘A chooses every available row of the list", () => {
  const container = draw(createElement(Choosing, { off: ["Settings"] }));
  act(() => button(container, "Inbox").focus());
  expect(key("a", { metaKey: true })).toBe(true);
  expect(chosen(container)).toBe("Automations,Chat,Inbox,Tasks");
});

test("Esc chooses none and goes no further; with none chosen it is left to what stands behind", () => {
  const heard = heardBehind();
  const container = draw(createElement(Choosing, { chosen: ["Inbox", "Chat"] }));
  act(() => button(container, "Inbox").focus());
  expect(key("Escape")).toBe(true);
  expect(chosen(container)).toBe("");
  expect(heard).toEqual([]);
  expect(key("Escape")).toBe(false);
  expect(heard).toEqual(["Escape"]);
});

test("⇧↓ and ⇧↑ grow and shrink the run from the row in hand, passing an unavailable row and stopping at the end", () => {
  const container = draw(createElement(Choosing, { off: ["Chat"] }));
  act(() => button(container, "Tasks").focus());
  key("ArrowDown", { shiftKey: true });
  expect(chosen(container)).toBe("Automations,Tasks");
  expect(document.activeElement).toBe(button(container, "Automations"));
  key("ArrowDown", { shiftKey: true });
  key("ArrowDown", { shiftKey: true });
  expect(chosen(container)).toBe("Automations,Settings,Tasks");
  expect(document.activeElement).toBe(button(container, "Settings"));
  key("ArrowUp", { shiftKey: true });
  key("ArrowUp", { shiftKey: true });
  key("ArrowUp", { shiftKey: true });
  expect(chosen(container)).toBe("Inbox,Tasks");
  expect(document.activeElement).toBe(button(container, "Inbox"));
});

test("a set its owner cleared starts the next ⇧-click's run afresh, at the row pressed", () => {
  const container = draw(createElement(Choosing));
  click(button(container, "Inbox"), { metaKey: true });
  click(button(container, "Owner clears"));
  click(button(container, "Automations"), { shiftKey: true });
  expect(chosen(container)).toBe("Automations");
});

test("a list not asked to choose rows opens its row on a ⌘-click, and leaves ⌘A and Esc alone", () => {
  const pressed: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Places",
      children: PLACES.map((name) =>
        createElement(ListRow, {
          key: name,
          selectKey: name,
          title: name,
          onPress: () => pressed.push(name),
        }),
      ),
    }),
  );
  click(button(container, "Chat"), { metaKey: true });
  expect(pressed).toEqual(["Chat"]);
  expect(button(container, "Chat").closest("li")?.getAttribute("data-selected")).toBeNull();
  act(() => button(container, "Chat").focus());
  expect(key("a", { metaKey: true })).toBe(false);
  expect(key("Escape")).toBe(false);
});

/**
 * A bar over `count` chosen rows of a list of places, what its acts did
 * listed after it; Archive takes the chosen rows away, Inbox, the list's
 * Tab stop, among them.
 */
function Bar({ count }: { count: number }): React.JSX.Element {
  const [left, setLeft] = useState(count);
  const [places, setPlaces] = useState<readonly string[]>(PLACES);
  const [heard, setHeard] = useState<string[]>([]);
  const acts: SelectionAct[] = [
    { label: "Mark done", onAct: () => setHeard((all) => [...all, "done"]) },
    {
      label: "Archive",
      onAct: () => {
        setPlaces((all) => all.filter((name) => name !== "Inbox"));
        setLeft(0);
      },
    },
    {
      label: "Move to section",
      menu: [[{ label: "Later", onSelect: () => setHeard((all) => [...all, "later"]) }]],
    },
  ];
  return createElement(
    Fragment,
    null,
    createElement(SelectionBar, {
      count: left,
      acts,
      onClear: () => setLeft(0),
      controls: "places",
    }),
    createElement(List, {
      id: "places",
      label: "Places",
      children: places.map((name) =>
        createElement(ListRow, { key: name, title: name, onPress: () => undefined }),
      ),
    }),
    createElement("output", null, heard.join(",")),
  );
}

test("the bar says how many rows are chosen, in the number's own format", () => {
  const container = draw(createElement(Bar, { count: 1200 }));
  const bar = container.querySelector('[role="toolbar"]');
  expect(bar?.querySelector('[role="status"]')?.textContent).toBe("1,200 selected");
  expect(bar?.getAttribute("aria-labelledby")).toBe(
    bar?.querySelector('[role="status"]')?.getAttribute("id"),
  );
});

test("the bar does its acts, drops an act's menu of choices, and Clear chooses none, drawing no bar", () => {
  const container = draw(createElement(Bar, { count: 3 }));
  act(() => button(container, "Mark done").click());
  expect(container.querySelector("output")?.textContent).toBe("done");
  const move = button(container, "Move to section");
  act(() => move.click());
  expect(move.getAttribute("aria-expanded")).toBe("true");
  const later = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "Later",
  );
  expect(later).toBeDefined();
  act(() => button(container, "Clear selection").click());
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
});

test.each([
  ["Clear selection", "Inbox"],
  ["Escape", "Inbox"],
  ["Archive", "Tasks"],
])(
  "the bar holding the focus as its rows go hands it to its list's Tab stop, or its first row where the stop went with them: %s",
  (leave, landed) => {
    const container = draw(createElement(Bar, { count: 2 }));
    act(() => button(container, "Mark done").focus());
    if (leave === "Escape") key("Escape");
    else {
      act(() => button(container, leave).focus());
      act(() => button(container, leave).click());
    }
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.activeElement).toBe(button(container, landed));
    expect(button(container, landed).tabIndex).toBe(0);
  },
);

test("a selection its owner clears while the focus stands elsewhere leaves the focus where it is", () => {
  const container = draw(createElement(Bar, { count: 2 }));
  act(() => button(container, "Mark done").focus());
  act(() => button(container, "Chat").focus());
  act(() => button(container, "Clear selection").click());
  expect(document.activeElement).toBe(button(container, "Chat"));
});

test("Esc in the bar chooses none, and goes no further", () => {
  const heard = heardBehind();
  const container = draw(createElement(Bar, { count: 2 }));
  act(() => button(container, "Mark done").focus());
  expect(key("Escape")).toBe(true);
  expect(container.querySelector('[role="toolbar"]')).toBeNull();
  expect(heard).toEqual([]);
});

test("the bar's buttons are one Tab stop, ←→ walking them", () => {
  const container = draw(createElement(Bar, { count: 2 }));
  const stops = [...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')];
  expect(stops.filter((each) => each.tabIndex === 0)).toEqual([button(container, "Mark done")]);
  act(() => button(container, "Mark done").focus());
  key("ArrowRight");
  expect(document.activeElement).toBe(button(container, "Archive"));
  key("ArrowRight");
  expect(document.activeElement).toBe(button(container, "Move to section"));
  key("ArrowRight");
  expect(document.activeElement).toBe(button(container, "Clear selection"));
});
