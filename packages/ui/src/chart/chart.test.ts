// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type ChartConfig, ChartContainer } from "./chart.js";

/**
 * chart.test.ts -- a chart's single-color series ride the container's own
 * style, so a page whose content security policy refuses inline stylesheets
 * still colors them, and only a series with a color per theme writes a
 * stylesheet; a key or color that fails validation costs its series the
 * variable, not the chart its render. What recharts puts in the tab order
 * keeps the window's focus ring.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  document.head.replaceChildren();
});

/** The chart's own sheet, named apart from the read so the bundler leaves the path a file. */
const SHEET = "./chart.css";

/**
 * The window's ring on everything, as the base layer draws it, under the
 * chart's sheet, its layer opened so jsdom keeps its rules. Note that the
 * ring is laid at no specificity, because jsdom weighs specificity across
 * layers and the components layer outranks the base whatever either weighs.
 */
function layUnderRing(): void {
  const ring = document.head.appendChild(document.createElement("style"));
  ring.textContent = "* { outline: 2px solid blue; }";
  const css = readFileSync(new URL(SHEET, import.meta.url), "utf8");
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = css.replace(/@layer [a-z-]+ \{([\s\S]*)\}\s*$/, "$1");
}

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

test("the plot and a pie, which Tab reaches, keep the ring; the parts it never reaches drop theirs", () => {
  layUnderRing();
  document.body.innerHTML = `
    <div class="luke-chart">
      <svg class="recharts-surface" tabindex="0">
        <g class="recharts-layer recharts-pie" tabindex="0">
          <path class="recharts-sector" tabindex="-1"></path>
        </g>
        <g class="recharts-layer"></g>
      </svg>
    </div>`;
  const outline = (selector: string) => {
    const part = document.querySelector(selector);
    if (part === null) throw new Error(`no ${selector} drawn`);
    return getComputedStyle(part).getPropertyValue("outline");
  };
  expect(outline(".recharts-surface")).toMatch(/\bsolid\b/);
  expect(outline(".recharts-pie")).toMatch(/\bsolid\b/);
  expect(outline(".recharts-sector")).toBe("none");
  expect(outline(".recharts-layer:not(.recharts-pie)")).toBe("none");
});
