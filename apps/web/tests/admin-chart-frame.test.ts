// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SignInMethodsChart, SignupsChart } from "../src/admin/charts/signups-chart";
import { UsageChart } from "../src/admin/charts/usage-chart";

/**
 * admin-chart-frame.test.ts -- every admin chart is named by a heading a
 * reader can move to, with its trend, where it has one, set beside the name.
 * The windows below hold no data, so each chart draws its frame around the
 * line saying so rather than a plot jsdom cannot measure.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** A synthetic window: a week of days with nothing in them, read at noon on its last day. */
const EMPTY_WEEK = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"];
const GENERATED_AT = Date.UTC(2026, 9, 15, 12);
const TREND = { days: 7, recent: 3, prior: 2 };

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

/** The words of each heading a chart is named by. */
function chartHeadings(page: HTMLElement): string[] {
  return Array.from(page.querySelectorAll("h3"), (heading) => heading.textContent ?? "");
}

test("a trend chart is named by its heading, its trend read beside it", () => {
  const page = render(
    createElement("div", null, [
      createElement(SignupsChart, {
        key: "signups",
        daily: EMPTY_WEEK.map((day) => ({ day, count: 0 })),
        trend: TREND,
        generatedAt: GENERATED_AT,
      }),
      createElement(UsageChart, {
        key: "usage",
        daily: EMPTY_WEEK.map((day) => ({ day, calls: 0 })),
        trend: TREND,
        label: "Hosted-tier calls per day",
        generatedAt: GENERATED_AT,
      }),
    ]),
  );

  expect(chartHeadings(page)).toEqual(["New accounts per day", "Hosted-tier calls per day"]);
  expect(page.textContent?.split("+50% 3 in the last 7 days, against 2 before")).toHaveLength(3);
  expect(page.textContent).toContain("No accounts created in this window yet.");
  expect(page.textContent).toContain("No hosted-tier calls recorded in this window yet.");
});

test("a chart with no trend is named by its heading alone", () => {
  const page = render(
    createElement(SignInMethodsChart, {
      methods: { github: 0, google: 0, other: 0 },
      totalAccounts: 0,
    }),
  );

  expect(chartHeadings(page)).toEqual(["Linked sign-in methods"]);
  expect(page.textContent).not.toContain("in the last");
  expect(page.textContent).toContain("No linked sign-in methods recorded yet.");
});
