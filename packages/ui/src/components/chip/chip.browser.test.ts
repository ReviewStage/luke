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

test("a chip that keeps the keyboard while unavailable fades all it holds, its ring untouched, and does not light", async () => {
  const picture =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'/%3E";
  const { container } = await mount(
    createElement(
      "div",
      null,
      Object.values(CHIP_LOOK).map((look) =>
        createElement(Chip, {
          key: look,
          look,
          chevron: true,
          "aria-disabled": true,
          children: [
            createElement("img", { key: "picture", src: picture, alt: "" }),
            createElement("span", { key: "number", style: { color: "rgb(0, 160, 0)" } }, "#42"),
            look,
          ],
        }),
      ),
      createElement(Chip, { look: CHIP_LOOK.FIELD, children: "available" }),
    ),
  );
  const [toolbar, pill, field, available] = [...container.querySelectorAll("button")];
  for (const chip of [pill, toolbar, field]) {
    expect(chip && getComputedStyle(chip).opacity).toBe("1");
    const face = chip?.querySelector(".luke-chip-face");
    expect(face && getComputedStyle(face).opacity).toBe("0.45");
    expect(face?.querySelector("img")).not.toBeNull();
  }
  const availableFace = available?.querySelector(".luke-chip-face");
  expect(availableFace && getComputedStyle(availableFace).opacity).toBe("1");
  await userEvent.hover(page.getByRole("button", { name: "#42 field" }));
  expect(field && getComputedStyle(field).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

test("a field's chevron stands at its far end, with bare words as with a name", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8 } },
      createElement(
        "div",
        { style: { width: 104, display: "flex" } },
        createElement(Chip, { look: CHIP_LOOK.FIELD, chevron: true, children: "Member" }),
      ),
      createElement(
        "div",
        { style: { width: 104, display: "flex" } },
        createElement(Chip, {
          look: CHIP_LOOK.FIELD,
          chevron: true,
          children: createElement(ChipName, { children: "Member" }),
        }),
      ),
    ),
  );
  for (const chip of container.querySelectorAll("button")) {
    chip.style.width = "104px";
    const face = chip.querySelector(".luke-chip-face")?.getBoundingClientRect();
    const chevron = chip.querySelector(".settings-chevron")?.getBoundingClientRect();
    expect(chevron?.right).toBe(face?.right);
  }
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
