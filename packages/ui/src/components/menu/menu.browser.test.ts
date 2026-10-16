import { createElement, Fragment } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Menu, type MenuEntry, useMenu } from "./menu.js";

/**
 * menu.browser.test.ts -- a menu behaves as a system menu does: its button
 * opens it with focus on its first item, the arrows pass over an item that
 * does not apply now, a submenu opens beside its item and closes alone,
 * choosing an item acts, and Escape, Tab, or a press elsewhere closes it,
 * the keys handing focus back to what opened it.
 */

/** What a test's menu chose, in the order it chose it. */
type Chosen = string[];

function action(label: string, chosen: Chosen, extra: { disabled?: boolean } = {}) {
  return { label, onSelect: () => chosen.push(label), ...extra };
}

/** A ⋯ that drops `groups`, a button after it, and a row that right-clicks the same menu. */
function Harness({ groups }: { groups: readonly (readonly MenuEntry[])[] }): React.JSX.Element {
  const menu = useMenu(true);
  return createElement(
    Fragment,
    null,
    createElement("button", { type: "button", ...menu.trigger() }, "More"),
    createElement("button", { type: "button" }, "After"),
    createElement(
      "div",
      { "data-testid": "row", onContextMenu: menu.contextMenu(), style: { height: 40 } },
      "Row",
    ),
    menu.drawn === undefined
      ? null
      : createElement(Menu, {
          label: "Plan actions",
          menu: menu.drawn,
          groups,
          onClose: menu.close,
        }),
  );
}

/** A menu of Rename, a dimmed Move, and Archive, ruled from a red Delete. */
function planGroups(chosen: Chosen): readonly (readonly MenuEntry[])[] {
  return [
    [
      action("Rename", chosen),
      action("Move", chosen, { disabled: true }),
      action("Archive", chosen),
    ],
    [{ ...action("Delete", chosen), danger: true }],
  ];
}

/** A menu of two submenus, as a sidebar's View options is: Group by over Order by. */
function viewGroups(chosen: Chosen): readonly (readonly MenuEntry[])[] {
  const choice = (label: string) => ({ ...action(label, chosen), checked: false });
  return [
    [
      { label: "Group by", items: [choice("Repository"), choice("None")] },
      { label: "Order by", items: [choice("Last updated"), choice("Name")] },
    ],
  ];
}

/** The menu standing open, if one is: drawn and not on its way out. */
function openMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
}

test("the button opens the menu on its first item, the arrows pass over a dimmed item and wrap, and a choice acts and hands focus back", async () => {
  const chosen: Chosen = [];
  await mount(createElement(Harness, { groups: planGroups(chosen) }));
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  await expect.element(more).toHaveAttribute("aria-expanded", "true");
  await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitem", { name: "Archive" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(page.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  await expect.element(page.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
  await userEvent.keyboard("{End}{ArrowUp}{Enter}");
  expect(chosen).toEqual(["Archive"]);
  expect(openMenu()).toBeNull();
  await expect.element(more).toHaveFocus();
  await expect.element(more).toHaveAttribute("aria-expanded", "false");
});

test("Escape closes the menu with focus back on its button, and a second press on the button closes it too", async () => {
  await mount(createElement(Harness, { groups: planGroups([]) }));
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  await userEvent.keyboard("{Escape}");
  expect(openMenu()).toBeNull();
  await expect.element(more).toHaveFocus();
  await more.click();
  expect(openMenu()).not.toBeNull();
  await more.click();
  expect(openMenu()).toBeNull();
});

test("Tab closes the menu and goes on from its button to the next control", async () => {
  await mount(createElement(Harness, { groups: planGroups([]) }));
  await page.getByRole("button", { name: "More" }).click();
  await userEvent.keyboard("{Tab}");
  expect(openMenu()).toBeNull();
  await expect.element(page.getByRole("button", { name: "After" })).toHaveFocus();
});

test("a press elsewhere closes the menu and takes nothing it was offered", async () => {
  const chosen: Chosen = [];
  await mount(createElement(Harness, { groups: planGroups(chosen) }));
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId("row").click();
  expect(openMenu()).toBeNull();
  expect(chosen).toEqual([]);
});

test("a dimmed item takes no press", async () => {
  const chosen: Chosen = [];
  await mount(createElement(Harness, { groups: planGroups(chosen) }));
  await page.getByRole("button", { name: "More" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Move" })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move" }).click({ force: true });
  expect(chosen).toEqual([]);
  expect(openMenu()).not.toBeNull();
});

test("a right-click hangs the menu at the pointer, and one near the window's corner stays inside it", async () => {
  await mount(createElement(Harness, { groups: planGroups([]) }));
  const row = page.getByTestId("row");
  await row.click({ button: "right", position: { x: 40, y: 10 } });
  const bounds = row.element().getBoundingClientRect();
  const atPointer = openMenu()?.getBoundingClientRect();
  expect(atPointer?.left).toBeCloseTo(bounds.left + 40, 0);
  expect(atPointer?.top).toBeCloseTo(bounds.top + 10, 0);
  await userEvent.keyboard("{Escape}");

  row
    .element()
    .setAttribute(
      "style",
      `position: fixed; left: ${window.innerWidth - 20}px; top: ${window.innerHeight - 20}px; width: 10px; height: 10px`,
    );
  await row.click({ button: "right" });
  const cornered = openMenu()?.getBoundingClientRect();
  expect(cornered?.right).toBeLessThanOrEqual(window.innerWidth);
  expect(cornered?.bottom).toBeLessThanOrEqual(window.innerHeight);
});

test("Right opens a submenu on its first item, and Left or Escape closes it alone, focus back on its item", async () => {
  const chosen: Chosen = [];
  await mount(createElement(Harness, { groups: viewGroups(chosen) }));
  await page.getByRole("button", { name: "More" }).click();
  const groupBy = page.getByRole("menuitem", { name: "Group by" });
  await expect.element(groupBy).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Repository" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(page.getByRole("menuitemcheckbox", { name: "None" })).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(groupBy).toHaveFocus();
  expect(page.getByRole("menu", { name: "Group by" }).elements()).toHaveLength(0);

  await userEvent.keyboard("{ArrowRight}{Escape}");
  await expect.element(groupBy).toHaveFocus();
  expect(openMenu()?.getAttribute("aria-label")).toBe("Plan actions");

  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(chosen).toEqual(["Repository"]);
  expect(openMenu()).toBeNull();
});

test("resting on one submenu's item after another's opens the second's submenu, with no press", async () => {
  await mount(createElement(Harness, { groups: viewGroups([]) }));
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Group by" }).hover();
  await expect.element(page.getByRole("menu", { name: "Group by" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Order by" }).hover();
  await expect.element(page.getByRole("menu", { name: "Order by" })).toBeVisible();
  expect(page.getByRole("menu", { name: "Group by" }).elements()).toHaveLength(0);
  await page.getByRole("menuitemcheckbox", { name: "Name" }).hover();
  await expect.element(page.getByRole("menu", { name: "Order by" })).toBeVisible();
});

test("a submenu stands beside its menu, its first item level with the item that opened it", async () => {
  await mount(createElement(Harness, { groups: viewGroups([]) }));
  await page.getByRole("button", { name: "More" }).click();
  await userEvent.keyboard("{ArrowRight}");
  const menu = page.getByRole("menu", { name: "Plan actions" }).element().getBoundingClientRect();
  const opener = page.getByRole("menuitem", { name: "Group by" }).element().getBoundingClientRect();
  const first = page.getByRole("menuitemcheckbox", { name: "Repository" }).element();
  expect(first.getBoundingClientRect().left).toBeGreaterThan(menu.right);
  // Note that level is to within the surface's hairline, which the rise by its inset leaves out.
  expect(Math.abs(first.getBoundingClientRect().top - opener.top)).toBeLessThanOrEqual(1);
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`an open menu passes the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(createElement(Harness, { groups: planGroups([]) }), surface);
    await page.getByRole("button", { name: "More" }).click();
    const menu = openMenu() ?? expect.fail("the menu stands open");
    expect(await accessibilityViolations(menu)).toEqual([]);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
