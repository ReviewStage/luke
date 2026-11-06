// @vitest-environment jsdom
import type { AdminActivityDay } from "@repo/features/admin-answer-wire";
import { ACTIVITY_FEATURE } from "@repo/features/admin-overview-vocabulary";
import { ActivityChart } from "@repo/panel/admin/charts/activity-chart";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const GENERATED_AT = Date.UTC(2026, 9, 15, 12);
const TREND = { days: 7, recent: 18, prior: 12 };

function day(date: string, counts: readonly number[]): AdminActivityDay {
  const [agents = 0, revisions = 0, answers = 0, runs = 0] = counts;
  return {
    day: date,
    [ACTIVITY_FEATURE.AGENTS_STARTED]: agents,
    [ACTIVITY_FEATURE.DESCRIPTION_REVISIONS]: revisions,
    [ACTIVITY_FEATURE.INBOX_ANSWERED]: answers,
    [ACTIVITY_FEATURE.AUTOMATION_RUNS]: runs,
  };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function render(daily: readonly AdminActivityDay[]): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(ActivityChart, {
        activity: { daily: [...daily], trend: TREND },
        generatedAt: GENERATED_AT,
      }),
    ),
  );
  return container;
}

function tooltipText(page: HTMLElement): string {
  return page.querySelector(".recharts-tooltip-wrapper")?.textContent ?? "";
}

test("the legend names every feature the stack draws, in the stack's order", () => {
  const page = render([day("2026-10-14", [1, 2, 3, 4]), day("2026-10-15", [1, 0, 0, 0])]);

  expect(page.textContent).toContain(
    "Agents startedDescription revisionsInbox items answeredAutomation runs",
  );
  expect(page.textContent).toContain("+50% 18 in the last 7 days, against 12 before");
});

test("stepping through the days reads each feature's count that day", () => {
  const page = render([day("2026-10-14", [1, 2, 3, 4]), day("2026-10-15", [6, 0, 0, 0])]);
  const surface = page.querySelector<SVGElement>("svg[tabindex='0']");
  if (surface === null) throw new Error("the chart drew no plot");

  act(() => surface.focus());
  expect(tooltipText(page)).toBe(
    "Oct 14Agents started1Description revisions2Inbox items answered3Automation runs4",
  );
  act(() => {
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(tooltipText(page)).toContain("Oct 15 (so far today)Agents started6");
});

test("a window with no activity says so instead of drawing a flat stack", () => {
  const page = render([day("2026-10-14", []), day("2026-10-15", [])]);

  expect(page.textContent).toContain("No activity recorded in this window yet.");
  expect(page.querySelector("svg[tabindex='0']")).toBeNull();
});
