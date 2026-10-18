// @vitest-environment jsdom

import { act, cloneElement, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { IconButton } from "../button/button.js";
import { LIST_ROW_CURRENT, LIST_ROW_META, List, ListRow, type ListRowHint } from "./list-row.js";

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
 * the line under it. A row swiped right rests open on its act's button
 * after a short swipe and does the act on a long one's release, by pointer
 * or by a trackpad's wheel; a cancelled pointer, a swipe whose act changed
 * under it, a swipe left, and a press up or down never act. Synthetic
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

/** A pointer event of the first pointer at `x`, `y`. */
function pointer(type: string, x: number, y = 10): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });
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

/** The pointer let go at `dx` right of where it pressed, and the click its release makes on `target`. */
function release(target: HTMLElement, dx: number): void {
  act(() => {
    target.dispatchEvent(pointer("pointerup", 10 + dx));
    target.click();
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

test("a trackpad's two-finger swipe moves the row by its sideways wheel and is let go once the wheel rests: a short one rests open, a long one acts; a wheel up or down is the list's", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((frame) => frames.push(frame));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  /** Runs the frames asked for at `time`, as the window draws one. */
  const frameAt = (time: number) =>
    act(() => {
      for (const frame of frames.splice(0)) frame(time);
    });
  const wheel = (item: HTMLElement, deltaX: number, deltaY = 0) =>
    act(() => {
      item.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY }),
      );
    });

  const short = swiped();
  wheel(short.item, 0, 30);
  expect(standing(short.item)).toEqual(["rest", "0px", false]);
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
