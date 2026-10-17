// @vitest-environment jsdom
import type { AdminDailyUsage } from "@luke/service/admin/admin-metrics";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ActivityCalendar } from "../src/admin/charts/activity-calendar";

/**
 * admin-activity-calendar.test.ts -- the activity calendar describes every day
 * it draws in words, today's as a day still running, and shows as many
 * trailing weeks as its card holds, its heading naming the span shown. jsdom
 * lays nothing out, so the card's width is the one this test gives it.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A synthetic three weeks, Sunday 2026-09-27 to Saturday 2026-10-17, read at noon on the last. */
const DAILY: AdminDailyUsage[] = Array.from({ length: 21 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 8, 27 + index)).toISOString().slice(0, 10),
  calls: index % 7 === 0 ? 0 : index,
}));
const GENERATED_AT = Date.UTC(2026, 9, 17, 12);

/** The weekday column (28px) and whole 15px week columns: room for `weeks` of them. */
function widthFor(weeks: number): number {
  return 28 + weeks * 15;
}

/** jsdom's stand-in for the browser's ResizeObserver, which it lacks: a resize is fired by hand. */
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
    root?.render(createElement(ActivityCalendar, { daily: DAILY, generatedAt: GENERATED_AT })),
  );
  return container;
}

/** What each day cell says to a screen reader, in the grid's own order. */
function dayDescriptions(page: HTMLElement): string[] {
  return Array.from(
    page.querySelectorAll<HTMLElement>("[role='img']"),
    (cell) => cell.getAttribute("aria-label") ?? "",
  );
}

function heading(page: HTMLElement): string {
  return page.querySelector("h3")?.textContent ?? "";
}

test("each day reads its date and its count of hosted calls", () => {
  const page = render();

  const descriptions = dayDescriptions(page);
  expect(descriptions).toHaveLength(21);
  expect(descriptions[0]).toBe("Sep 27 — 0 hosted calls");
  expect(descriptions[2]).toBe("Sep 29 — 2 hosted calls");
  expect(descriptions[13]).toBe("Oct 10 — 13 hosted calls");
});

test("today reads as a day still running", () => {
  const page = render();

  expect(dayDescriptions(page).at(-1)).toBe("Oct 17 (so far today) — 20 hosted calls");
});

test("a card that holds every week names the trailing year and labels its weekdays and months", () => {
  const page = render();

  expect(heading(page)).toBe("This account's trailing year, week by week");
  for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sep", "Oct"]) {
    expect(page.textContent).toContain(label);
  }
});

test("a narrower card shows its newest weeks and says how many", () => {
  const page = render();

  width = widthFor(2);
  act(() => resize?.());

  expect(heading(page)).toBe("This account's last 2 weeks, week by week");
  const descriptions = dayDescriptions(page);
  expect(descriptions).toHaveLength(14);
  expect(descriptions[0]).toBe("Oct 4 — 0 hosted calls");

  width = widthFor(1);
  act(() => resize?.());

  expect(heading(page)).toBe("This account's last 1 week, week by week");
  expect(dayDescriptions(page)).toHaveLength(7);
});

test("hovering a day shows its count in the tooltip, and leaving the grid hides it", () => {
  const page = render();
  const cell = page.querySelector<HTMLElement>("[role='img'][aria-label^='Oct 10']");
  if (cell === null) throw new Error("the calendar drew no Oct 10");

  act(() => {
    cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  expect(page.textContent).toContain("Oct 10Hosted calls13");

  act(() => {
    cell.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  });
  expect(page.textContent).not.toContain("Hosted calls");
});
