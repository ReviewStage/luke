// @vitest-environment jsdom
import type { AdminMetrics } from "@luke/service/admin/admin-metrics";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { RetentionGrid } from "../src/admin/charts/retention-grid";

/**
 * admin-retention-grid.test.ts -- the retention grid names every week and
 * cohort it draws and reads each cell's state in words: a share as a
 * percentage with its count on hover, a cohort nobody joined as a dash, the
 * week still accruing as active so far, and a week not yet reached as no
 * cell at all; a window with no accounts says so instead of drawing a grid.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A synthetic three-week window, read during the last week. */
const RETENTION: AdminMetrics["retention"] = {
  weeks: 3,
  cohorts: [
    {
      weekStart: "2026-09-28",
      size: 4,
      cells: [
        { offset: 0, activeAccounts: 4, share: 1, inProgress: false },
        { offset: 1, activeAccounts: 1, share: 0.25, inProgress: false },
        { offset: 2, activeAccounts: 0, share: 0, inProgress: true },
      ],
    },
    {
      weekStart: "2026-10-05",
      size: 0,
      cells: [
        { offset: 0, activeAccounts: 0, share: null, inProgress: false },
        { offset: 1, activeAccounts: 0, share: null, inProgress: true },
      ],
    },
    {
      weekStart: "2026-10-12",
      size: 2,
      cells: [{ offset: 0, activeAccounts: 1, share: 0.5, inProgress: true }],
    },
  ],
};

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function render(retention: AdminMetrics["retention"]): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() => root?.render(createElement(RetentionGrid, { retention })));
  return container;
}

/** Every element whose own words are `text`, in reading order. */
function cellsReading(page: HTMLElement, text: string): HTMLElement[] {
  return Array.from(page.querySelectorAll<HTMLElement>("div, span")).filter(
    (element) => element.childElementCount === 0 && element.textContent === text,
  );
}

test("the grid names its weeks, its cohorts, and each cohort's size", () => {
  const page = render(RETENTION);

  for (const label of ["Cohort", "Accounts", "Wk 0", "Wk 1", "Wk 2", "Sep 28", "Oct 5", "Oct 12"]) {
    expect(cellsReading(page, label)).toHaveLength(1);
  }
  expect(page.textContent).not.toContain("No accounts created");
});

test("each cell reads its share, and its count on hover", () => {
  const page = render(RETENTION);

  expect(cellsReading(page, "100%").map((cell) => cell.title)).toEqual(["4 accounts active"]);
  expect(cellsReading(page, "25%").map((cell) => cell.title)).toEqual(["1 account active"]);
});

test("the week still accruing reads as active so far", () => {
  const page = render(RETENTION);

  expect(cellsReading(page, "0%").map((cell) => cell.title)).toEqual([
    "0 accounts active so far this week",
  ]);
  expect(cellsReading(page, "50%").map((cell) => cell.title)).toEqual([
    "1 account active so far this week",
  ]);
});

test("a cohort nobody joined reads as a dash rather than a share", () => {
  const page = render(RETENTION);

  expect(cellsReading(page, "—").map((cell) => cell.title)).toEqual([
    "No accounts in this cohort",
    "No accounts in this cohort",
  ]);
});

test("a week the calendar has not reached draws no cell", () => {
  const page = render(RETENTION);

  const shares = Array.from(
    page.querySelectorAll<HTMLElement>("div[title]"),
    (cell) => cell.textContent,
  );
  expect(shares).toEqual(["100%", "25%", "0%", "—", "—", "50%"]);
});

test("a window with no accounts says so instead of drawing a grid", () => {
  const page = render({
    weeks: 8,
    cohorts: [
      {
        weekStart: "2026-10-12",
        size: 0,
        cells: [{ offset: 0, activeAccounts: 0, share: null, inProgress: true }],
      },
    ],
  });

  expect(page.textContent).toBe("No accounts created in the last 8 weeks yet.");
});

test("a strong cell's words take the palette's ink on a fill, never the ground, which is pale in the light theme", () => {
  const page = render(RETENTION);

  const [strong] = cellsReading(page, "100%");
  const [weak] = cellsReading(page, "25%");
  expect(strong?.style.color).toBe("var(--luke-color-on-accent)");
  expect(weak?.style.color).toBe("var(--luke-color-text)");
});
