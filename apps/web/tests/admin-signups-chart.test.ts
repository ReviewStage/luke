// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SignInMethodsChart, SignupsChart } from "../src/admin/charts/signups-chart";

/**
 * admin-signups-chart.test.ts -- a signups chart with accounts in its window
 * draws them rather than the line saying there are none: each day named on
 * its axis and each day's count read in the tooltip, today's marked as a day
 * still running; and the sign-in methods chart draws each linked method with
 * its count, leaving out a method nobody has linked.
 * jsdom measures nothing, so a chart draws at the size it starts at before
 * its container is measured.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A synthetic window of three days, read at noon on the last. */
const DAILY = [
  { day: "2026-10-13", count: 1 },
  { day: "2026-10-14", count: 0 },
  { day: "2026-10-15", count: 4 },
];
const GENERATED_AT = Date.UTC(2026, 9, 15, 12);
const TREND = { days: 7, recent: 5, prior: 4 };

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

function renderSignupsChart(): HTMLElement {
  return render(
    createElement(SignupsChart, { daily: DAILY, trend: TREND, generatedAt: GENERATED_AT }),
  );
}

/** The chart's plot, the one stop a keyboard reader lands on. */
function plot(page: HTMLElement): SVGElement {
  const surface = page.querySelector<SVGElement>("svg[tabindex='0']");
  if (surface === null) throw new Error("the chart drew no plot");
  return surface;
}

/** What the tooltip says now: nothing while it is hidden. */
function tooltipText(page: HTMLElement): string {
  return page.querySelector(".recharts-tooltip-wrapper")?.textContent ?? "";
}

function press(target: SVGElement, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

test("a signups chart with accounts draws its days instead of the empty line", () => {
  const page = renderSignupsChart();

  expect(page.textContent).not.toContain("No accounts created in this window yet.");
  const ticks = Array.from(plot(page).querySelectorAll("text"), (tick) => tick.textContent);
  expect(ticks).toEqual(expect.arrayContaining(["Oct 13", "Oct 14", "Oct 15"]));
});

test("stepping through a signups chart's days reads each day's count", () => {
  const page = renderSignupsChart();
  const surface = plot(page);

  act(() => surface.focus());
  expect(tooltipText(page)).toBe("Oct 13New accounts1");

  press(surface, "ArrowRight");
  expect(tooltipText(page)).toBe("Oct 14New accounts0");

  press(surface, "ArrowRight");
  expect(tooltipText(page)).toBe("Oct 15 (so far today)New accounts4");

  act(() => surface.blur());
  expect(tooltipText(page)).toBe("");
});

test("the sign-in methods chart draws each linked method and leaves out the rest", () => {
  const page = render(
    createElement(SignInMethodsChart, {
      methods: { github: 3, google: 2, other: 0 },
      totalAccounts: 4,
    }),
  );
  const surface = plot(page);

  expect(page.textContent).not.toContain("No linked sign-in methods recorded yet.");
  const ticks = Array.from(surface.querySelectorAll("text"), (tick) => tick.textContent);
  expect(ticks).toEqual(["GitHub", "Google"]);

  act(() => surface.focus());
  expect(tooltipText(page)).toBe("GitHubAccounts3");
});
