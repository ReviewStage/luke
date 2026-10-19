// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Calendar } from "./calendar.js";

/**
 * calendar.test.ts -- the month reads as a labelled grid of named days with
 * today marked and the selection selected; the arrows, Home, End, PageUp,
 * and PageDown move the keyboard, across a month's edge and the shown month
 * with it; Enter, Space, and a press pick a day, alone or as a range's end,
 * and a neighbouring month's day is picked like any other; the keyboard
 * waits for a caller slow to show the month it stepped into, unless it left
 * the grid meanwhile; and paging stops at the four-digit years, its keys still
 * the grid's there. Synthetic days, with today handed in.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-20";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** What a caller heard from the calendar, in order, and how a slow caller shows a month later. */
interface Heard {
  readonly picks: string[];
  readonly months: string[];
  show?: (month: string) => void;
}

/** A drawn calendar's container and what its caller heard. */
interface Drawn {
  readonly container: HTMLElement;
  readonly heard: Heard;
}

/** A caller that shows the months the calendar asks for and keeps `start` and `end` as given. */
function Shown({
  from,
  start,
  end,
  heard,
  slow = false,
}: {
  from: string;
  start?: string | undefined;
  end?: string | undefined;
  heard: Heard;
  /** Whether the caller holds a month asked for until the test shows it. */
  slow?: boolean | undefined;
}): React.JSX.Element {
  const [month, setMonth] = useState(from);
  heard.show = setMonth;
  return createElement(Calendar, {
    month,
    today: TODAY,
    start,
    end,
    onPick: (day) => heard.picks.push(day),
    onShowMonth: (next) => {
      heard.months.push(next);
      if (!slow) setMonth(next);
    },
  });
}

/** Draws the calendar at `from` and hands back its container and what it heard. */
function draw(
  from: string,
  selection: { start?: string; end?: string; slow?: boolean } = {},
): Drawn {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const heard: Heard = { picks: [], months: [] };
  act(() => root.render(createElement(Shown, { from, ...selection, heard })));
  return { container, heard };
}

/** The day named `name`. */
function day(container: HTMLElement, name: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="grid"] button[aria-label="${name}"]`);
  if (found === null) throw new Error(`no day named ${name}`);
  return found;
}

/** The names of the days in the grid's selected cells, in order. */
function selected(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[role="grid"] td[aria-selected="true"] button')].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

/** The grid's name, read from what labels it. */
function gridName(container: HTMLElement): string {
  const grid = container.querySelector('[role="grid"]');
  const label = grid?.getAttribute("aria-labelledby");
  return label ? (document.getElementById(label)?.textContent ?? "") : "";
}

/** Presses `key` on whatever has the focus, and answers whether the page's own response to it was refused. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const target = document.activeElement;
  if (target === null) throw new Error("nothing has the focus");
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** The name of the day with the focus. */
function focused(): string | null {
  return document.activeElement?.getAttribute("aria-label") ?? null;
}

/** Puts the focus on the grid's one tab stop, as Tab would. */
function enterGrid(container: HTMLElement): void {
  const stop = container.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]');
  act(() => stop?.focus());
}

test("the month reads as a grid named for it, Sunday first, with today marked", () => {
  const { container } = draw("2026-10");

  expect(gridName(container)).toBe("October 2026");
  expect(
    [...container.querySelectorAll('[role="grid"] th[scope="col"]')].map((heading) =>
      heading.getAttribute("aria-label"),
    ),
  ).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  const days = container.querySelectorAll('[role="grid"] td button');
  expect(days).toHaveLength(42);
  expect(days[0]?.getAttribute("aria-label")).toBe("Sunday, September 27, 2026");
  expect(days[41]?.getAttribute("aria-label")).toBe("Saturday, November 7, 2026");
  expect(day(container, "Tuesday, October 20, 2026").getAttribute("aria-current")).toBe("date");
  expect(container.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  expect(selected(container)).toEqual([]);
});

test("one day selected is the grid's tab stop, else today, else the month's first", () => {
  const stop = (container: HTMLElement) =>
    container.querySelector('[role="grid"] button[tabindex="0"]')?.getAttribute("aria-label");

  expect(stop(draw("2026-10", { start: "2026-10-03" }).container)).toBe(
    "Saturday, October 3, 2026",
  );
  expect(stop(draw("2026-10").container)).toBe("Tuesday, October 20, 2026");
  expect(stop(draw("2026-12").container)).toBe("Tuesday, December 1, 2026");
});

test("a single day is selected alone, and a press picks the day pressed", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-20" });

  expect(selected(container)).toEqual(["Tuesday, October 20, 2026"]);
  expect(container.querySelector('[role="grid"]')?.getAttribute("aria-multiselectable")).toBe(null);
  act(() => day(container, "Friday, October 23, 2026").click());
  expect(heard.picks).toEqual(["2026-10-23"]);
});

test("a range selects its ends and every day between, and a neighbouring month's day is picked", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-29", end: "2026-11-02" });

  expect(container.querySelector('[role="grid"]')?.getAttribute("aria-multiselectable")).toBe(
    "true",
  );
  expect(selected(container)).toEqual([
    "Thursday, October 29, 2026",
    "Friday, October 30, 2026",
    "Saturday, October 31, 2026",
    "Sunday, November 1, 2026",
    "Monday, November 2, 2026",
  ]);
  act(() => day(container, "Thursday, November 5, 2026").click());
  expect(heard.picks).toEqual(["2026-11-05"]);
  expect(heard.months).toEqual([]);
});

test("the arrows step by a day and a week, across the month's edge and the shown month with it", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-01" });
  enterGrid(container);

  press("ArrowLeft");
  expect(focused()).toBe("Wednesday, September 30, 2026");
  expect(gridName(container)).toBe("September 2026");
  press("ArrowRight");
  expect(focused()).toBe("Thursday, October 1, 2026");
  press("ArrowUp");
  expect(focused()).toBe("Thursday, September 24, 2026");
  press("ArrowDown");
  press("ArrowDown");
  expect(focused()).toBe("Thursday, October 8, 2026");
  expect(heard.months).toEqual(["2026-09", "2026-10", "2026-09", "2026-10"]);
  expect(heard.picks).toEqual([]);
});

test("PageUp and PageDown change the month on the same date, held to a short month's last", () => {
  const { container, heard } = draw("2026-03", { start: "2026-03-31" });
  enterGrid(container);

  press("PageUp");
  expect(focused()).toBe("Saturday, February 28, 2026");
  expect(gridName(container)).toBe("February 2026");
  press("PageDown");
  expect(focused()).toBe("Saturday, March 28, 2026");
  press("PageDown", { shiftKey: true });
  expect(focused()).toBe("Sunday, March 28, 2027");
  expect(heard.months).toEqual(["2026-02", "2026-03", "2027-03"]);
});

test("Home and End go to the week's Sunday and Saturday, into the next month where it ends there", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-28" });
  enterGrid(container);

  press("Home");
  expect(focused()).toBe("Sunday, October 25, 2026");
  press("End");
  expect(focused()).toBe("Saturday, October 31, 2026");
  press("ArrowRight");
  press("End");
  expect(focused()).toBe("Saturday, November 7, 2026");
  expect(heard.months).toEqual(["2026-11"]);
});

test("Enter and Space pick the day the keyboard is on", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-20" });
  enterGrid(container);

  press("Enter");
  press("ArrowRight");
  press(" ");
  expect(heard.picks).toEqual(["2026-10-20", "2026-10-21"]);
});

test("the steps above the grid ask for the month either side", () => {
  const { container, heard } = draw("2026-01");
  const step = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

  act(() => step("Previous month")?.click());
  expect(gridName(container)).toBe("December 2025");
  act(() => step("Next month")?.click());
  act(() => step("Next month")?.click());
  expect(heard.months).toEqual(["2025-12", "2026-01", "2026-02"]);
});

test("a step into a month the caller shows later takes the keyboard there once it does", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-20", slow: true });
  enterGrid(container);

  press("PageDown", { shiftKey: true });
  expect(heard.months).toEqual(["2027-10"]);
  expect(gridName(container)).toBe("October 2026");
  act(() => heard.show?.("2027-10"));
  expect(focused()).toBe("Wednesday, October 20, 2027");
});

test("the calendar pages no further than the four-digit years", () => {
  const { container, heard } = draw("9999-12", { start: "9999-12-31" });
  const step = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  enterGrid(container);

  expect(press("ArrowRight")).toBe(true);
  expect(press("PageDown")).toBe(true);
  expect(focused()).toBe("Friday, December 31, 9999");
  expect(step("Next month")?.disabled).toBe(true);
  expect(container.querySelectorAll('[role="grid"] td button')).toHaveLength(31 + 3);
  expect(heard.months).toEqual([]);
  expect(
    draw("0001-01").container.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous month"]',
    )?.disabled,
  ).toBe(true);
});

test("a step still waiting on its month is dropped once the keyboard leaves the grid", () => {
  const { container, heard } = draw("2026-10", { start: "2026-10-20", slow: true });
  const elsewhere = document.body.appendChild(document.createElement("input"));
  enterGrid(container);

  press("PageDown");
  act(() => elsewhere.focus());
  act(() => heard.show?.("2026-11"));
  expect(document.activeElement).toBe(elsewhere);
});
