// @vitest-environment jsdom

import { act, cloneElement, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import { useRovingKeys } from "../roving-keys/roving-keys.js";
import {
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListRow,
  type ListRowHint,
} from "./list-row.js";

/**
 * list-row.test.ts -- a row's press and its acts are separate buttons, never
 * one inside the other, and an act is pressed without pressing its row. A
 * row reads as its words, title first, and Tab meets it before its acts. A
 * list is one Tab stop, at its first row or the one last focused: ↑↓ step
 * between its rows and wrap at the ends, Home and End go to the first and
 * the last, an unavailable row is stepped over, an arrow held with a
 * modifier is left to the app, and a row that says its own Tab stop is left
 * out of the walk. The
 * open one is announced as current, whether it opens something or not; and a
 * row that opens nothing is no control, though its acts still are. A
 * keyboard-driven list can hand focus back to a row through its ref, hear
 * the keys pressed on it. A row
 * current as the page beside the list is announced so, and the app's hint
 * hung from a row's press raises its words for the press. A row whose
 * metadata stands on its title's line reads it after the title and before
 * the line under it, and one whose lead names what it belongs to reads it
 * between the two, on the line under the title, before the description's
 * words or on a line of its own. A row that keeps
 * focus leaves it on the field that held it; one out of the tab order still
 * takes the focus it is handed; one unavailable refuses its press; one a
 * field drives is found by its id; a chevron says nothing to a reader; acts
 * shown on hover are still a Tab stop after the row; and an app hears
 * whether the title is cut short. Synthetic members.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { id: "ada", name: "Ada Lovelace", role: "Owner" },
  { id: "grace", name: "Grace Hopper", role: "Admin" },
] as const;

/** A handler that hears nothing a test asks about. */
const ignore = () => undefined;

const roots: Root[] = [];

// Note that every row measures its title, so each test draws beside a
// ResizeObserver, which jsdom lacks; one that resizes stubs its own.
beforeEach(() => {
  standInResizeObserver();
});

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

/** The buttons Tab stops on, in the order it meets them. */
function tabStops(within: HTMLElement): HTMLButtonElement[] {
  return [...within.querySelectorAll<HTMLButtonElement>(".luke-list button")].filter(
    (each) => each.tabIndex >= 0 && !each.disabled,
  );
}

/** Presses `name` on whatever holds the focus, as the keyboard would. */
function key(name: string, held: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...held }),
    );
  });
}

/** A list of places, each a row that opens it, those named in `off` unavailable. */
function walked(names: readonly string[], off: readonly string[] = []): React.ReactElement {
  return createElement(List, {
    label: "Places",
    children: names.map((name) =>
      createElement(ListRow, {
        key: name,
        title: name,
        disabled: off.includes(name),
        onPress: ignore,
      }),
    ),
  });
}

/** Places, each with a button beside the list that turns its row unavailable. */
function Unavailable({ names }: { names: readonly string[] }): React.JSX.Element {
  const [off, setOff] = useState<readonly string[]>([]);
  return createElement(
    Fragment,
    null,
    walked(names, off),
    ...names.map((name) =>
      createElement(
        "button",
        { key: name, type: "button", onClick: () => setOff((all) => [...all, name]) },
        `Turn off ${name}`,
      ),
    ),
  );
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

test("a row's acts are a group named by its title, so a reader hears which row's they are", () => {
  const container = draw(createElement(Members));
  const group = button(container, "More for grace").closest('[role="group"]');
  const named = document.getElementById(group?.getAttribute("aria-labelledby") ?? "");
  expect(named?.textContent).toBe("Grace Hopper");
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
  expect(lead?.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("a row's lead may stand on a line of its own over its title, read first with the time at its end, then the title, then the description", () => {
  const container = draw(
    createElement(List, {
      label: "Threads",
      children: createElement(ListRow, {
        title: "Retry the webhook?",
        description: "Choice · 2 options",
        lead: { icon: glyph(), label: "Billing usage alerts for every workspace" },
        leadAt: LIST_ROW_LEAD.ABOVE,
        meta: "2h",
        metaAt: LIST_ROW_META.TITLE,
        onPress: () => undefined,
      }),
    }),
  );
  const row = button(
    container,
    "Billing usage alerts for every workspace2hRetry the webhook?Choice · 2 options",
  );
  const lead = row.querySelector(".luke-list-row-lead");
  expect(lead?.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("a row's lead may lead its description in plain words, read before the description after a middle dot", () => {
  const container = draw(
    createElement(List, {
      label: "Runs",
      children: createElement(ListRow, {
        title: "Fix the flaky test",
        description: "Finished",
        lead: { icon: glyph(), label: "Nightly flaky-test sweep" },
        leadAt: LIST_ROW_LEAD.INLINE,
        meta: "2h",
        onPress: () => undefined,
      }),
    }),
  );
  const row = button(container, "Fix the flaky testNightly flaky-test sweep · Finished2h");
  const lead = row.querySelector(".luke-list-row-lead");
  expect(lead?.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();
});

test("a row whose lead stands on a line of its own draws it with no description under it", () => {
  const container = draw(
    createElement(List, {
      label: "Threads",
      children: createElement(ListRow, {
        title: "Retry the webhook?",
        lead: { icon: glyph(), label: "Billing usage alerts" },
        leadAt: LIST_ROW_LEAD.ABOVE,
        onPress: () => undefined,
      }),
    }),
  );
  expect(button(container, "Billing usage alertsRetry the webhook?")).toBeTruthy();
});

test("Tab meets the list's one row, then each row's acts, the other rows left to the arrows", () => {
  const container = draw(createElement(Members));
  const order = [
    "Ada Lovelaceada@example.comOwner",
    "More for ada",
    "Grace Hoppergrace@example.comAdmin",
    "More for grace",
  ].map((name) => button(container, name));
  expect([...container.querySelectorAll("button")]).toEqual(order);
  expect(tabStops(container)).toEqual([order[0], order[1], order[3]]);
});

test("Tab enters a list once, at its first row, and comes back to the row it left", () => {
  const container = draw(walked(["Inbox", "Tasks", "Board"]));
  expect(tabStops(container)).toEqual([button(container, "Inbox")]);
  act(() => button(container, "Inbox").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "Tasks"));
  expect(tabStops(container)).toEqual([button(container, "Tasks")]);
});

test("↑↓ step between rows, Home and End go to the first and the last", () => {
  const container = draw(walked(["Inbox", "Tasks", "Board", "Automations"]));
  act(() => button(container, "Inbox").focus());
  const visited = ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"].map((name) => {
    key(name);
    return document.activeElement?.textContent;
  });
  expect(visited).toEqual(["Tasks", "Board", "Tasks", "Automations", "Inbox"]);
});

test("the arrows wrap from the last row to the first and back", () => {
  const container = draw(walked(["Inbox", "Tasks", "Board"]));
  act(() => button(container, "Board").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "Inbox"));
  key("ArrowUp");
  expect(document.activeElement).toBe(button(container, "Board"));
});

test("an unavailable row is stepped over and is never the Tab stop", () => {
  const container = draw(walked(["Inbox", "Tasks", "Board", "Automations"], ["Inbox", "Board"]));
  expect(tabStops(container)).toEqual([button(container, "Tasks")]);
  act(() => button(container, "Tasks").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "Automations"));
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "Tasks"));
  key("Home");
  expect(document.activeElement).toBe(button(container, "Tasks"));
});

test("the Tab stop moves on when its row turns unavailable", async () => {
  const container = draw(createElement(Unavailable, { names: ["Inbox", "Tasks", "Board"] }));
  expect(tabStops(container)).toEqual([button(container, "Inbox")]);
  await act(async () => button(container, "Turn off Inbox").click());
  expect(tabStops(container)).toEqual([button(container, "Tasks")]);
});

test("an arrow held with ⌘, ⌥, Ctrl, or ⇧ is left to the app's own shortcut", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(
      "div",
      { onKeyDown: (event: React.KeyboardEvent) => heard.push(String(event.defaultPrevented)) },
      walked(["Inbox", "Tasks", "Board"]),
    ),
  );
  act(() => button(container, "Inbox").focus());
  for (const held of ["metaKey", "altKey", "ctrlKey", "shiftKey"] as const) {
    key("ArrowDown", { [held]: true });
  }
  expect(document.activeElement).toBe(button(container, "Inbox"));
  expect(heard).toEqual(["false", "false", "false", "false"]);
});

test("a row that says its own Tab stop is left out of the arrows' walk", () => {
  const container = draw(
    createElement(List, {
      label: "Tools",
      children: ["create_issue", "list_issues"].map((name) =>
        createElement(ListRow, { key: name, title: name, tabbable: false, onPress: ignore }),
      ),
    }),
  );
  expect(tabStops(container)).toEqual([]);
  act(() => button(container, "create_issue").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "create_issue"));
});

/** Two lists of places in one box, as a rail's groups stand, whose rows join the box's walk. */
function Rail(): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>();
  return createElement(
    "div",
    roving,
    ...[
      ["Inbox", "Tasks"],
      ["General", "Launch"],
    ].map((names, at) =>
      createElement(List, {
        key: at,
        label: `Group ${at + 1}`,
        joinsWalk: true,
        children: names.map((name) =>
          createElement(ListRow, { key: name, title: name, onPress: ignore }),
        ),
      }),
    ),
  );
}

test("lists that join the walk of a box around them are one Tab stop the arrows walk from list to list", () => {
  const container = draw(createElement(Rail));
  expect(tabStops(container)).toEqual([button(container, "Inbox")]);
  act(() => button(container, "Tasks").focus());
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "General"));
  expect(tabStops(container)).toEqual([button(container, "General")]);
  key("End");
  expect(document.activeElement).toBe(button(container, "Launch"));
  key("ArrowDown");
  expect(document.activeElement).toBe(button(container, "Inbox"));
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

test("a key pressed on a row reaches its handler", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(List, {
      label: "Members",
      children: createElement(ListRow, {
        title: "Ada Lovelace",
        onPress: () => undefined,
        onKeyDown: (event) => heard.push(`key ${event.key}`),
        actions: createElement(IconButton, { icon: glyph(), label: "More for ada" }),
      }),
    }),
  );
  act(() => {
    button(container, "Ada Lovelace").dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", bubbles: true }),
    );
  });
  expect(heard).toEqual(["key j"]);
});

/** A parent row folding the rows nested under it, what was pressed listed after it. */
function Folding(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  const child = createElement(ListRow, {
    key: "child",
    title: "Child",
    depth: 1,
    onPress: ignore,
  });
  return createElement(
    "div",
    null,
    createElement(List, {
      label: "Tasks",
      children: [
        createElement(ListRow, {
          key: "parent",
          title: "Parent",
          onPress: () => setHeard((all) => [...all, "open parent"]),
          fold: {
            open,
            onOpenChange: (asked: boolean) => {
              setOpen(asked);
              setHeard((all) => [...all, asked ? "unfold" : "fold"]);
            },
            label: "Child tasks of Parent",
          },
        }),
        ...(open ? [child] : []),
      ],
    }),
    createElement("output", null, heard.join(",")),
  );
}

test("a row's fold is a control beside its press, saying whether its rows stand open, pressed without opening the row, and moved by → and ← on the row", () => {
  const container = draw(createElement(Folding));
  const fold = button(container, "Child tasks of Parent");
  expect(fold.closest("button")?.parentElement?.closest("button")).toBeNull();
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  press(fold);
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  expect(button(container, "Child").closest("li")).not.toBeNull();
  act(() => button(container, "Parent").focus());
  key("ArrowRight");
  key("ArrowLeft");
  expect(fold.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("output")?.textContent).toBe("unfold,fold");
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

/**
 * Stands in for the browser's ResizeObserver, which jsdom lacks, since it
 * lays nothing out: the widths it would measure are stubbed by each test,
 * and the function handed back fires every observer still watching, as a
 * resize would.
 */
function standInResizeObserver(): () => void {
  const watching = new Set<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      observe(): void {
        watching.add(this.#callback);
      }
      disconnect(): void {
        watching.delete(this.#callback);
      }
    },
  );
  return () => {
    for (const callback of [...watching]) callback();
  };
}

test("acts shown only on hover are still met by Tab after their row, and pressed without it", () => {
  standInResizeObserver();
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
  const resized = standInResizeObserver();
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
