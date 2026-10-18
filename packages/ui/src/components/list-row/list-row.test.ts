// @vitest-environment jsdom

import { act, cloneElement, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import { ACTIONS_SHOWN, LIST_ROW_CURRENT, List, ListRow, type ListRowHint } from "./list-row.js";

/**
 * list-row.test.ts -- a row's press and its acts are separate buttons, never
 * one inside the other, and an act is pressed without pressing its row. A
 * row reads as its words, title first, and Tab meets it before its acts; the
 * open one is announced as current, whether it opens something or not; and a
 * row that opens nothing is no control, though its acts still are. A
 * keyboard-driven list can hand focus back to a row through its ref, hear
 * the keys pressed on it, and hear a right-click anywhere on it. A row
 * current as the page beside the list is announced so, and the app's hint
 * hung from a row's press raises its words for the press. A row that keeps
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
        actionsShown: ACTIONS_SHOWN.ON_HOVER,
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
