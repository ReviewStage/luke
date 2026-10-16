import { createElement } from "react";
import { expect, test } from "vitest";
import { mount } from "../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../tokens/surface.js";
import { ChartContainer } from "./chart.js";

/**
 * chart.browser.test.ts -- a series given a colour per theme is drawn in the
 * one the page it stands on is drawn in.
 */

const CONFIG = { signups: { theme: { light: "#0d6e80", dark: "#2f9bd8" } } };

/** The colour the chart hands its `signups` series, as the page computes it. */
function seriesColour(container: HTMLElement): string {
  const chart = container.querySelector("[data-chart]");
  return chart === null ? "" : getComputedStyle(chart).getPropertyValue("--color-signups").trim();
}

for (const [theme, colour] of [
  [THEME.DARK, CONFIG.signups.theme.dark],
  [THEME.LIGHT, CONFIG.signups.theme.light],
] as const) {
  test(`a page drawn ${theme} gives a series its ${theme} colour`, async () => {
    const { container } = await mount(
      createElement(ChartContainer, { config: CONFIG, children: createElement("div") }),
      surfaceAttributes(PROFILE.WEB, theme),
    );
    expect(seriesColour(container)).toBe(colour);
  });
}
