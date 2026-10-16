import { createElement } from "react";
import { expect, test } from "vitest";
import { CheckIcon } from "../../face/glyphs.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Inline } from "../layout/layout.js";
import { BADGE_TONE, Badge } from "./badge.js";

/**
 * badge.browser.test.ts -- every tone says its state in words a reader
 * hears, which the colour only repeats, at a contrast every theme holds; and
 * a label longer than its row wraps inside it rather than painting past it.
 */

const SAYS = {
  [BADGE_TONE.NEUTRAL]: "Draft",
  [BADGE_TONE.WORKING]: "Working",
  [BADGE_TONE.ATTENTION]: "Needs you",
  [BADGE_TONE.COMPLETE]: "Connected",
  [BADGE_TONE.MERGED]: "Merged",
  [BADGE_TONE.DANGER]: "Failed",
} as const;

function badges(): React.JSX.Element {
  return createElement(
    "p",
    null,
    Object.values(BADGE_TONE).map((tone) =>
      createElement(Badge, {
        key: tone,
        tone,
        icon: tone === BADGE_TONE.COMPLETE ? createElement(CheckIcon) : undefined,
        children: SAYS[tone],
      }),
    ),
  );
}

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`every tone says its state in words at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}, at a contrast that holds`, async () => {
    const { container } = await mount(badges(), surface);
    expect(container.textContent).toBe(Object.values(SAYS).join(""));
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}

test("a label wider than its row stays inside the row, every word still shown", async () => {
  const label = "Waiting for administrator approval";
  const { container } = await mount(
    createElement(
      "div",
      { style: { width: "120px" } },
      createElement(
        Inline,
        null,
        createElement(Badge, { tone: BADGE_TONE.ATTENTION, children: label }),
      ),
    ),
  );
  const row = container.querySelector(".luke-inline");
  const badge = container.querySelector(".luke-badge");
  if (!(row instanceof HTMLElement) || !(badge instanceof HTMLElement))
    throw new Error("not drawn");
  expect(badge.textContent).toBe(label);
  expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(
    row.getBoundingClientRect().right,
  );
  expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth);
});
