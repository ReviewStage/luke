import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Segmented } from "./segmented.js";

/**
 * segmented.browser.test.ts -- a segmented control is a radio group: Tab
 * lands on the chosen option and leaves in one press, the arrows choose as
 * they move, a press on the chosen option takes it back only where the
 * control is clearable, and a row too narrow for it wraps its segments
 * inside the trough rather than running past the row.
 */

const EFFORTS = ["Low", "Medium", "High", "Highest"] as const;
type Effort = (typeof EFFORTS)[number];

/** An effort the caller holds, `clearable` as given. */
function EffortControl({ clearable = false }: { clearable?: boolean }): React.JSX.Element {
  const [effort, setEffort] = useState<Effort | undefined>("Medium");
  return createElement(
    "div",
    null,
    createElement(Segmented<Effort>, {
      legend: "Effort",
      options: EFFORTS.map((value) => ({ value, label: value })),
      value: effort,
      clearable,
      onChange: setEffort,
    }),
    createElement("button", { type: "button" }, "After"),
  );
}

test("Tab lands on the chosen option, the arrows choose as they move, and Tab leaves in one press", async () => {
  await mount(createElement(EffortControl));
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("radio", { name: "Medium" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("radio", { name: "High", checked: true })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
  await expect.element(page.getByRole("radio", { name: "Highest", checked: true })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "After" })).toHaveFocus();
});

test("a press on the chosen option takes it back only where the control is clearable", async () => {
  await mount(createElement(EffortControl));
  await page.getByRole("radio", { name: "Medium" }).click();
  await expect.element(page.getByRole("radio", { name: "Medium" })).toBeChecked();
  await mount(createElement(EffortControl, { clearable: true }));
  const clearable = page.getByRole("radiogroup").nth(1);
  await clearable.getByRole("radio", { name: "Medium" }).click();
  expect(clearable.getByRole("radio", { checked: true }).elements()).toHaveLength(0);
});

test("a row narrower than its segments wraps them inside the trough rather than running past the row", async () => {
  const { container } = await mount(
    createElement("div", { style: { width: 160 }, children: createElement(EffortControl) }),
  );
  const row = container.firstElementChild?.getBoundingClientRect();
  const group = container.querySelector('[role="radiogroup"]')?.getBoundingClientRect();
  const segments = [...container.querySelectorAll('[role="radio"]')].map((each) =>
    each.getBoundingClientRect(),
  );
  expect(group?.right).toBeLessThanOrEqual(row?.right ?? 0);
  expect(Math.max(...segments.map((each) => each.right))).toBeLessThanOrEqual(group?.right ?? 0);
  expect(new Set(segments.map((each) => each.top)).size).toBeGreaterThan(1);
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`a segmented control passes the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(createElement(EffortControl), surface);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
