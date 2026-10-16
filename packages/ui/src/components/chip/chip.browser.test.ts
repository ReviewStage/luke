import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { CompatChip } from "../../compat.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { CHIP_LOOK, Chip, ChipName } from "./chip.js";

/**
 * chip.browser.test.ts -- a chip is a button named by its words, says when
 * the menu it opens stands open, cuts its words short rather than leave its
 * row, passes the accessibility check in every look, and the compatibility
 * twin is the same control with its caller's class beside it.
 */

/** A field chip opening a menu, which says whether it stands open. */
function Picker(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return createElement(Chip, {
    look: CHIP_LOOK.FIELD,
    chevron: true,
    "aria-haspopup": "listbox",
    "aria-expanded": open,
    onClick: () => setOpen(!open),
    children: createElement(ChipName, { children: "Opus" }),
  });
}

test("a chip is pressed by the keyboard and says when the menu it opens stands open", async () => {
  await mount(createElement(Picker));
  await userEvent.keyboard("{Tab}");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("button", { name: "Opus", expanded: true })).toHaveFocus();
});

test("a chip in a narrow row cuts its words short rather than leaving the row", async () => {
  const { container } = await mount(
    createElement("div", {
      style: { width: 120 },
      children: createElement(Chip, {
        look: CHIP_LOOK.PILL,
        children: createElement(ChipName, { children: "acme/a-repository-with-a-long-name" }),
      }),
    }),
  );
  const chip = container.querySelector("button");
  const name = container.querySelector(".luke-chip-name");
  expect(chip?.getBoundingClientRect().width).toBeLessThanOrEqual(120);
  expect(name && name.scrollWidth > name.clientWidth).toBe(true);
});

test("a chip that keeps the keyboard while unavailable fades all it holds and does not light", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { color: "rgb(255, 0, 0)" } },
      Object.values(CHIP_LOOK).map((look) =>
        createElement(Chip, {
          key: look,
          look,
          chevron: true,
          "aria-disabled": true,
          children: createElement(ChipName, { children: look }),
        }),
      ),
    ),
  );
  for (const chip of container.querySelectorAll("button")) {
    for (const part of chip.children) expect(getComputedStyle(part).opacity).toBe("0.45");
    expect(getComputedStyle(chip).color).not.toBe("rgb(255, 0, 0)");
  }
  await userEvent.hover(page.getByRole("button", { name: "field" }));
  const field = container.querySelector('[data-look="field"]');
  expect(field && getComputedStyle(field).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`every look passes the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(
      createElement(
        "div",
        null,
        Object.values(CHIP_LOOK).map((look) =>
          createElement(Chip, { key: look, look, chevron: true, children: look }),
        ),
      ),
      surface,
    );
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}

test("the compatibility twin is the same chip with its caller's class beside its own", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      createElement(Chip, { look: CHIP_LOOK.FIELD, chevron: true, children: "Opus" }),
      createElement(CompatChip, {
        look: CHIP_LOOK.FIELD,
        chevron: true,
        className: "settings-picker-chip",
        children: "Opus",
      }),
    ),
  );
  const [shared, twin] = container.querySelectorAll("button");
  expect(twin?.classList.contains("settings-picker-chip")).toBe(true);
  twin?.classList.remove("settings-picker-chip");
  expect(twin?.outerHTML).toBe(shared?.outerHTML);
});
