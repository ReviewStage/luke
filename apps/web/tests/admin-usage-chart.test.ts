// @vitest-environment jsdom

import { UsageChart } from "@repo/panel/admin/charts/usage-chart";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DAILY = [
  { day: "2026-10-13", calls: 2 },
  { day: "2026-10-14", calls: 3 },
  { day: "2026-10-15", calls: 5 },
];
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

function renderUsageChart(): HTMLElement {
  return render(
    createElement(UsageChart, {
      daily: DAILY,
      trend: TREND,
      label: "Hosted-tier calls per day",
      generatedAt: GENERATED_AT,
    }),
  );
}

function plot(page: HTMLElement): SVGElement {
  const surface = page.querySelector<SVGElement>("svg[tabindex='0']");
  if (surface === null) throw new Error("the chart drew no plot");
  return surface;
}

function tooltipText(page: HTMLElement): string {
  return page.querySelector(".recharts-tooltip-wrapper")?.textContent ?? "";
}

function press(target: SVGElement, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

test("a usage chart names each day it draws on its axis", () => {
  const page = renderUsageChart();

  const ticks = Array.from(plot(page).querySelectorAll("text"), (tick) => tick.textContent);
  expect(ticks).toEqual(expect.arrayContaining(["Oct 13", "Oct 14", "Oct 15"]));
});

test("stepping through a usage chart's days reads each day's count", () => {
  const page = renderUsageChart();
  const surface = plot(page);
  expect(tooltipText(page)).toBe("");

  act(() => surface.focus());
  expect(tooltipText(page)).toBe("Oct 13Hosted calls2");

  press(surface, "ArrowRight");
  expect(tooltipText(page)).toBe("Oct 14Hosted calls3");

  press(surface, "ArrowRight");
  expect(tooltipText(page)).toBe("Oct 15 (so far today)Hosted calls5");

  press(surface, "ArrowLeft");
  expect(tooltipText(page)).toBe("Oct 14Hosted calls3");

  act(() => surface.blur());
  expect(tooltipText(page)).toBe("");
});
