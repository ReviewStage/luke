// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type ChartConfig, ChartContainer } from "./chart.js";

/**
 * chart.test.ts -- a chart's single-color series ride the container's own
 * style, so a page whose content security policy refuses inline stylesheets
 * still colors them, and only a series with a color per theme writes a
 * stylesheet; a key or color that fails validation costs its series the
 * variable, not the chart its render.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The chart's container, drawn with `config` around an empty plot. */
function draw(config: ChartConfig): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(createElement(ChartContainer, { config, children: createElement("svg") })),
  );
  const chart = container.querySelector<HTMLElement>("[data-slot=chart]");
  if (chart === null) throw new Error("no chart drawn");
  return chart;
}

test("single-color series ride the container's style and write no stylesheet", () => {
  const chart = draw({
    calls: { label: "Calls", color: "var(--luke-color-chart-1)" },
    tasks: { label: "Tasks", color: "#336699" },
  });

  expect(chart.style.getPropertyValue("--color-calls")).toBe("var(--luke-color-chart-1)");
  expect(chart.style.getPropertyValue("--color-tasks")).toBe("#336699");
  expect(chart.querySelector("style")).toBeNull();
});

test("a series with a color per theme writes its rules, and a single-color one beside it still rides the style", () => {
  const chart = draw({
    calls: { label: "Calls", theme: { light: "#111111", dark: "#eeeeee" } },
    tasks: { label: "Tasks", color: "#336699" },
  });

  const sheet = chart.querySelector("style")?.textContent ?? "";
  expect(sheet).toContain("--color-calls: #111111;");
  expect(sheet).toContain("--color-calls: #eeeeee;");
  expect(sheet).not.toContain("--color-tasks");
  expect(chart.style.getPropertyValue("--color-tasks")).toBe("#336699");
});

test("a key or color that fails validation is left out, and the rest still draw", () => {
  const chart = draw({
    "bad key;": { label: "Bad key", color: "#336699" },
    injected: { label: "Injected", color: "red; background: url(evil)" },
    calls: { label: "Calls", color: "#336699" },
  });

  expect(chart.getAttribute("style")).not.toContain("evil");
  expect(chart.style.getPropertyValue("--color-injected")).toBe("");
  expect(chart.style.getPropertyValue("--color-calls")).toBe("#336699");
});
