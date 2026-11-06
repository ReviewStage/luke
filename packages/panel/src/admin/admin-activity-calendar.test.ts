// @vitest-environment jsdom
import type { AdminDailyCount } from "@repo/features/admin-answer-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ActivityCalendar, CALENDAR_MEASURE } from "./charts/activity-calendar.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DAILY: AdminDailyCount[] = Array.from({ length: 21 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 8, 27 + index)).toISOString().slice(0, 10),
  count: index % 7 === 0 ? 0 : index,
}));
const GENERATED_AT = Date.UTC(2026, 9, 17, 12);

function widthFor(weeks: number): number {
  return 28 + weeks * 15;
}

let resize: (() => void) | undefined;
class HandResizeObserver {
  constructor(callback: () => void) {
    resize = callback;
  }
  observe(): void {}
  disconnect(): void {}
}

let width = widthFor(3);
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", HandResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  resize = undefined;
  width = widthFor(3);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(ActivityCalendar, {
        daily: DAILY,
        measure: CALENDAR_MEASURE.ACTIONS,
        generatedAt: GENERATED_AT,
      }),
    ),
  );
  return container;
}

function dayDescriptions(page: HTMLElement): string[] {
  return Array.from(
    page.querySelectorAll<HTMLElement>("[role='img']"),
    (cell) => cell.getAttribute("aria-label") ?? "",
  );
}

function heading(page: HTMLElement): string {
  return page.querySelector("h3")?.textContent ?? "";
}

test("each day reads its date and its count of meaningful actions", () => {
  const page = render();

  const descriptions = dayDescriptions(page);
  expect(descriptions).toHaveLength(21);
  expect(descriptions[0]).toBe("Sep 27 — 0 meaningful actions");
  expect(descriptions[2]).toBe("Sep 29 — 2 meaningful actions");
  expect(descriptions[13]).toBe("Oct 10 — 13 meaningful actions");
});

test("today reads as a day still running", () => {
  const page = render();

  expect(dayDescriptions(page).at(-1)).toBe("Oct 17 (so far today) — 20 meaningful actions");
});

test("a card that holds every week names the trailing year and labels its weekdays and months", () => {
  const page = render();

  expect(heading(page)).toBe("This account's meaningful actions, trailing year, week by week");
  for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sep", "Oct"]) {
    expect(page.textContent).toContain(label);
  }
});

test("a narrower card shows its newest weeks and says how many", () => {
  const page = render();

  width = widthFor(2);
  act(() => resize?.());

  expect(heading(page)).toBe("This account's meaningful actions, last 2 weeks, week by week");
  const descriptions = dayDescriptions(page);
  expect(descriptions).toHaveLength(14);
  expect(descriptions[0]).toBe("Oct 4 — 0 meaningful actions");

  width = widthFor(1);
  act(() => resize?.());

  expect(heading(page)).toBe("This account's meaningful actions, last 1 week, week by week");
  expect(dayDescriptions(page)).toHaveLength(7);
});

test("hovering a day shows its count in the tooltip, and leaving the grid hides it", () => {
  const page = render();
  const cell = page.querySelector<HTMLElement>("[role='img'][aria-label^='Oct 10']");
  if (cell === null) throw new Error("the calendar drew no Oct 10");

  act(() => {
    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  expect(page.textContent).toContain("Oct 10Meaningful actions13");

  act(() => {
    cell.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  });
  expect(page.textContent).not.toContain("Meaningful actions");
});
