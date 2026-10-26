// @vitest-environment jsdom

import { MOTION_DELAY_MS } from "@luke/brand";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { Tooltip } from "../tooltip/hint.js";
import {
  MENU_DETAIL,
  MENU_ITEM_MARK,
  MENU_KEEPS_CLEAR,
  Menu,
  type MenuEntry,
  MenuItem,
  NO_CONTEXT_MENU,
  useMenu,
} from "./menu.js";

/**
 * menu.test.ts -- a menu behaves as a system menu does: its button opens it
 * with focus on its first item, the arrows pass over an item that does not
 * apply now, a submenu opens beside its item and closes alone, choosing an
 * item acts, and Escape, Tab, or a press elsewhere closes it, the keys
 * handing focus back to what opened it. An item steered from a field, as
 * a searchable menu's pinned rows are, is a switch for a setting and says
 * whether the list it opens stands, keeps a press from taking the focus,
 * and takes no press where it does not apply now. A touch held still on
 * what a right-click opens a menu on opens the same menu at the touch,
 * once, and its release makes no click; a touch that moves or lets go
 * first, and a mouse held down, open nothing. An item hangs its card beside
 * itself on rest, which leaves the menu its focus, its arrows, and a press on
 * the card. In a phone's layout the same menu rises as a sheet, a dialog
 * holding its rows, a submenu opening in its place with a way back, and
 * Escape or a press on the dimmed window putting it away with focus handed
 * back.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-room");
});

/** What a test's menu chose, in the order it chose it. */
type Chosen = string[];

function action(label: string, chosen: Chosen, extra: { disabled?: boolean } = {}) {
  return { label, onSelect: () => chosen.push(label), ...extra };
}

/** A ⋯ that drops `groups`, a button after it, and a row a right-click opens the same menu on. */
function Harness({ groups }: { groups: readonly (readonly MenuEntry[])[] }): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    Fragment,
    null,
    createElement("button", { type: "button", ...menu.trigger() }, "More"),
    createElement("button", { type: "button" }, "After"),
    createElement("p", menu.contextMenu(), "Row"),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "Plan actions",
          menu: menu.drawn,
          groups,
          onClose: menu.close,
        }),
  );
}

/** A menu of Rename, a dimmed Move, and Archive, ruled from a red Delete. */
function taskGroups(chosen: Chosen): readonly (readonly MenuEntry[])[] {
  return [
    [
      action("Rename", chosen),
      action("Move", chosen, { disabled: true }),
      action("Archive", chosen),
    ],
    [{ ...action("Delete", chosen), danger: true }],
  ];
}

/** A menu of two submenus, as a sidebar's View options is: Group by over Order by. */
function viewGroups(chosen: Chosen): readonly (readonly MenuEntry[])[] {
  const choice = (label: string) => ({ ...action(label, chosen), checked: false });
  return [
    [
      { label: "Group by", items: [choice("Repository"), choice("None")] },
      { label: "Order by", items: [choice("Last updated"), choice("Name")] },
    ],
  ];
}

function mount(element: React.ReactElement): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** The button whose words or name are `name`. */
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found;
}

/** The menu named `label` standing open, if it is: drawn and not on its way out. */
function openMenu(label = "Plan actions"): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${label}"]:not([data-leaving])`,
  );
}

function focused(): string | null | undefined {
  return document.activeElement?.textContent;
}

/** A key pressed on whatever has focus, as the keyboard sends it. */
function key(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

function press(element: HTMLElement): void {
  act(() => element.click());
}

/** A press on whatever has focus, as Enter or Space on a menu's item gives. */
function pressFocused(): void {
  const item = document.activeElement;
  if (!(item instanceof HTMLElement)) throw new Error("nothing has focus");
  press(item);
}

/** The pointer moving onto `to`, from `from` or from outside the window, as a browser reports it. */
function pointerMove(from: HTMLElement | null, to: HTMLElement): void {
  act(() => {
    from?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

test("the button opens the menu on its first item, the arrows pass over a dimmed item and wrap, and a choice acts and hands focus back", () => {
  const chosen: Chosen = [];
  mount(createElement(Harness, { groups: taskGroups(chosen) }));
  const more = button("More");
  press(more);
  expect(more.getAttribute("aria-expanded")).toBe("true");
  expect(focused()).toBe("Rename");
  key("ArrowDown");
  expect(focused()).toBe("Archive");
  key("ArrowDown");
  expect(focused()).toBe("Delete");
  key("ArrowDown");
  expect(focused()).toBe("Rename");
  key("ArrowUp");
  expect(focused()).toBe("Delete");
  key("Home");
  expect(focused()).toBe("Rename");
  key("End");
  key("ArrowUp");
  expect(focused()).toBe("Archive");
  pressFocused();
  expect(chosen).toEqual(["Archive"]);
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(more);
  expect(more.getAttribute("aria-expanded")).toBe("false");
});

test("the button names the menu it opened while it stands, and none once it is closed", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const more = button("More");
  expect(more.getAttribute("aria-controls")).toBeNull();
  press(more);
  const standing = openMenu() ?? expect.fail("the menu stands");
  expect(standing.id).not.toBe("");
  expect(more.getAttribute("aria-controls")).toBe(standing.id);
  press(more);
  expect(more.getAttribute("aria-controls")).toBeNull();
});

test("typing the start of an item's name moves to it, as a system menu's typeahead does", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  press(button("More"));
  expect(focused()).toBe("Rename");
  key("a");
  key("r");
  expect(focused()).toBe("Archive");
});

test("Escape closes the menu with focus back on its button, and a second press on the button closes it too", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const more = button("More");
  press(more);
  key("Escape");
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(more);
  press(more);
  expect(openMenu()).not.toBeNull();
  press(more);
  expect(openMenu()).toBeNull();
});

test("Tab closes the menu and hands focus back to its button, for the browser to go on from", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  press(button("More"));
  key("Tab");
  expect(openMenu()).toBeNull();
  expect(document.activeElement).toBe(button("More"));
});

test("a press elsewhere closes the menu and takes nothing it was offered", () => {
  const chosen: Chosen = [];
  mount(createElement(Harness, { groups: taskGroups(chosen) }));
  press(button("More"));
  act(() => {
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(openMenu()).toBeNull();
  expect(chosen).toEqual([]);
});

/** Stands in for the browser's ResizeObserver, which jsdom lacks and a card places itself by, reporting a box once as it is observed, as a first layout would. */
function standInResizeObserver(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {}
      observe(): void {
        this.heard([], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

test("a detail placed beside its label is heard after the label as one under it is", () => {
  standInResizeObserver();
  mount(
    createElement(Harness, {
      groups: [
        [
          { label: "Ada Lovelace", detail: "ada@example.com", onSelect: () => undefined },
          {
            label: "Grace Hopper",
            detail: "grace@example.com",
            detailPlace: MENU_DETAIL.BESIDE,
            onSelect: () => undefined,
          },
        ],
      ],
    }),
  );
  press(button("More"));
  const items = [...(openMenu()?.querySelectorAll('[role="menuitem"]') ?? [])];

  expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
    "Ada Lovelace, ada@example.com",
    "Grace Hopper, grace@example.com",
  ]);
});

test("an item with a card hangs it while the pointer rests on it, and the menu keeps its focus, its arrows, and a press on the card", () => {
  standInResizeObserver();
  mount(
    createElement(Harness, {
      groups: [
        [
          { label: "Rename", onSelect: () => undefined },
          {
            label: "Ada Lovelace",
            card: createElement("p", { className: "person-card" }, "Ada's card"),
            onSelect: () => undefined,
          },
          { label: "Archive", onSelect: () => undefined },
        ],
      ],
    }),
  );
  press(button("More"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  pointerMove(null, button("Ada Lovelace"));
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  const card = document.querySelector<HTMLElement>(".person-card");
  expect(card?.textContent).toBe("Ada's card");
  expect(focused()).toBe("Rename");

  act(() => {
    card?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(openMenu()).not.toBeNull();

  key("ArrowDown");
  expect(focused()).toBe("Ada Lovelace");
  key("ArrowDown");
  expect(focused()).toBe("Archive");
});

test("a card hung from a control on an item's card is the menu's too, so a press on it leaves the menu standing", () => {
  standInResizeObserver();
  const agentCard = createElement(Tooltip, {
    label: "Builder",
    card: createElement("p", { className: "agent-card" }, "Builder's card"),
    children: createElement("button", { type: "button", onClick: () => undefined }, "Builder"),
  });
  mount(
    createElement(Harness, {
      groups: [
        [
          { label: "Rename", onSelect: () => undefined },
          { label: "Ada Lovelace", card: agentCard, onSelect: () => undefined },
        ],
      ],
    }),
  );
  press(button("More"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  pointerMove(null, button("Ada Lovelace"));
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  pointerMove(button("Ada Lovelace"), button("Builder"));
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  const nested = document.querySelector<HTMLElement>(".agent-card");
  expect(nested?.textContent).toBe("Builder's card");

  act(() => {
    nested?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(openMenu()).not.toBeNull();
});

test("a dimmed item is unavailable and takes no press", () => {
  const chosen: Chosen = [];
  mount(createElement(Harness, { groups: taskGroups(chosen) }));
  press(button("More"));
  const move = button("Move");
  expect(move.disabled).toBe(true);
  press(move);
  expect(chosen).toEqual([]);
  expect(openMenu()).not.toBeNull();
});

test("a right-click opens the same menu, and Escape hands focus to what was clicked", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const row = document.querySelector("p") ?? expect.fail("the row is drawn");
  act(() => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 10 }),
    );
  });
  expect(openMenu()).not.toBeNull();
  expect(focused()).toBe("Rename");
  key("Escape");
  expect(openMenu()).toBeNull();
});

test("Right opens a submenu on its first item, and Left or Escape closes it alone, focus back on its item", () => {
  const chosen: Chosen = [];
  mount(createElement(Harness, { groups: viewGroups(chosen) }));
  press(button("More"));
  expect(focused()).toBe("Group by");
  key("ArrowRight");
  expect(openMenu("Group by")).not.toBeNull();
  expect(focused()).toBe("Repository");
  key("ArrowDown");
  expect(focused()).toBe("None");
  key("ArrowLeft");
  expect(openMenu("Group by")).toBeNull();
  expect(focused()).toBe("Group by");

  key("ArrowRight");
  key("Escape");
  expect(openMenu("Group by")).toBeNull();
  expect(openMenu()).not.toBeNull();
  expect(focused()).toBe("Group by");

  key("ArrowRight");
  pressFocused();
  expect(chosen).toEqual(["Repository"]);
  expect(openMenu()).toBeNull();
});

test("resting on one submenu's item after another's opens the second's submenu, with no press", () => {
  mount(createElement(Harness, { groups: viewGroups([]) }));
  press(button("More"));
  pointerMove(null, button("Group by"));
  expect(openMenu("Group by")).not.toBeNull();
  pointerMove(button("Group by"), button("Order by"));
  expect(openMenu("Order by")).not.toBeNull();
  expect(openMenu("Group by")).toBeNull();
  pointerMove(button("Order by"), button("Name"));
  expect(openMenu("Order by")).not.toBeNull();
});

test("a press or Right on an item whose submenu the pointer opened takes the keyboard into it", () => {
  mount(createElement(Harness, { groups: viewGroups([]) }));
  press(button("More"));
  pointerMove(null, button("Group by"));
  expect(openMenu("Group by")).not.toBeNull();
  press(button("Group by"));
  expect(focused()).toBe("Repository");

  key("ArrowLeft");
  pointerMove(null, button("Order by"));
  expect(openMenu("Order by")).not.toBeNull();
  act(() => button("Order by").focus());
  key("ArrowRight");
  expect(focused()).toBe("Last updated");
});

test("a finger's arrival on a submenu's item opens nothing, so iOS spends no tap on it, and the tap opens it with the keyboard in it", () => {
  mount(createElement(Harness, { groups: viewGroups([]) }));
  press(button("More"));
  const item = button("Group by");
  act(() => {
    item.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }));
  });
  expect(openMenu("Group by")).toBeNull();

  press(item);
  expect(openMenu("Group by")).not.toBeNull();
  expect(focused()).toBe("Repository");
});

/** A menu of one submenu whose choice its owner holds: Group by, `chosen` checked. */
function GroupBy({ chosen }: { chosen: string }): React.JSX.Element {
  const menu = useMenu(true);
  const choice = (label: string) => ({ label, checked: label === chosen, onSelect: () => {} });
  return createElement(
    Fragment,
    null,
    createElement("button", { type: "button", ...menu.trigger() }, "More"),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "Plan actions",
          menu: menu.drawn,
          groups: [[{ label: "Group by", items: [choice("Repository"), choice("None")] }]],
          onClose: menu.close,
        }),
  );
}

test("a submenu standing open checks what its owner holds now, though the owner draws it again after it opened", () => {
  mount(createElement(GroupBy, { chosen: "Repository" }));
  press(button("More"));
  press(button("Group by"));
  act(() => roots.at(-1)?.render(createElement(GroupBy, { chosen: "None" })));
  const checked = [...(openMenu("Group by")?.querySelectorAll('[aria-checked="true"]') ?? [])].map(
    (item) => item.textContent,
  );
  expect(checked).toEqual(["None"]);
});

test("a value that stays leaves its menu and submenu standing as it is chosen, where any other choice closes them", () => {
  const chosen: Chosen = [];
  const value = (label: string) => ({ ...action(label, chosen), checked: false, stays: true });
  mount(
    createElement(Harness, {
      groups: [
        [{ label: "Status", items: [value("Todo"), value("Done")] }],
        [action("Clear filters", chosen)],
      ],
    }),
  );
  press(button("More"));
  press(button("Status"));
  press(button("Todo"));
  press(button("Done"));
  expect(chosen).toEqual(["Todo", "Done"]);
  expect(openMenu("Status")).not.toBeNull();
  expect(openMenu()).not.toBeNull();
  press(button("Clear filters"));
  expect(openMenu()).toBeNull();
});

test("the menu key or Shift-F10 on a row opens its menu under it on the first item", () => {
  function Row(): React.JSX.Element {
    const menu = useMenu(true);
    return createElement(
      Fragment,
      null,
      createElement("button", { type: "button", onKeyDown: menu.keyMenu }, "Issue"),
      menu.drawn === undefined
        ? null
        : createElement(Menu, {
            label: "Plan actions",
            menu: menu.drawn,
            groups: taskGroups([]),
            onClose: menu.close,
          }),
    );
  }
  mount(createElement(Row));
  const row = button("Issue");
  act(() => row.focus());
  key("a");
  expect(openMenu()).toBeNull();
  key("ContextMenu");
  expect(openMenu()).not.toBeNull();
  expect(focused()).toBe("Rename");
  key("Escape");
  expect(document.activeElement).toBe(row);
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
  });
  expect(openMenu()).not.toBeNull();
});

/** Pinned rows steered from a field: Effort, opening its list, a Fast switch, and a dimmed Long context. */
function mountSteered(chosen: Chosen) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const steered = (id: string, extra: { expanded?: boolean } = {}) => ({
    id,
    highlighted: id === "effort",
    onHover: () => chosen.push(`hover ${id}`),
    ...extra,
  });
  act(() =>
    root.render(
      createElement(
        Fragment,
        null,
        createElement(MenuItem, {
          action: { label: "Effort", hint: "High", opens: true, onSelect: () => undefined },
          steered: steered("effort", { expanded: true }),
          onChoose: () => chosen.push("effort"),
        }),
        createElement(MenuItem, {
          action: {
            label: "Fast",
            checked: false,
            mark: MENU_ITEM_MARK.SWITCH,
            onSelect: () => undefined,
          },
          steered: steered("fast"),
          onChoose: () => chosen.push("fast"),
        }),
        createElement(MenuItem, {
          action: { label: "Long context", disabled: true, onSelect: () => undefined },
          steered: steered("long"),
          onChoose: () => chosen.push("long"),
        }),
      ),
    ),
  );
  return (id: string) => document.getElementById(id) ?? expect.fail(id);
}

test("an item steered from a field is a switch for a setting, says its list stands, keeps the focus, and a dimmed one takes no press", () => {
  const chosen: Chosen = [];
  const item = mountSteered(chosen);
  const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  act(() => {
    item("fast").dispatchEvent(mousedown);
    item("fast").click();
    item("long").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    item("long").click();
    item("effort").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });

  expect(item("fast").getAttribute("role")).toBe("switch");
  expect(item("fast").getAttribute("aria-checked")).toBe("false");
  expect(item("effort").getAttribute("aria-expanded")).toBe("true");
  expect(item("effort").textContent).toBe("EffortHigh");
  expect(item("long").getAttribute("aria-disabled")).toBe("true");
  expect(mousedown.defaultPrevented).toBe(true);
  expect(chosen).toEqual(["fast", "hover effort"]);
});

/** A row a right-click or a long press opens the task's menu on, whose press is counted in `opened`, with a switch in it that keeps the menu. */
function HeldRow({ opened }: { opened: string[] }): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    Fragment,
    null,
    createElement(
      "div",
      { role: "row", ...menu.contextMenu() },
      createElement("button", { type: "button", onClick: () => opened.push("Row") }, "Row"),
      createElement("button", { type: "button", role: "switch", ...NO_CONTEXT_MENU }, "Switch"),
    ),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "Plan actions",
          menu: menu.drawn,
          groups: taskGroups([]),
          onClose: menu.close,
        }),
  );
}

/** Well past a long press's hold, in milliseconds, so no test leans on its exact length. */
const HELD_MS = 2000;

/** The held row drawn on a fake clock, its row, and the presses the row heard. */
function heldRow() {
  vi.useFakeTimers();
  const opened: string[] = [];
  mount(createElement(HeldRow, { opened }));
  return { row: button("Row"), opened };
}

/** A pointer event of a `pointerType` at `x`, `y`, as the browser sends it. */
function pointer(type: string, pointerType: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
}

/** A press of a `pointerType` going down on `target` at `x`, `y`. */
function down(target: HTMLElement, pointerType: string, x = 40, y = 20): void {
  act(() => {
    target.dispatchEvent(pointer("pointerdown", pointerType, x, y));
  });
}

/** Time passing on the fake clock. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * The press lifted at `x`, `y`, and the click its release makes, as the
 * browser makes it: for a touch, only where its touchend was not refused.
 * Answers whether the release made a click.
 */
function lift(target: HTMLElement, pointerType: string, x = 40, y = 20): boolean {
  const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(pointer("pointerup", pointerType, x, y));
    if (pointerType === "touch") target.dispatchEvent(touchEnd);
    if (touchEnd.defaultPrevented) return;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  return !touchEnd.defaultPrevented;
}

/** Where the open menu hangs, as its positioner places it, once Base UI has placed it. */
async function hungAt(): Promise<[string, string] | undefined> {
  await placed();
  const menu = openMenu();
  const at = /translate\((-?[\d.]+px), (-?[\d.]+px)\)/u.exec(
    menu?.parentElement?.style.transform ?? "",
  );
  return at === null ? undefined : [at[1] ?? "", at[2] ?? ""];
}

/** Base UI's placing settled, which it does over a few promises rather than in the render that opened the menu. */
async function placed(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });
}

test("a touch held still opens the menu where it went down, on its first item, and its release presses nothing", async () => {
  const { row, opened } = heldRow();
  down(row, "touch", 120, 60);
  expect(openMenu()).toBeNull();
  wait(HELD_MS);
  expect(await hungAt()).toEqual(["120px", "60px"]);
  expect(focused()).toBe("Rename");
  expect(lift(row, "touch", 120, 60)).toBe(false);
  expect(opened).toEqual([]);
  expect(openMenu()).not.toBeNull();
});

test("a touch that moves past its slop, scrolls, or lifts before the hold is done opens nothing, and a tap still presses", () => {
  const { row, opened } = heldRow();
  down(row, "touch");
  act(() => {
    row.dispatchEvent(pointer("pointermove", "touch", 40, 40));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  down(row, "touch");
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  down(row, "touch");
  wait(100);
  lift(row, "touch");
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  expect(opened).toEqual(["Row"]);
});

test("a mouse or a pen held down opens nothing, and its click presses as it always has", () => {
  const { row, opened } = heldRow();
  for (const pointerType of ["mouse", "pen"]) {
    down(row, pointerType);
    wait(HELD_MS);
    expect(openMenu()).toBeNull();
    expect(lift(row, pointerType)).toBe(true);
  }
  expect(opened).toEqual(["Row", "Row"]);
});

test("a second finger opens nothing: held alone it starts no hold, and laid down beside a held first finger, as a pinch begins, it lets that hold go", () => {
  const { row, opened } = heldRow();
  const second = (type: string) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
      clientX: 80,
      clientY: 20,
    });
  act(() => {
    row.dispatchEvent(second("pointerdown"));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  act(() => {
    row.dispatchEvent(second("pointerup"));
  });
  down(row, "touch");
  wait(100);
  act(() => {
    row.dispatchEvent(second("pointerdown"));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  expect(opened).toEqual([]);
});

test("the contextmenu Android sends for a hold opens nothing more, whether it comes after the hold's menu or before it", async () => {
  const { row, opened } = heldRow();
  const android = (x: number) =>
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: 20 });
  down(row, "touch", 120, 60);
  wait(HELD_MS);
  key("ArrowDown");
  const after = android(300);
  act(() => {
    row.dispatchEvent(after);
  });
  expect(after.defaultPrevented).toBe(true);
  expect(await hungAt()).toEqual(["120px", "60px"]);
  expect(focused()).toBe("Archive");
  lift(row, "touch", 120, 60);
  key("Escape");
  expect(openMenu()).toBeNull();

  down(row, "touch", 120, 60);
  wait(100);
  act(() => {
    row.dispatchEvent(android(200));
  });
  expect(await hungAt()).toEqual(["200px", "20px"]);
  key("ArrowDown");
  wait(HELD_MS);
  expect(await hungAt()).toEqual(["200px", "20px"]);
  expect(focused()).toBe("Archive");
  lift(row, "touch", 120, 60);
  expect(opened).toEqual([]);
});

test("a row taken away while a touch is held on it leaves no hold behind to open its menu later", () => {
  const { row } = heldRow();
  down(row, "touch");
  for (const root of roots.splice(0)) act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
});

test("a touch a list captures to drag its row opens nothing, dragged, lifted, or resting within the slop; the browser's own capture on the row is no drag", () => {
  const { row } = heldRow();
  const list =
    row.closest('[role="row"]')?.parentElement ?? expect.fail("the row stands in its list");
  down(row, "touch");
  act(() => {
    list.dispatchEvent(pointer("pointermove", "touch", 46, 20));
    list.dispatchEvent(pointer("pointerup", "touch", 46, 20));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  down(row, "touch");
  act(() => {
    list.dispatchEvent(pointer("pointermove", "touch", 80, 20));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  down(row, "touch");
  act(() => {
    list.dispatchEvent(pointer("gotpointercapture", "touch", 44, 20));
  });
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  down(row, "touch");
  act(() => {
    row.dispatchEvent(pointer("gotpointercapture", "touch", 40, 20));
  });
  wait(HELD_MS);
  expect(openMenu()).not.toBeNull();
});

test("a switch in the row that keeps its menu opens nothing, held or right-clicked, while the row beside it still opens on a hold", () => {
  const { row } = heldRow();
  const toggle = button("Switch");
  down(toggle, "touch");
  wait(HELD_MS);
  expect(openMenu()).toBeNull();
  lift(toggle, "touch");
  act(() => {
    toggle.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 10 }),
    );
  });
  expect(openMenu()).toBeNull();
  down(row, "touch");
  wait(HELD_MS);
  expect(openMenu()).not.toBeNull();
});

/** Whether `element` is a menu or the positioner holding one, which a browser lays out the menu's size. */
function menuBox(element: HTMLElement): boolean {
  return (
    element.getAttribute("role") === "menu" ||
    element.querySelector(':scope > [role="menu"]') !== null
  );
}

/** A menu drawn `width` by `height`, and whatever `laid` lays out, as a browser lays it out, though jsdom lays out nothing. */
function menusMeasure(
  width: number,
  height: number,
  laid: (element: HTMLElement) => DOMRect | undefined = () => undefined,
): void {
  const measured = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (menuBox(this)) return new DOMRect(0, 0, width, height);
    return laid(this) ?? measured.call(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return menuBox(this) ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return menuBox(this) ? height : 0;
  });
}

/** A phone's keyboard up: the window as tall as before, only its top `height` seen. */
function keyboardUp(height: number): void {
  const seen = { offsetTop: 0, offsetLeft: 0, width: window.innerWidth, height };
  vi.stubGlobal("visualViewport", Object.assign(new EventTarget(), seen));
}

/** The menu opened by a right-click at `y`, as far down the window as that. */
function rightClickAt(y: number): HTMLElement {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const row = document.querySelector("p") ?? expect.fail("the row is drawn");
  act(() => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: y }),
    );
  });
  return openMenu() ?? expect.fail("the menu is open");
}

test("with a phone's keyboard up, a menu opened near the foot of what is seen stands wholly above the keyboard", async () => {
  vi.stubGlobal("innerHeight", 800);
  menusMeasure(160, 120);
  keyboardUp(400);
  rightClickAt(380);
  const top = Number.parseFloat((await hungAt())?.[1] ?? "");
  expect(top + 120).toBeLessThanOrEqual(400);
});

test("with no visual viewport, a menu opened near the window's foot stands where the window's height lets it", async () => {
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("visualViewport", undefined);
  // Note that the page's root is the window's height, as a browser lays it out, though jsdom lays out nothing.
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth);
  menusMeasure(160, 120);
  rightClickAt(380);
  expect((await hungAt())?.[1]).toBe("380px");
});

/** An 800px window with no visual viewport, as the desktop's is. */
function desktopWindow(): void {
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("visualViewport", undefined);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(window.innerWidth);
}

test("a menu with no room above or below the ⋯ it dropped from stands beside the ⋯, clear of it", async () => {
  desktopWindow();
  // The ⋯ at a row's right end halfway down, under a menu 600px tall that fits neither under nor over it.
  const more = new DOMRect(900, 380, 24, 24);
  menusMeasure(160, 600, (element) => (element.textContent === "More" ? more : undefined));
  mount(createElement(Harness, { groups: taskGroups([]) }));
  act(() => button("More").click());
  const left = Number.parseFloat((await hungAt())?.[0] ?? "");
  expect(left + 160).toBeLessThanOrEqual(more.left);
});

test("a menu with no room below the ⋯ it dropped from, and room above, stands wholly above the ⋯", async () => {
  desktopWindow();
  // The ⋯ at a row's right end near the window's foot, under a menu 300px tall.
  const more = new DOMRect(900, 690, 24, 24);
  menusMeasure(160, 300, (element) => (element.textContent === "More" ? more : undefined));
  mount(createElement(Harness, { groups: taskGroups([]) }));
  act(() => button("More").click());
  const [left = "", top = ""] = (await hungAt()) ?? [];
  expect(Number.parseFloat(top) + 300).toBeLessThanOrEqual(more.top);
  expect(Number.parseFloat(left) + 160).toBe(more.right);
});

test("a menu too tall for the room over a bar it keeps clear of stands above the bar", async () => {
  desktopWindow();
  // A phone's places bar across the window's foot, its top 60px up.
  menusMeasure(160, 300, (element) =>
    element.hasAttribute("data-menu-keeps-clear") ? new DOMRect(0, 740, 1024, 60) : undefined,
  );
  mount(
    createElement(
      Fragment,
      null,
      createElement(Harness, { groups: taskGroups([]) }),
      createElement("nav", MENU_KEEPS_CLEAR, "Places"),
    ),
  );
  const row = document.querySelector("p") ?? expect.fail("the row is drawn");
  act(() => {
    row.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 700 }),
    );
  });
  const top = Number.parseFloat((await hungAt())?.[1] ?? "");
  expect(top + 300).toBeLessThanOrEqual(740);
});

/** The window drawn in a phone's layout, as the panel's shell marks its root. */
function inPhoneLayout(): void {
  document.documentElement.setAttribute("data-luke-room", "narrow");
}

/** jsdom has no ResizeObserver; the way back's fold, which measures by one, is not what these tests read. */
class StandInResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

/** The sheet a menu stands as in a phone's layout, while it does. */
function sheet(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

test("in a phone's layout the menu rises as a sheet, a dialog named by the menu holding its rows; elsewhere it hangs as a floating menu", () => {
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const more = button("More");
  press(more);
  expect(openMenu()).not.toBeNull();
  expect(sheet()).toBeNull();
  press(more);
  inPhoneLayout();
  press(more);
  const standing = sheet() ?? expect.fail("the sheet stands");
  expect(standing.getAttribute("aria-modal")).toBe("true");
  const name = document.getElementById(standing.getAttribute("aria-labelledby") ?? "");
  expect(name?.textContent).toBe("Plan actions");
  expect(standing.contains(openMenu())).toBe(true);
  expect(focused()).toBe("Rename");
  key("ArrowDown");
  expect(focused()).toBe("Archive");
});

test("in a sheet a submenu opens in its place with a way back, which lands on its row again, and a choice in it acts and puts the sheet away", () => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
  inPhoneLayout();
  const chosen: Chosen = [];
  mount(createElement(Harness, { groups: viewGroups(chosen) }));
  const more = button("More");
  press(more);
  press(button("Order by"));
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(openMenu()).toBeNull();
  expect(openMenu("Order by")).not.toBeNull();
  expect(focused()).toBe("Last updated");
  press(button("Plan actions"));
  expect(openMenu("Order by")).toBeNull();
  expect(openMenu()).not.toBeNull();
  expect(focused()).toBe("Order by");
  press(button("Group by"));
  press(button("None"));
  expect(chosen).toEqual(["None"]);
  expect(sheet()).toBeNull();
  expect(document.activeElement).toBe(more);
});

test("Escape or a press on the dimmed window puts a sheet away and hands focus back to what opened it", () => {
  inPhoneLayout();
  mount(createElement(Harness, { groups: taskGroups([]) }));
  const more = button("More");
  press(more);
  key("Escape");
  expect(sheet()).toBeNull();
  expect(document.activeElement).toBe(more);
  press(more);
  const dimmed = sheet()?.parentElement ?? expect.fail("no dimmed window");
  act(() => {
    dimmed.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    dimmed.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(sheet()).toBeNull();
  expect(document.activeElement).toBe(more);
});
