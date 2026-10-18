// @vitest-environment jsdom

import { act, cloneElement, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import {
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  List,
  ListRow,
  type ListRowHint,
} from "./list-row.js";

/**
 * list-row.test.ts -- a row's press and its acts are separate buttons, never
 * one inside the other, and an act is pressed without pressing its row. A
 * row reads as its words, title first, and Tab meets it before its acts; the
 * open one is announced as current, whether it opens something or not; and a
 * row that opens nothing is no control, though its acts still are. A
 * keyboard-driven list can hand focus back to a row through its ref, hear
 * the keys pressed on it, and hear a right-click anywhere on it. A row
 * current as the page beside the list is announced so, and the app's hint
 * hung from a row's press raises its words for the press. A row whose
 * metadata stands on its title's line reads it after the title and before
 * the line under it, and one whose lead names what it belongs to reads it
 * between the two, on the line under the title. A row swiped right rests open on its act's button
 * after a short swipe and does the act on a long one's release, by pointer
 * or by a trackpad's wheel; a cancelled pointer, a swipe whose act changed
 * under it, a swipe left, and a press up or down never act. A row that keeps
 * focus leaves it on the field that held it; one out of the tab order still
 * takes the focus it is handed; one unavailable refuses its press; one a
 * field drives is found by its id; a chevron says nothing to a reader; acts
 * shown on hover are still a Tab stop after the row; and an app hears
 * whether the title is cut short. Synthetic
 * members.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", role: "Owner" },
  { id: "grace", name: "Grace Hopper", role: "Admin" },
] as const;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
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

/** A glyph standing in for an act's icon. */
function glyph(): React.ReactElement {
  return createElement("svg");
}

/** Members whose rows open one and whose ⋯ is pressed, what was pressed listed after them. */
function Members(): React.JSX.Element {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [heard, setHeard] = useState<string[]>([]);
  return createElement(
    "div",
    null,
    createElement(List, {
      label: "Members",
      children: MEMBERS.map((member) =>
        createElement(ListRow, {
          key: member.id,
          leading: glyph(),
          title: member.name,
          description: `${member.id}@example.com`,
          meta: member.role,
          current: open === member.id ? LIST_ROW_CURRENT.ITEM : undefined,
          onPress: () => {
            setOpen(member.id);
            setHeard((all) => [...all, `open ${member.id}`]);
          },
          actions: createElement(IconButton, {
            icon: glyph(),
            label: `More for ${member.id}`,
            onClick: () => setHeard((all) => [...all, `more ${member.id}`]),
          }),
        }),
      ),
    }),
    createElement("output", null, heard.join(",")),
  );
}

/** The button whose words or label are `name`. */
function button(within: HTMLElement, name: string): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(
    (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name,
  );
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
}

function press(target: HTMLElement): void {
  act(() => target.click());
}

test("a row's press and its acts are separate buttons in its item, neither inside the other", () => {
  const container = draw(createElement(Members));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.length).toBe(4);
  for (const each of buttons) {
    expect(each.parentElement?.closest("button")).toBeNull();
  }
  const row = button(container, "Ada Lovelaceada@example.comOwner");
  const more = button(container, "More for ada");
  expect(row.closest("li")).toBe(more.closest("li"));
  expect(container.querySelector("ul")?.getAttribute("aria-label")).toBe("Members");
});

test("pressing an act does not press its row, and pressing a row opens it", () => {
  const container = draw(createElement(Members));
  press(button(container, "More for ada"));
  press(button(container, "Grace Hoppergrace@example.comAdmin"));
  expect(container.querySelector("output")?.textContent).toBe("more ada,open grace");
});

test("the open row is announced as current, and only it", () => {
  const container = draw(createElement(Members));
  const ada = button(container, "Ada Lovelaceada@example.comOwner");
  expect(ada.getAttribute("aria-current")).toBeNull();
  press(ada);
  expect(ada.getAttribute("aria-current")).toBe("true");
  expect(container.querySelectorAll("[aria-current]").length).toBe(1);
});

test("a row reads as its words, title first, its leading mark hidden from a reader", () => {
  const container = draw(createElement(Members));
  const row = button(container, "Ada Lovelaceada@example.comOwner");
  expect(row.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
  // Note that nothing names the row over its words, because a voice says what it sees.
  expect([row.getAttribute("aria-label"), row.getAttribute("aria-labelledby")]).toEqual([
    null,
    null,
  ]);
});

test("a row whose metadata ends its title's line reads it after the title and before the line under it, as a mail app's row is read", () => {
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        description: "ada@example.com",
        meta: "Owner",
        metaAt: LIST_ROW_META.TITLE,
        onPress: () => undefined,
      }),
    }),
  );
  expect(button(container, "Ada LovelaceOwnerada@example.com")).toBeTruthy();
});

test("a row's lead stands on the line under its title, before the description's words, its glyph hidden from a reader and its whole name read though it is drawn cut short", () => {
  const container = draw(
    createElement(List, {
      label: "Threads",
      children: createElement(ListRow, {
        title: "Retry the webhook?",
        description: "Choice · 2 options",
        lead: { icon: glyph(), label: "Billing usage alerts for every workspace" },
        meta: "2h",
        metaAt: LIST_ROW_META.TITLE,
        onPress: () => undefined,
      }),
    }),
  );
  const row = button(
    container,
    "Retry the webhook?2hBilling usage alerts for every workspaceChoice · 2 options",
  );
  const lead = row.querySelector(".luke-list-row-lead");
  expect(lead?.closest(".luke-list-row-description")).not.toBeNull();
  expect(lead?.closest(".luke-list-row-head")).toBeNull();
  expect(lead?.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("Tab meets a row, then its acts, then the next row, none taken out of the order", () => {
  const container = draw(createElement(Members));
  const order = [
    "Ada Lovelaceada@example.comOwner",
    "More for ada",
    "Grace Hoppergrace@example.comAdmin",
    "More for grace",
  ].map((name) => button(container, name));
  expect([...container.querySelectorAll("button")]).toEqual(order);
  for (const each of order) {
    expect(each.tabIndex).toBe(0);
  }
});

test("a row that opens nothing is no control, its acts still are", () => {
  const container = draw(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Nightly review",
        meta: "2h ago",
        actions: createElement(IconButton, { icon: glyph(), label: "Run again" }),
      }),
    }),
  );
  expect(
    [...container.querySelectorAll("button")].map((each) => each.getAttribute("aria-label")),
  ).toEqual(["Run again"]);
  expect(container.querySelector("li")?.textContent).toBe("Nightly review2h ago");
});

test("a row that opens nothing is still announced as current", () => {
  const container = draw(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Running review",
        current: LIST_ROW_CURRENT.ITEM,
      }),
    }),
  );
  const current = container.querySelector('[aria-current="true"]');
  expect(current?.textContent).toBe("Running review");
});

test("focus is handed back to a row's press through its ref", () => {
  let row: HTMLElement | null = null;
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        ref: (element: HTMLElement | null) => {
          row = element;
        },
        title: "Ada Lovelace",
        onPress: () => undefined,
      }),
    }),
  );
  act(() => row?.focus());
  expect(document.activeElement).toBe(button(container, "Ada Lovelace"));
});

test("a row that opens nothing hands its item to its ref", () => {
  let row: HTMLElement | null = null;
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        ref: (element: HTMLElement | null) => {
          row = element;
        },
        title: "Ada Lovelace",
      }),
    }),
  );
  expect(row).toBe(container.querySelector("li"));
});

test("a key pressed on a row reaches its handler, and a right-click anywhere on it reaches its own", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        onPress: () => undefined,
        onKeyDown: (event) => heard.push(`key ${event.key}`),
        onContextMenu: () => heard.push("menu"),
        actions: createElement(IconButton, { icon: glyph(), label: "More for ada" }),
      }),
    }),
  );
  const row = button(container, "Ada Lovelace");
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    button(container, "More for ada").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    );
  });
  expect(heard).toEqual(["key j", "menu", "menu"]);
});

test("a row that opens nothing hears no keys, not even its acts'", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        onKeyDown: (event) => heard.push(`key ${event.key}`),
        actions: createElement(IconButton, { icon: glyph(), label: "More for ada" }),
      }),
    }),
  );
  act(() => {
    button(container, "More for ada").dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
  });
  expect(heard).toEqual([]);
});

test("a row current as the page shown beside the list is announced as the page", () => {
  const container = draw(
    createElement(List, {
      label: "Inbox items",
      children: createElement(ListRow, {
        title: "Review the release",
        current: LIST_ROW_CURRENT.PAGE,
        onPress: () => undefined,
      }),
    }),
  );
  expect(button(container, "Review the release").getAttribute("aria-current")).toBe("page");
});

/** A hint that says its words beside the press while the press holds the keyboard. */
const SayingHint: ListRowHint = ({ label, children }) => {
  const [shown, setShown] = useState(false);
  return createElement(
    "div",
    null,
    cloneElement(children, { onFocus: () => setShown(true), onBlur: () => setShown(false) }),
    shown ? createElement("output", null, label) : null,
  );
};

test("the app's hint hung from a row's press raises its words while the press holds the keyboard, and the press still opens the row", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Inbox items",
      children: createElement(ListRow, {
        title: "Review the release",
        meta: "2h",
        hint: { Hint: SayingHint, label: "Review the release" },
        onPress: () => heard.push("open"),
      }),
    }),
  );
  const row = button(container, "Review the release2h");
  expect(container.querySelector("output")).toBeNull();
  act(() => row.focus());
  expect(container.querySelector("output")?.textContent).toBe("Review the release");
  press(row);
  expect(heard).toEqual(["open"]);
});

test("a row that keeps focus, pressed with the pointer, leaves the focus on the field and is pressed", () => {
  const pressed: string[] = [];
  const container = draw(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Search tools" }),
      createElement(List, {
        label: "Tools",
        children: [
          createElement(ListRow, {
            key: "keeps",
            title: "create_issue",
            keepFocus: true,
            onPress: () => pressed.push("create_issue"),
          }),
          createElement(ListRow, {
            key: "takes",
            title: "list_issues",
            onPress: () => pressed.push("list_issues"),
          }),
        ],
      }),
    ),
  );
  const field = container.querySelector("input");
  if (field === null) throw new Error("not drawn");
  act(() => field.focus());
  // Note that jsdom moves no focus on a mousedown, so the browser's move is read as the press's default action.
  const pointerPress = (row: HTMLButtonElement) => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      row.dispatchEvent(down);
      if (!down.defaultPrevented) row.focus();
      row.click();
    });
  };
  pointerPress(button(container, "create_issue"));
  expect(document.activeElement).toBe(field);
  pointerPress(button(container, "list_issues"));
  expect(document.activeElement).toBe(button(container, "list_issues"));
  expect(pressed).toEqual(["create_issue", "list_issues"]);
});

test("a row out of the tab order is skipped by Tab, yet takes the focus handed to it and its press", () => {
  const pressed: string[] = [];
  let handed: HTMLElement | null = null;
  const container = draw(
    createElement(List, {
      label: "Tools",
      children: createElement(ListRow, {
        title: "create_issue",
        tabbable: false,
        ref: (element: HTMLElement | null) => {
          handed = element;
        },
        onPress: () => pressed.push("create_issue"),
      }),
    }),
  );
  const row = button(container, "create_issue");
  expect(row.tabIndex).toBe(-1);
  act(() => handed?.focus());
  expect(document.activeElement).toBe(row);
  press(row);
  expect(pressed).toEqual(["create_issue"]);
});

test("an unavailable row refuses its press and takes no focus", () => {
  const pressed: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Plans",
      children: createElement(ListRow, {
        title: "Ship the release",
        disabled: true,
        onPress: () => pressed.push("open"),
      }),
    }),
  );
  const row = button(container, "Ship the release");
  press(row);
  act(() => row.focus());
  expect(pressed).toEqual([]);
  expect(document.activeElement).not.toBe(row);
});

test("a field driving the list names a row by its id, which finds that row's words", () => {
  const container = draw(
    createElement(
      "div",
      null,
      createElement("input", { "aria-label": "Search tools", "aria-activedescendant": "tool-1" }),
      createElement(List, {
        label: "Tools",
        children: [
          createElement(ListRow, { key: "0", id: "tool-0", title: "create_issue" }),
          createElement(ListRow, { key: "1", id: "tool-1", title: "list_issues" }),
        ],
      }),
    ),
  );
  const active = container.querySelector("input")?.getAttribute("aria-activedescendant");
  expect(document.getElementById(active ?? "")?.textContent).toBe("list_issues");
});

test("a row's chevron says nothing to a reader, so the row still reads as its words", () => {
  const container = draw(
    createElement(List, {
      label: "Tools",
      children: createElement(ListRow, {
        title: "create_issue",
        description: "Opens an issue",
        chevron: true,
        onPress: () => undefined,
      }),
    }),
  );
  const row = button(container, "create_issueOpens an issue");
  expect(row.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("acts shown only on hover are still met by Tab after their row, and pressed without it", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Shells",
      children: createElement(ListRow, {
        title: "zsh",
        meta: "Running",
        actionsAt: LIST_ROW_ACTIONS.HOVER,
        onPress: () => heard.push("show"),
        actions: createElement(IconButton, {
          icon: glyph(),
          label: "End zsh",
          onClick: () => heard.push("end"),
        }),
      }),
    }),
  );
  const order = [button(container, "zshRunning"), button(container, "End zsh")];
  expect([...container.querySelectorAll("button")]).toEqual(order);
  press(button(container, "End zsh"));
  expect(heard).toEqual(["end"]);
});

test("an app hears whether a row's title is cut short, whenever its box resizes", () => {
  const heard: boolean[] = [];
  let resized: () => void = () => undefined;
  // Note that jsdom lays nothing out, so the observer and the widths it would measure are the stand-ins here.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
  let width = 120;
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  draw(
    createElement(List, {
      label: "Pull requests",
      children: createElement(ListRow, {
        title: "Draw the sidebar's rows with the shared ListRow",
        onPress: () => undefined,
        onTitleClipped: (clipped: boolean) => heard.push(clipped),
      }),
    }),
  );
  act(() => resized());
  width = 320;
  act(() => resized());
  expect(heard).toEqual([false, true]);
});

/** How wide the swiped row stands, in CSS pixels: its act's line at 60% is 180px. */
const ROW_WIDTH = 300;

/** A row offering one swipe, its act's words `label`, each act counted in `acted`; and the row's press, counted in `opened`. */
function SwipedRow({
  label,
  acted,
  opened,
}: {
  label: string;
  acted: string[];
  opened: string[];
}): React.JSX.Element {
  return createElement(List, {
    label: "Inbox",
    children: createElement(ListRow, {
      title: "Alert at 80%?",
      onPress: () => opened.push("open"),
      actions: createElement(IconButton, {
        icon: glyph(),
        label: "Mark as read",
        onClick: () => acted.push("hover mark"),
      }),
      swipe: { label, icon: glyph(), onAct: () => acted.push(label) },
    }),
  });
}

/** A swiped row drawn, its item measured `ROW_WIDTH` wide and its pointer captured as the window would; and how to draw it again with another act. */
function swiped(label = "Read") {
  const acted: string[] = [];
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (words: string) =>
    act(() => root.render(createElement(SwipedRow, { label: words, acted, opened })));
  draw(label);
  const item = container.querySelector<HTMLLIElement>("li") ?? expect.fail("the row stands");
  vi.spyOn(item, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: ROW_WIDTH, height: 56 }),
  );
  Object.assign(item, { setPointerCapture: () => undefined });
  const press =
    item.querySelector<HTMLElement>("button.luke-list-row-main") ?? expect.fail("press");
  return { container, item, press, acted, opened, redraw: draw };
}

/** An event stamped as the window would have stamped it, `at` milliseconds in. */
function stamped<E extends Event>(event: E, at: number): E {
  Object.defineProperty(event, "timeStamp", { value: at });
  return event;
}

/**
 * A pointer event of the first pointer at `x`, `y`, stamped `at` milliseconds
 * in. Note that every one is stamped, at one instant unless a test says
 * otherwise, because the swipe reads the hand's speed off the stamps and
 * jsdom's own come off the wall clock, so a busy machine would make a slow
 * drag a flick; and never at 0, which React reads as no stamp and replaces
 * with the wall clock's.
 */
function pointer(type: string, x: number, y = 10, at = 1): PointerEvent {
  return stamped(
    new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    at,
  );
}

/** A press on `target` dragged right by each of `steps` in turn, from x 10, left held down. */
function drag(target: HTMLElement, ...steps: number[]): void {
  act(() => {
    target.dispatchEvent(pointer("pointerdown", 10));
  });
  for (const step of steps) {
    act(() => {
      target.dispatchEvent(pointer("pointermove", 10 + step));
    });
  }
}

/** The click a pointer's release makes, a press's first, which a keyboard's click is not. */
function pointerClick(): MouseEvent {
  return new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1 });
}

/** The pointer let go at `dx` right of where it pressed, and the click its release makes on `target`. */
function release(target: HTMLElement, dx: number): void {
  act(() => {
    target.dispatchEvent(pointer("pointerup", 10 + dx));
    target.dispatchEvent(pointerClick());
  });
}

/** Where a swiped row stands, how far it is out, and whether it is armed. */
function standing(item: HTMLElement): [string | undefined, string, boolean] {
  return [
    item.dataset.swipe,
    item.style.getPropertyValue("--luke-list-row-swipe"),
    item.dataset.armed === "true",
  ];
}

test("a short swipe right leaves the row open on its act's button, which a click presses once, closing the row; the release opens nothing", () => {
  const { item, press, acted, opened } = swiped();
  drag(press, 10, 40);
  expect(standing(item)).toEqual(["moving", "40px", false]);
  release(press, 40);
  expect(standing(item)).toEqual(["open", "72px", false]);
  expect([acted, opened]).toEqual([[], []]);
  const button =
    item.querySelector<HTMLButtonElement>("button[data-swipe-act]") ?? expect.fail("button");
  expect(button.textContent).toBe("Read");
  act(() => {
    button.dispatchEvent(pointer("pointerdown", 30));
    button.click();
  });
  expect([acted, opened]).toEqual([["Read"], []]);
  expect(standing(item)).toEqual(["rest", "0px", false]);
});

test("a long swipe, past 60% of the row, arms it and acts on release with no click; pulled back under that line first, it rests open instead", () => {
  const long = swiped();
  drag(long.press, 20, 120, 200);
  expect(standing(long.item)).toEqual(["moving", "200px", true]);
  release(long.press, 200);
  expect([long.acted, long.opened]).toEqual([["Read"], []]);
  expect(standing(long.item)).toEqual(["rest", "0px", false]);

  const back = swiped();
  drag(back.press, 20, 200, 120);
  expect(standing(back.item)).toEqual(["moving", "120px", false]);
  release(back.press, 120);
  expect([back.acted, back.opened]).toEqual([[], []]);
  expect(standing(back.item)).toEqual(["open", "72px", false]);
});

test("a swipe let go short of 24px, swiped left, or pressed up or down closes without acting, and a press that never moved is a click on the row", () => {
  const short = swiped();
  drag(short.press, 10, 20);
  release(short.press, 20);
  expect(standing(short.item)).toEqual(["rest", "0px", false]);

  const left = swiped();
  drag(left.press, -10, -80);
  expect(standing(left.item)).toEqual(["moving", "0px", false]);
  release(left.press, -80);
  expect(standing(left.item)).toEqual(["rest", "0px", false]);

  const down = swiped();
  act(() => {
    down.press.dispatchEvent(pointer("pointerdown", 10, 10));
    down.press.dispatchEvent(pointer("pointermove", 16, 60));
    down.press.dispatchEvent(pointer("pointermove", 100, 60));
  });
  expect(standing(down.item)).toEqual(["rest", "0px", false]);

  const still = swiped();
  act(() => {
    still.press.dispatchEvent(pointer("pointerdown", 10));
  });
  release(still.press, 0);
  expect([short.acted, left.acted, down.acted, still.acted]).toEqual([[], [], [], []]);
  expect(still.opened).toEqual(["open"]);
});

test("a pointer the system takes away never acts, however far it swiped, and the row closes", () => {
  const { item, press, acted } = swiped();
  drag(press, 20, 250);
  act(() => {
    press.dispatchEvent(pointer("pointercancel", 260));
  });
  expect(standing(item)).toEqual(["rest", "0px", false]);
  release(press, 260);
  expect(acted).toEqual([]);
});

test("a row redrawn with another act mid-swipe does nothing on release, and an open row whose act changes closes", () => {
  const moving = swiped("Read");
  drag(moving.press, 20, 250);
  moving.redraw("Unread");
  release(moving.press, 250);
  expect(moving.acted).toEqual([]);
  expect(standing(moving.item)).toEqual(["rest", "0px", false]);

  const open = swiped("Read");
  drag(open.press, 10, 40);
  release(open.press, 40);
  expect(standing(open.item)[0]).toBe("open");
  open.redraw("Unread");
  expect(standing(open.item)).toEqual(["rest", "0px", false]);
});

test("an open row closes on a press anywhere else, or on a click on the row itself, which opens nothing", () => {
  const elsewhere = swiped();
  drag(elsewhere.press, 10, 40);
  release(elsewhere.press, 40);
  act(() => {
    document.body.dispatchEvent(pointer("pointerdown", 400));
  });
  expect(standing(elsewhere.item)).toEqual(["rest", "0px", false]);

  const itself = swiped();
  drag(itself.press, 10, 40);
  release(itself.press, 40);
  act(() => {
    itself.press.dispatchEvent(pointer("pointerdown", 10));
  });
  release(itself.press, 0);
  expect(standing(itself.item)).toEqual(["rest", "0px", false]);
  expect([itself.acted, itself.opened]).toEqual([[], []]);
});

/** A trackpad over the window's frames: its wheel turned on an item, answering whether the event was kept from the list, and the frames asked for run at a time given, as the window draws one. */
function trackpad() {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const frameAt = (time: number) =>
    act(() => {
      for (const frame of frames.splice(0)) frame(time);
    });
  const wheel = (item: HTMLElement, deltaX: number, deltaY = 0, at = 1): boolean => {
    const event = stamped(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY }),
      at,
    );
    act(() => {
      item.dispatchEvent(event);
    });
    return event.defaultPrevented;
  };
  return { frameAt, wheel };
}

test("a trackpad's two-finger swipe moves the row by its sideways wheel and is let go once the wheel rests: a short one rests open, a long one acts; a wheel up or down is the list's", () => {
  const { frameAt, wheel } = trackpad();
  const short = swiped();
  wheel(short.item, 0, 30);
  expect(standing(short.item)).toEqual(["rest", "0px", false]);
  // The scroll rests before the swipe begins.
  frameAt(500);
  frameAt(700);
  wheel(short.item, -20);
  wheel(short.item, -20);
  expect(standing(short.item)).toEqual(["moving", "40px", false]);
  frameAt(1_000);
  frameAt(1_100);
  expect(standing(short.item)[0]).toBe("moving");
  frameAt(1_140);
  expect(standing(short.item)).toEqual(["open", "72px", false]);

  const long = swiped();
  wheel(long.item, -120);
  frameAt(2_000);
  wheel(long.item, -100);
  expect(standing(long.item)).toEqual(["moving", "220px", true]);
  frameAt(2_100);
  frameAt(2_200);
  expect(long.acted).toEqual([]);
  frameAt(2_240);
  expect(long.acted).toEqual(["Read"]);
  expect(standing(long.item)).toEqual(["rest", "0px", false]);
});

test("a row that offers no swipe draws none and hears a press as a click", () => {
  const container = draw(createElement(Members));
  expect(container.querySelector("li[data-swipe], [data-swipe-act]")).toBeNull();
});

test("an open row's own acts take their click, the row's swipe doing nothing", () => {
  const { item, press, acted, opened } = swiped();
  drag(press, 10, 40);
  release(press, 40);
  const mark =
    item.querySelector<HTMLButtonElement>(".luke-list-row-actions button") ?? expect.fail("act");
  act(() => {
    mark.dispatchEvent(pointer("pointerdown", 250));
    mark.dispatchEvent(pointer("pointerup", 250));
    mark.dispatchEvent(pointerClick());
  });
  expect([acted, opened]).toEqual([["hover mark"], []]);
});

test("a trackpad's swipe a press interrupts, on the row or anywhere else, does nothing once its wheel rests", () => {
  const { frameAt, wheel } = trackpad();
  const elsewhere = swiped();
  wheel(elsewhere.item, -220);
  act(() => {
    document.body.dispatchEvent(pointer("pointerdown", 400));
  });
  expect(standing(elsewhere.item)).toEqual(["rest", "0px", false]);
  const onRow = swiped();
  wheel(onRow.item, -220);
  act(() => {
    onRow.press.dispatchEvent(pointer("pointerdown", 10));
  });
  frameAt(1_000);
  frameAt(1_200);
  frameAt(1_400);
  expect([elsewhere.acted, onRow.acted]).toEqual([[], []]);
});

test("a wheel more up or down than sideways is the list's to scroll while a trackpad's swipe is under way, and leaves the row where it stands", () => {
  const { wheel } = trackpad();
  const { item } = swiped();
  expect(wheel(item, -40)).toBe(true);
  expect(wheel(item, 0, 40)).toBe(false);
  expect(wheel(item, -5, 30)).toBe(false);
  expect(standing(item)).toEqual(["moving", "40px", false]);
});

test("a pointer's swipe interrupted by a press or a wheel elsewhere does nothing when it is let go, and opens nothing", () => {
  for (const interrupt of ["pointerdown", "wheel"] as const) {
    const { item, press, acted, opened } = swiped();
    drag(press, 20, 200);
    expect(standing(item)).toEqual(["moving", "200px", true]);
    act(() => {
      document.body.dispatchEvent(
        interrupt === "wheel"
          ? new WheelEvent("wheel", { bubbles: true, deltaX: 0, deltaY: 30 })
          : new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              clientX: 400,
              pointerId: 2,
            }),
      );
    });
    expect(standing(item)).toEqual(["rest", "0px", false]);
    release(press, 200);
    expect([acted, opened]).toEqual([[], []]);
  }
});

test("a pointer's swipe interrupted and let go off the row leaves no click to swallow, so the keyboard still opens the row", () => {
  const { item, press, acted, opened } = swiped();
  drag(press, 20, 200);
  act(() => {
    document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaX: 0, deltaY: 30 }));
    document.body.dispatchEvent(pointer("pointerup", 500));
  });
  expect(standing(item)).toEqual(["rest", "0px", false]);
  // Note that a keyboard's click comes with no press before it, and a detail of 0.
  act(() => press.click());
  expect([acted, opened]).toEqual([[], ["open"]]);
});

/** A press on `target` moved through each `[dx, at]` in turn, from x 10, then let go at the last. */
function flick(target: HTMLElement, ...moves: [number, number][]): void {
  act(() => {
    target.dispatchEvent(pointer("pointerdown", 10));
  });
  for (const [dx, at] of moves) {
    act(() => {
      target.dispatchEvent(pointer("pointermove", 10 + dx, 10, at));
    });
  }
  const [dx, at] = moves[moves.length - 1] ?? [0, 0];
  act(() => {
    target.dispatchEvent(pointer("pointerup", 10 + dx, 10, at + 4));
    target.dispatchEvent(pointerClick());
  });
}

test("a flick carries a release along its speed: let go short of the line, a fast swipe right acts; let go past where it would open, a fast swipe back closes", () => {
  const thrown = swiped();
  flick(thrown.press, [20, 10], [60, 20], [140, 30], [150, 32]);
  expect(thrown.acted).toEqual(["Read"]);
  expect(standing(thrown.item)).toEqual(["rest", "0px", false]);

  const pulled = swiped();
  flick(pulled.press, [100, 100], [110, 200], [60, 210], [30, 220]);
  expect([pulled.acted, standing(pulled.item)]).toEqual([[], ["rest", "0px", false]]);

  const slow = swiped();
  flick(slow.press, [20, 100], [60, 400], [150, 900]);
  expect([slow.acted, standing(slow.item)]).toEqual([[], ["open", "72px", false]]);
});

test("past 85% of the row the row gives, going on with a third of the hand's travel", () => {
  const { item, press } = swiped();
  drag(press, 20, 300);
  expect(standing(item)).toEqual(["moving", "270.75px", true]);
});

test("a trackpad movement that begins up or down stays the list's until its wheel rests, however sideways it turns; a sideways one begins a swipe only once it leans sideways 5px, and twice as far as up or down", () => {
  const { frameAt, wheel } = trackpad();
  const { item } = swiped();
  expect(wheel(item, 0, 20)).toBe(false);
  expect(wheel(item, -60)).toBe(false);
  expect(standing(item)).toEqual(["rest", "0px", false]);
  frameAt(1_000);
  frameAt(1_200);

  expect(wheel(item, -4)).toBe(false);
  expect(standing(item)[0]).toBe("rest");
  expect(wheel(item, -3)).toBe(true);
  expect(standing(item)).toEqual(["moving", "7px", false]);
  frameAt(2_000);
  frameAt(2_200);

  expect(wheel(item, -6, -4)).toBe(false);
  expect(standing(item)[0]).toBe("rest");
  expect(wheel(item, -6)).toBe(true);
  expect(standing(item)).toEqual(["moving", "12px", false]);
});

test("a trackpad's deltas shrinking five times in a row are the fingers lifted: the swipe is let go at once, a long one acting and a short one resting open, and the coast that follows moves nothing", () => {
  const { frameAt, wheel } = trackpad();
  const long = swiped();
  for (const delta of [-60, -60, -60, -50, -40, -30, -20]) wheel(long.item, delta);
  expect(long.acted).toEqual([]);
  wheel(long.item, -10);
  expect(long.acted).toEqual(["Read"]);
  expect(standing(long.item)).toEqual(["rest", "0px", false]);
  expect(wheel(long.item, -5)).toBe(true);
  expect(standing(long.item)).toEqual(["rest", "0px", false]);
  frameAt(1_000);
  frameAt(1_200);
  expect(long.acted).toEqual(["Read"]);

  const short = swiped();
  for (const delta of [-30, -8, -6, -4, -2, -1]) wheel(short.item, delta);
  expect(standing(short.item)).toEqual(["open", "72px", false]);
  expect(short.acted).toEqual([]);
});

test("a trackpad's swipe on an open row starts from where it rests, goes the hand's way past the give however it is fed, and a flick let go when the wheel rests carries as a pointer's does", () => {
  const { frameAt, wheel } = trackpad();
  const open = swiped();
  drag(open.press, 10, 40);
  release(open.press, 40);
  expect(standing(open.item)).toEqual(["open", "72px", false]);
  wheel(open.item, -5);
  expect(standing(open.item)).toEqual(["moving", "77px", false]);

  const far = swiped();
  wheel(far.item, -300);
  expect(standing(far.item)).toEqual(["moving", "270.75px", true]);
  wheel(far.item, -10);
  expect(standing(far.item)).toEqual(["moving", "274.25px", true]);

  const flicked = swiped();
  wheel(flicked.item, -60, 0, 100);
  wheel(flicked.item, -60, 0, 110);
  wheel(flicked.item, -50, 0, 120);
  frameAt(1_000);
  frameAt(1_200);
  expect(flicked.acted).toEqual(["Read"]);
});

test("a scroll that follows a quick trackpad swipe ends its flick, so the row only opens once the wheel rests, never acting", () => {
  const { frameAt, wheel } = trackpad();
  const { item, acted } = swiped();
  wheel(item, -60, 0, 100);
  wheel(item, -60, 0, 110);
  wheel(item, -50, 0, 120);
  expect(wheel(item, 0, 40, 130)).toBe(false);
  expect(wheel(item, 2, 60, 140)).toBe(false);
  frameAt(1_000);
  frameAt(1_200);
  expect([acted, standing(item)]).toEqual([[], ["open", "72px", false]]);
});
