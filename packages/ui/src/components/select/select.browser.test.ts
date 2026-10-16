import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { SELECT_ALIGN, Select, type SelectAlign } from "./select.js";

/**
 * select.browser.test.ts -- a select is a pop-up button: its field names the
 * chosen value, its menu opens on that value from a press or the keyboard,
 * the arrows pass over a value that cannot be chosen now, a choice changes
 * the value and hands focus back to the field, and Escape, Tab, or a press
 * elsewhere closes it choosing nothing.
 */

const THEMES = ["System", "Light", "Dark", "Sepia"] as const;
type Theme = (typeof THEMES)[number];

/** A theme the caller holds, every change it is handed in order, and a button after the field. */
function ThemeSelect({
  changes,
  disabled = false,
  align = SELECT_ALIGN.START,
}: {
  changes: Theme[];
  disabled?: boolean;
  align?: SelectAlign;
}): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>("Light");
  return createElement(
    "div",
    { style: { display: "flex", gap: 8, paddingLeft: 200 } },
    createElement(Select<Theme>, {
      label: "Theme",
      options: THEMES.map((value) => ({ value, label: value, disabled: value === "Dark" })),
      value: theme,
      disabled,
      align,
      onChange: (next) => {
        changes.push(next);
        setTheme(next);
      },
    }),
    createElement("button", { type: "button" }, "After"),
  );
}

/** The menu standing open, if one is: drawn and not on its way out. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

test("the field names the chosen value and opens on it, the arrows pass over a dimmed value, and a choice changes the value and hands focus back", async () => {
  const changes: Theme[] = [];
  await mount(createElement(ThemeSelect, { changes }));
  const field = page.getByRole("button", { name: "Theme: Light" });
  await field.click();
  await expect.element(field).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Light", checked: true }))
    .toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Sepia" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(changes).toEqual(["Sepia"]);
  expect(openMenu()).toBeNull();
  await expect.element(page.getByRole("button", { name: "Theme: Sepia" })).toHaveFocus();
});

test("the keyboard opens the field's menu, and choosing the value it already holds changes nothing", async () => {
  const changes: Theme[] = [];
  await mount(createElement(ThemeSelect, { changes }));
  await userEvent.keyboard("{Tab}{Enter}");
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Light", checked: true }))
    .toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(changes).toEqual([]);
  expect(openMenu()).toBeNull();
  await expect.element(page.getByRole("button", { name: "Theme: Light" })).toHaveFocus();
});

test("Escape closes the menu choosing nothing, with focus back on the field", async () => {
  const changes: Theme[] = [];
  await mount(createElement(ThemeSelect, { changes }));
  await page.getByRole("button", { name: "Theme: Light" }).click();
  await userEvent.keyboard("{ArrowDown}{Escape}");
  expect(openMenu()).toBeNull();
  expect(changes).toEqual([]);
  await expect.element(page.getByRole("button", { name: "Theme: Light" })).toHaveFocus();
});

test("Tab closes the menu and goes on to the next control, and a press elsewhere closes it choosing nothing", async () => {
  const changes: Theme[] = [];
  await mount(createElement(ThemeSelect, { changes }));
  const field = page.getByRole("button", { name: "Theme: Light" });
  await field.click();
  await userEvent.keyboard("{Tab}");
  expect(openMenu()).toBeNull();
  await expect.element(page.getByRole("button", { name: "After" })).toHaveFocus();
  await field.click();
  expect(openMenu()).not.toBeNull();
  await page.getByRole("button", { name: "After" }).click();
  expect(openMenu()).toBeNull();
  expect(changes).toEqual([]);
});

test("a dimmed value takes no press", async () => {
  const changes: Theme[] = [];
  await mount(createElement(ThemeSelect, { changes }));
  await page.getByRole("button", { name: "Theme: Light" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Dark" }).click({ force: true });
  expect(changes).toEqual([]);
  expect(openMenu()).not.toBeNull();
});

test("a field that cannot be used opens no menu", async () => {
  await mount(createElement(ThemeSelect, { changes: [], disabled: true }));
  const field = page.getByRole("button", { name: "Theme: Light" });
  await expect.element(field).toBeDisabled();
  await field.click({ force: true });
  expect(openMenu()).toBeNull();
});

test("a field with no value that can be chosen now is unavailable and opens no menu", async () => {
  await mount(
    createElement(Select<Theme>, {
      label: "Theme",
      options: [{ value: "Light", label: "Light", disabled: true }],
      value: "Light",
      onChange: () => undefined,
    }),
  );
  const field = page.getByRole("button", { name: "Theme: Light" });
  await expect.element(field).toBeDisabled();
  await field.click({ force: true });
  expect(openMenu()).toBeNull();
});

test("the menu hangs under the field from its leading edge, or from its trailing edge where asked", async () => {
  for (const align of [SELECT_ALIGN.START, SELECT_ALIGN.END]) {
    const { container } = await mount(createElement(ThemeSelect, { changes: [], align }));
    const field = container.querySelector("button");
    field?.click();
    await expect.poll(() => openMenu()?.dataset.placed).toBe("true");
    const below = field?.getBoundingClientRect();
    const menu = openMenu()?.getBoundingClientRect();
    expect(menu?.top).toBeGreaterThan(below?.bottom ?? Number.POSITIVE_INFINITY);
    if (align === SELECT_ALIGN.START) expect(menu?.left).toBeCloseTo(below?.left ?? 0, 0);
    else expect(menu?.right).toBeCloseTo(below?.right ?? 0, 0);
    await userEvent.keyboard("{Escape}");
  }
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`a select and its open menu pass the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(createElement(ThemeSelect, { changes: [] }), surface);
    await page.getByRole("button", { name: "Theme: Light" }).click();
    const menu = openMenu() ?? expect.fail("the menu stands open");
    expect(await accessibilityViolations(menu)).toEqual([]);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
