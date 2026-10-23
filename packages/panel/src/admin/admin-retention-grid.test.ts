// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import type { AdminMetrics } from "@luke/features/admin-answer-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { RetentionGrid } from "./charts/retention-grid.js";

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

/** The web palettes the admin page is drawn in, by theme, as `@luke/ui`'s `palettes.css` writes them. */
const PALETTES = readFileSync(
  path.join(import.meta.dirname, "../../../ui/src/tokens/palettes.css"),
  "utf8",
);
const WEB_THEMES = {
  light: '[data-luke-profile="web"][data-luke-theme="light"] {',
  dark: '[data-luke-profile="web"][data-luke-theme="dark"] {',
} as const;

/** An `oklch(L C H)` colour as red, green, blue (0 to 255) and alpha, by Björn Ottosson's OKLab matrices, as `tokens.test.ts` reads one. */
function oklchToRgb(lightness: number, chroma: number, hue: number): number[] {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) =>
    255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    1,
  ];
}

/** A palette value in one theme's rule, an `#rgb`, `#rrggbb`, `oklch()`, or `rgba()` as red, green, blue, alpha. */
function tokenOf(theme: keyof typeof WEB_THEMES, name: string): number[] {
  const start = PALETTES.indexOf(WEB_THEMES[theme]);
  const rule = PALETTES.slice(start, PALETTES.indexOf("\n}", start));
  const value = new RegExp(`${name}: ([^;]+);`).exec(rule)?.[1] ?? "";
  const short = /^#([0-9a-f]{3})$/i.exec(value)?.[1];
  const hex = short
    ? [...short].map((digit) => digit + digit).join("")
    : /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).concat(1);
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  const rgba = /^rgba?\((.*)\)$/.exec(value)?.[1];
  expect(rgba, `${name} in ${theme}`).toBeDefined();
  return (rgba ?? "").split(",").map(Number).concat(1).slice(0, 4);
}

/** `top` laid over the opaque `ground` at `top`'s alpha, as a browser composites it. */
function over(top: number[], ground: number[]): number[] {
  const alpha = top[3] ?? 1;
  return [0, 1, 2].map((at) => (top[at] ?? 0) * alpha + (ground[at] ?? 0) * (1 - alpha));
}

/** The WCAG 2 contrast ratio of two opaque colours. */
function contrastOf(a: number[], b: number[]): number {
  const luminance = (colour: number[]) =>
    [0.2126, 0.7152, 0.0722].reduce((sum, weight, at) => {
      const channel = (colour[at] ?? 0) / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + weight * linear;
    }, 0);
  const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test("every share's words read at AA on its cell, on the admin card, in both themes", () => {
  const cells = Array.from({ length: 21 }, (_, step) => ({
    offset: step,
    activeAccounts: step,
    share: step / 20,
    inProgress: false,
  }));
  const page = render({ weeks: 21, cohorts: [{ weekStart: "2026-09-28", size: 20, cells }] });

  const drawn = Array.from(page.querySelectorAll<HTMLElement>("div[title]")).filter((cell) =>
    cell.getAttribute("style")?.includes("color-mix"),
  );
  expect(drawn.length).toBeGreaterThan(10);
  for (const theme of ["light", "dark"] as const) {
    const card = tokenOf(theme, "--luke-color-surface");
    for (const cell of drawn) {
      const style = cell.getAttribute("style") ?? "";
      const fill = Number(/(\d+)%, transparent/.exec(style)?.[1]) / 100;
      const ink = /color: var\((--luke-color-[\w-]+)\)/.exec(style)?.[1] ?? "";
      const ground = over([...tokenOf(theme, "--luke-color-chart-1").slice(0, 3), fill], card);
      const ratio = contrastOf(over(tokenOf(theme, ink), ground), ground);
      expect(ratio, `${cell.textContent} in ${theme} reads ${ink}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
