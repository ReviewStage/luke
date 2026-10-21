// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@luke/brand";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { Message, MessageContent } from "./ai-elements/message.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { restOn } from "./testing/hint-rest.js";
import { Tooltip } from "./tooltip.js";

/**
 * tooltip.test.ts -- a card hung beside a row that names its row hangs past
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
 */

const roots: Root[] = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Gives `element` a fixed box, as layout would, since jsdom lays nothing out. */
function boxed(element: Element, left: number, right: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 10, right - left, 28);
}

/** A row whose press hangs a card beside it, the row named as its region, with acts after the press. */
function Row(): React.JSX.Element {
  const item = useRef<HTMLLIElement>(null);
  return createElement(
    "li",
    { ref: item, "data-row": "" },
    createElement(Tooltip, {
      label: "Fix the refresh",
      card: createElement("p", null, "Fix the refresh"),
      cardBeside: true,
      cardRegion: item,
      children: createElement(
        "button",
        { type: "button", "data-press": "", "aria-describedby": undefined },
        "Fix the refresh",
      ),
    }),
    createElement("button", { type: "button" }, "Archive"),
  );
}

test("a card hung from a row hangs past the row's end, not its press's, which the row's acts cut short", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Row))));
  const row = container.querySelector("[data-row]");
  const press = container.querySelector("[data-press]");
  assert.ok(row && press);
  boxed(row, 8, 260);
  boxed(press, 8, 200);

  restOn(press);

  const card = document.querySelector<HTMLElement>(".luke-tooltip-card");
  assert.ok(card, "the card hangs");
  assert.equal(card.dataset.side, "end");
  assert.ok(
    Number.parseFloat(card.style.left) > 260,
    `the card stands past the row's end, at ${card.style.left}`,
  );
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

test("on a screen with no hover, a tap spent opening a hint in a message shows none of the message's actions", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)" }));
  const page = mount(
    createElement(
      Message,
      { from: "assistant" },
      createElement(MessageContent, null, "Rerunning the spec on WebKit."),
      WORKED,
    ),
  );
  const message = page.querySelector(".transcript-message") ?? assert.fail("the message");

  tap(page.querySelector("[data-worked]") ?? assert.fail("the line"));
  assert.equal(cardStands(), true);
  assert.equal(message.hasAttribute("data-actions-shown"), false);

  tap(page.querySelector(".message-content") ?? assert.fail("the words"));
  assert.equal(message.getAttribute("data-actions-shown"), "true", "a tap on its words still does");
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
