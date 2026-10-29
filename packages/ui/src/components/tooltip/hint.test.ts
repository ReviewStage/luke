// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { MOTION_DELAY_MS } from "@luke/brand";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { Button } from "../button/button.js";
import { List, ListRow } from "../list-row/list-row.js";
import { RowHint, RowHintOptions, Tooltip } from "./hint.js";

/**
 * hint.test.ts -- a card hung beside a row that names its row hangs past
 * the row's end, not its control's, so a control that gives its end up to
 * the row's acts on hover never puts the card over the row. And a finger,
 * which has no hover, opens a hint by hand: a tap on words that are no
 * control opens their card, and a tap elsewhere or Escape closes it, while a
 * mouse's click opens nothing; a link's tap still goes where it leads, and
 * a long press opens its card instead, its release pressing nothing; and a
 * control whose long press opens its menu keeps it for the menu. A tap on a
 * control inside hinted words is the control's alone, and its hold opens the hint, a finger's scroll
 * opens nothing, and a tap spent on a hint shows no message's actions.
 *
 * The window waits out the pointer's rest before it draws a hint: a pointer
 * only crossing a control mounts nothing for it, a card's row moved on from
 * lets the next row wait its own wait, so a pointer sweeping down a list
 * hangs no card, and a pill seen still lets the next control's show at once.
 * Words cut short inside a control hanging a card raise its card, not their
 * pill, while a button inside it raises its own, and the pointer moving on
 * from that button to the words raises the card.
 *
 * A reader hears a hint without the pointer or the keyboard: from its first
 * render, a control is described by its hint's words, beside a description
 * of its own, whether the control is the page's own element or a component;
 * words that take no focus, which a reader's cursor only walks over, own
 * them as hidden text read at their end, their own words as they were; and a
 * control whose own name says them is told them by no other way.
 */

const roots: Root[] = [];

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks: a hint is placed once and never resized here. */
class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
});

/** `element` under `registry`, as an app's root provides its own. */
function onRegistry(registry: AtomRegistry.AtomRegistry, element: ReactElement): ReactElement {
  return createElement(RegistryContext.Provider, { value: registry }, element);
}

/** The pointer arriving on `target` and resting there past the hint's wait, on a faked clock. */
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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Gives `element` a fixed box, as layout would, since jsdom lays nothing out. */
function boxed(element: Element, left: number, right: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 10, right - left, 28);
}

/** A list row handed only a card for its hint, with an act after its press, as a sidebar row draws one. */
function Row(): React.JSX.Element {
  return createElement(List, {
    label: "Tasks",
    children: createElement(RowHintOptions, {
      card: createElement("p", null, "Fix the refresh"),
      children: createElement(ListRow, {
        title: "Fix the refresh",
        hint: { Hint: RowHint, label: "Fix the refresh" },
        actions: createElement("button", { type: "button" }, "Archive"),
        onPress: () => undefined,
      }),
    }),
  });
}

test("a list row's card, handed no place to hang, hangs past the row's end, not its press's, which the row's acts cut short", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Row))));
  const row = container.querySelector("li");
  const press = row?.querySelector(":scope > button");
  assert.ok(row && press);
  boxed(row, 8, 260);
  boxed(press, 8, 200);
  // A window as wide as jsdom says it is, which its root's box, read for the
  // room a card keeps inside, otherwise answers as none.
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this === document.documentElement ? window.innerWidth : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return this === document.documentElement ? window.innerHeight : 0;
  });

  restOn(press);

  // Note that the card is placed once its place has been worked out, a few
  // microtasks after it mounts, by the positioner it stands in.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const card = document.querySelector<HTMLElement>(".luke-tooltip-card");
  assert.ok(card, "the card hangs");
  const placed = card.parentElement?.style.transform ?? "";
  const left = Number.parseFloat(/translate\(([-\d.]+)px/u.exec(placed)?.[1] ?? "");
  assert.ok(left > 260, `the card stands past the row's end, at ${placed}`);
});

/** Draws `element` into the document, on a registry of its own. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
  return container;
}

/** A pointer of `pointerType` going `type` on `target`, as the browser sends it. */
function press(target: Element, type: string, pointerType: string): void {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 3,
        pointerType,
        isPrimary: true,
        clientX: 12,
        clientY: 12,
      }),
    );
  });
}

/**
 * A press of `pointerType` let go on `target`, and the click its release
 * makes, as the browser makes it: for a touch, only where its touchend was
 * not refused. Answers whether it made the click.
 */
function release(target: Element, pointerType: string): boolean {
  press(target, "pointerup", pointerType);
  return clickOf(target, pointerType);
}

/** The click a press's release makes, as the browser makes it: for a touch, only where its touchend was not refused. */
function clickOf(target: Element, pointerType: string): boolean {
  const touchEnd = new TouchEvent("touchend", { bubbles: true, cancelable: true });
  act(() => {
    if (pointerType === "touch") target.dispatchEvent(touchEnd);
    if (touchEnd.defaultPrevented) return;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
  return !touchEnd.defaultPrevented;
}

/**
 * A tap, or a mouse's click, on `target`. Note that a finger arrives on
 * what it touches and leaves it again as it lifts, as a browser says, while
 * a mouse is already resting where it clicks.
 */
function tap(target: Element, pointerType = "touch"): boolean {
  const touched = pointerType === "touch";
  if (touched) press(target, "pointerover", pointerType);
  press(target, "pointerdown", pointerType);
  press(target, "pointerup", pointerType);
  if (touched) press(target, "pointerout", pointerType);
  return clickOf(target, pointerType);
}

/** A finger held still on `target` well past a long press, then lifted; answers whether its release clicked. */
function longPress(target: Element): boolean {
  vi.useFakeTimers();
  press(target, "pointerdown", "touch");
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  vi.useRealTimers();
  return release(target, "touch");
}

/** The card drawn, standing or on its way out, if one is. */
const card = () => document.querySelector(".luke-tooltip-card");

/** Whether a card stands, drawn and not on its way out. */
const cardStands = () => card() !== null && !card()?.hasAttribute("data-leaving");

/** How a turn ended, as words that are no control, hanging the turn's card. */
const WORKED = createElement(Tooltip, {
  label: "Worked for 3m",
  card: createElement("p", null, "Began at 9:14 AM"),
  children: createElement(
    "p",
    { "data-worked": "", "aria-describedby": undefined },
    "Worked for 3m",
  ),
});

test("under a finger, a tap on words that are no control opens their card at once, and another tap closes it", () => {
  const line = mount(WORKED).querySelector("[data-worked]") ?? assert.fail("the line");

  // Note that no time passes, so the card standing says it skipped the hover's wait.
  tap(line);
  assert.equal(card()?.textContent, "Began at 9:14 AM");

  tap(line);
  assert.equal(cardStands(), false, "it goes");
});

test("a card a tap opened goes on a tap elsewhere, or on Escape, and stays for a tap on itself", () => {
  const page = mount(
    createElement("div", null, WORKED, createElement("p", { "data-else": "" }, "Else")),
  );
  const line = page.querySelector("[data-worked]") ?? assert.fail("the line");
  const elsewhere = page.querySelector("[data-else]") ?? assert.fail("elsewhere");

  tap(line);
  // Note that the clock is the test's, so a card left to linger would be gone by the check.
  vi.useFakeTimers();
  tap(card() ?? assert.fail("the card"));
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  vi.useRealTimers();
  assert.equal(cardStands(), true, "a tap on the card keeps it");
  tap(elsewhere);
  assert.equal(cardStands(), false, "a tap elsewhere takes it down");

  tap(line);
  assert.equal(cardStands(), true);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert.equal(cardStands(), false, "Escape takes it down");
});

test("with a mouse, a click on the words opens no card", () => {
  const line = mount(WORKED).querySelector("[data-worked]") ?? assert.fail("the line");

  tap(line, "mouse");

  assert.equal(cardStands(), false);
});

test("a link's tap still goes where it leads and opens no card; a long press opens its card, and its release goes nowhere", () => {
  const followed: string[] = [];
  const page = mount(
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "acme/relay#42"),
      children: createElement(
        "a",
        {
          href: "https://example.com/pull/42",
          onClick: (event: React.MouseEvent) => {
            event.preventDefault();
            followed.push("pull 42");
          },
        },
        "#42",
      ),
    }),
  );
  const link = page.querySelector("a") ?? assert.fail("the link");

  assert.equal(tap(link), true);
  assert.deepEqual(followed, ["pull 42"]);
  assert.equal(cardStands(), false, "a tap opens no card");

  assert.equal(longPress(link), false, "the hold's release makes no click");
  assert.equal(card()?.textContent, "acme/relay#42");
  assert.deepEqual(followed, ["pull 42"], "the hold goes nowhere");
});

test("a control whose long press opens its context menu shows no hint for the hold", () => {
  const page = mount(
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "acme/relay#42"),
      children: createElement(
        "button",
        { type: "button", "data-long-press": "", "aria-describedby": undefined },
        "Fix",
      ),
    }),
  );

  longPress(page.querySelector("button") ?? assert.fail("the row"));

  assert.equal(cardStands(), false);
});

test("a tap on a control inside hinted words works the control alone, and a long press on it opens the hint and presses nothing", () => {
  const chosen: string[] = [];
  const page = mount(
    createElement(Tooltip, {
      label: "Relation",
      children: createElement(
        "span",
        { "aria-describedby": undefined },
        createElement(
          "button",
          { type: "button", onClick: () => chosen.push("Part of") },
          "Part of",
        ),
      ),
    }),
  );

  tap(page.querySelector("button") ?? assert.fail("the choice"));

  assert.deepEqual(chosen, ["Part of"]);
  assert.equal(document.querySelector(".luke-tooltip") === null, true, "no hint stands");

  assert.equal(longPress(page.querySelector("button") ?? assert.fail("the choice")), false);
  assert.equal(document.querySelector(".luke-tooltip")?.textContent, "Relation");
  assert.deepEqual(chosen, ["Part of"], "the hold chose nothing");
});

test("a finger that scrolls from a link, which the browser takes over, opens no card however long it stays down", () => {
  const page = mount(
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "acme/relay#42"),
      children: createElement(
        "a",
        { href: "https://example.com/pull/42", "aria-describedby": undefined },
        "#42",
      ),
    }),
  );
  const link = page.querySelector("a") ?? assert.fail("the link");

  vi.useFakeTimers();
  press(link, "pointerdown", "touch");
  press(link, "pointercancel", "touch");
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  vi.useRealTimers();

  assert.equal(cardStands(), false);
});

/** The cards mounted so far, by the row each was hung from. */
let mounted: string[] = [];

/** The faked clock a hint waits on, and no card mounted yet. */
function waiting(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  mounted = [];
}

/** A card that notes it was mounted, which only a card drawn is. */
function Card({ row }: { row: string }): React.JSX.Element {
  const noted = useRef(false);
  if (!noted.current) {
    noted.current = true;
    mounted.push(row);
  }
  return createElement("p", null, `${row}'s card`);
}

/** A row's press hanging its card beside it, its row counting as its control, as a sidebar row's does. */
function CardedRow({ row }: { row: string }): React.JSX.Element {
  const item = useRef<HTMLElement | null>(null);
  return createElement(
    "li",
    { ref: item, "data-row": row },
    createElement(Tooltip, {
      label: row,
      card: createElement(Card, { row }),
      cardBeside: true,
      cardRegion: item,
      children: createElement("button", { type: "button", "aria-describedby": undefined }, row),
    }),
  );
}

/** Rows that each hang a card, drawn under a registry of their own. */
function drawRows(rows: readonly string[]): (row: string) => HTMLElement {
  const container = document.body.appendChild(document.createElement("ul"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          rows.map((row) => createElement(CardedRow, { key: row, row })),
        ),
      ),
    ),
  );
  return (row) =>
    container.querySelector<HTMLElement>(`[data-row="${row}"] button`) ??
    assert.fail(`${row} is drawn`);
}

/**
 * The pointer moving from `from`, where it stood, onto `to`: out of `from`,
 * leaving each element holding it that does not hold `to`, as a browser
 * tells them, and over `to`. Note that React draws its own enter and leave
 * from the out and the over, while a row's own listener hears the leave.
 */
function move(from: Element | undefined, to: Element): void {
  act(() => {
    from?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    for (let left = from ?? null; left !== null && !left.contains(to); left = left.parentElement) {
      left.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: to }));
    }
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from ?? null }));
  });
}

function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const cards = () =>
  [...document.querySelectorAll(".luke-tooltip-card")].map((card) => card.textContent);

test("a pointer crossing a row in less than the wait mounts no card for it, and one resting the wait out mounts its own", () => {
  waiting();
  const press = drawRows(["Alpha", "Beta", "Gamma"]);
  const outside = document.body.appendChild(document.createElement("div"));
  move(outside, press("Alpha"));
  pass(MOTION_DELAY_MS.HINT / 2);
  move(press("Alpha"), press("Beta"));
  pass(MOTION_DELAY_MS.HINT / 2);
  move(press("Beta"), press("Gamma"));
  pass(MOTION_DELAY_MS.HINT - 1);
  assert.deepEqual(mounted, [], "no row crossed or still waited on mounts its card");
  assert.deepEqual(cards(), []);

  pass(1);
  assert.deepEqual(mounted, ["Gamma"]);
  assert.deepEqual(cards(), ["Gamma's card"]);
});

test("a pointer leaving a row before the wait is out mounts nothing once it would have run out", () => {
  waiting();
  const press = drawRows(["Alpha"]);
  const outside = document.body.appendChild(document.createElement("div"));
  move(outside, press("Alpha"));
  pass(MOTION_DELAY_MS.HINT / 2);
  move(press("Alpha"), outside);
  pass(2 * MOTION_DELAY_MS.HINT);
  assert.deepEqual(mounted, []);
});

test("a pointer sweeping on from a row whose card stands lets each next row wait its own wait, so the rows it crosses hang no card", () => {
  waiting();
  const press = drawRows(["Alpha", "Beta", "Gamma", "Delta"]);
  const outside = document.body.appendChild(document.createElement("div"));
  move(outside, press("Alpha"));
  pass(MOTION_DELAY_MS.HINT);
  assert.deepEqual(cards(), ["Alpha's card"]);

  // Note that each row is crossed in less than the wait, the card left behind lingering and going meanwhile.
  move(press("Alpha"), press("Beta"));
  pass(MOTION_DELAY_MS.HINT / 4);
  move(press("Beta"), press("Gamma"));
  pass(MOTION_DELAY_MS.HINT / 2);
  move(press("Gamma"), press("Delta"));
  pass(MOTION_DELAY_MS.HINT / 2);
  assert.deepEqual(mounted, ["Alpha"], "no row swept across mounts its card");
  assert.deepEqual(cards(), []);

  pass(MOTION_DELAY_MS.HINT / 2);
  assert.deepEqual(
    cards(),
    ["Delta's card"],
    "the row rested on hangs its own once its wait is out",
  );
});

test("a key, a scroll, or the window losing the keyboard while the pointer rests calls the waiting hint off", () => {
  const leaves: readonly (() => void)[] = [
    () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    () => document.body.dispatchEvent(new Event("scroll")),
    () => window.dispatchEvent(new Event("blur")),
  ];
  for (const leave of leaves) {
    waiting();
    const press = drawRows(["Alpha"]);
    move(undefined, press("Alpha"));
    pass(MOTION_DELAY_MS.HINT / 2);
    act(leave);
    pass(2 * MOTION_DELAY_MS.HINT);
    assert.deepEqual(mounted, [], "the hint waiting is called off");
    for (const root of roots.splice(0)) act(() => root.unmount());
    vi.useRealTimers();
  }
});

// Note that this stands last, because the warm spell it leaves is the window's own.
test("a pill seen warms the window, so the next control's shows at once", () => {
  waiting();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(Tooltip, {
            label: "Back",
            children: createElement("button", {
              type: "button",
              "aria-label": "Go back",
              "aria-describedby": undefined,
            }),
          }),
          createElement(Tooltip, {
            label: "Forward",
            children: createElement("button", {
              type: "button",
              "aria-label": "Go forward",
              "aria-describedby": undefined,
            }),
          }),
        ),
      ),
    ),
  );
  const [back, forward] = container.querySelectorAll("button");
  assert.ok(back && forward);
  const pill = () => document.querySelector('[role="tooltip"]')?.textContent;
  move(undefined, back);
  assert.equal(pill(), undefined, "the first waits");
  pass(MOTION_DELAY_MS.HINT);
  assert.equal(pill(), "Back");
  move(back, forward);
  assert.equal(pill(), "Forward", "the next shows at once");
});

/** The words of each element `control` names in its `attribute`, in turn, as a reader hears them. */
function wordsNamedBy(control: Element, attribute = "aria-describedby"): string[] {
  return (control.getAttribute(attribute) ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

test("a control is described by its hint from its first render, before any pointer or focus, beside a description of its own", () => {
  const container = mount(
    createElement(
      Fragment,
      null,
      createElement("p", { id: "own" }, "Copies the address"),
      createElement(Tooltip, {
        label: "Copy link",
        children: createElement(
          "button",
          { type: "button", "aria-label": "Copy", "aria-describedby": "own" },
          "⧉",
        ),
      }),
      createElement(Tooltip, {
        label: "Stop the agent",
        children: createElement(Button, { onClick: () => undefined, children: "Stop" }),
      }),
    ),
  );
  const [copy, stop] = [...container.querySelectorAll("button")];
  assert.ok(copy && stop);
  assert.equal(document.querySelector('[role="tooltip"]'), null, "no hint is drawn");
  assert.deepEqual(wordsNamedBy(copy), ["Copies the address", "Copy link"]);
  assert.deepEqual(wordsNamedBy(stop), ["Stop the agent"]);
});

test("a control whose own name already says its hint is told it by its name alone", () => {
  const container = mount(
    createElement(
      Fragment,
      null,
      createElement(Tooltip, {
        label: "Fix the refresh",
        card: createElement("p", null, "Fix the refresh, opened by Ada"),
        children: createElement(
          "button",
          { type: "button", "aria-describedby": undefined },
          "Fix the refresh",
        ),
      }),
      createElement(Tooltip, {
        label: "Archive",
        children: createElement(
          "button",
          { type: "button", "aria-label": "Archive task", "aria-describedby": undefined },
          "×",
        ),
      }),
      createElement(Tooltip, {
        label: "a-long-name.yml",
        children: createElement(
          "span",
          null,
          "a-long-name.yml",
          createElement("small", null, "3 KB"),
        ),
      }),
    ),
  );
  for (const control of container.querySelectorAll("button, span")) {
    assert.equal(control.hasAttribute("aria-describedby"), false, control.textContent ?? "");
  }
  assert.equal(container.textContent, "Fix the refresh×a-long-name.yml3 KB");
});

test("words that take no focus own their hint as hidden text, read at their end, while a control in a list it roves in is described", () => {
  const container = mount(
    createElement(
      "ul",
      null,
      createElement(Tooltip, {
        label: "Oct 24, 2026, 3:00 PM",
        children: createElement(
          "li",
          { "aria-describedby": undefined },
          createElement("time", null, "2h ago"),
        ),
      }),
      createElement(
        "li",
        null,
        createElement(Tooltip, {
          label: "Bold",
          children: createElement("span", {
            role: "radio",
            tabIndex: -1,
            "aria-label": "B",
            "aria-describedby": undefined,
          }),
        }),
      ),
    ),
  );
  const [time, roving] = [...container.querySelectorAll("li")];
  assert.ok(time && roving);
  assert.deepEqual(
    [...(container.querySelector("ul")?.children ?? [])].map((child) => child.tagName),
    ["LI", "LI"],
    "the list holds its items alone",
  );
  assert.equal(time.textContent, "2h ago", "its own words are as they were");
  assert.deepEqual(wordsNamedBy(time, "aria-owns"), ["Oct 24, 2026, 3:00 PM"]);
  assert.equal(time.hasAttribute("aria-describedby"), false);
  const radio = roving.querySelector('[role="radio"]') ?? assert.fail("the roving control");
  assert.deepEqual(wordsNamedBy(radio), ["Bold"]);
  assert.equal(radio.hasAttribute("aria-owns"), false);
});

test("words cut short inside a control hanging a card raise its card, not their pill", () => {
  const page = mount(
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "Opened by Sam"),
      children: createElement(
        "button",
        { type: "button", "data-row": "", "aria-describedby": undefined },
        createElement(Tooltip, {
          label: "Fix the refresh of the token",
          children: createElement(
            "span",
            { "data-label": "", "aria-describedby": undefined },
            "Fix the refresh of the token",
          ),
        }),
      ),
    }),
  );
  restOn(page.querySelector("[data-label]") ?? assert.fail("the label"));

  assert.equal(cardStands(), true, "the card stands");
  assert.equal(card()?.textContent, "Opened by Sam");
  assert.equal(document.querySelectorAll("[role='tooltip']").length, 1, "no pill beside it");
});

test("a button inside a control hanging a card raises its own pill, and the words beside it the card", () => {
  waiting();
  const page = mount(
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "Opened by Sam"),
      children: createElement(
        "span",
        { "data-chip": "", "aria-describedby": undefined },
        createElement(Tooltip, {
          label: "Fix the refresh of the token",
          children: createElement(
            "span",
            { "data-label": "", "aria-describedby": undefined },
            "Fix the refresh of the token",
          ),
        }),
        createElement(Tooltip, {
          label: "Remove",
          children: createElement(
            "button",
            { type: "button", "data-remove": "", "aria-describedby": undefined },
            "×",
          ),
        }),
      ),
    }),
  );
  const button = page.querySelector("[data-remove]") ?? assert.fail("the button");
  move(document.body.appendChild(document.createElement("div")), button);
  pass(MOTION_DELAY_MS.HINT);

  assert.equal(cardStands(), false, "no card over the button");
  assert.equal(document.querySelector("[role='tooltip']")?.textContent, "Remove");

  move(button, page.querySelector("[data-label]") ?? assert.fail("the label"));
  pass(MOTION_DELAY_MS.HINT);

  assert.equal(cardStands(), true, "the card stands over the words");
  assert.equal(card()?.textContent, "Opened by Sam");
});
