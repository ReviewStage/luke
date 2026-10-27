// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type DailyAxis, DailyBars } from "./daily-bars.js";

/**
 * daily-bars.test.ts -- a window's days are named along the plot's foot, one
 * tick a day, and its measure up the side in the words the caller's axis
 * gives it, whole numbers where it allows no fractions.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const DAYS = [
  { day: "2026-10-21", calls: 3, tasks: 1 },
  { day: "2026-10-22", calls: 5, tasks: 2 },
];

/** The words of every tick the plot draws, the days' first and then the measure's. */
function drawnTicks(axis: DailyAxis): string[] {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(DailyBars<(typeof DAYS)[number]>, {
        config: {
          calls: { label: "Calls", color: "#336699" },
          tasks: { label: "Tasks", color: "#993366" },
        },
        data: DAYS,
        series: [
          { key: "calls", fill: "var(--color-calls)" },
          { key: "tasks", fill: "var(--color-tasks)" },
        ],
        stack: "work",
        axis,
        height: "12rem",
        radius: [6, 6, 0, 0],
        generatedAt: Date.parse("2026-10-22T12:00:00Z"),
      }),
    ),
  );
  return [...container.querySelectorAll("text")].map((tick) => tick.textContent ?? "");
}

test("each day of the window is named along the foot, and a whole-number measure up the side", () => {
  const ticks = drawnTicks({ width: 36, allowDecimals: false });

  expect(ticks.slice(0, 2)).toEqual(["Oct 21", "Oct 22"]);
  const measure = ticks.slice(2);
  expect(measure.length).toBeGreaterThan(1);
  expect(measure.every((tick) => Number.isInteger(Number(tick)))).toBe(true);
});

test("the measure is worded as the caller's axis words it", () => {
  const ticks = drawnTicks({ width: 56, tickFormatter: (value) => `$${value}` });

  expect(ticks.slice(2).every((tick) => tick.startsWith("$"))).toBe(true);
});
