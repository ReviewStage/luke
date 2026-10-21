import { act } from "react";

/**
 * view-options.ts -- the admin toolbar's View options as a reader presses
 * them: the button opened, a submenu's items named in order, and what the
 * menus standing offer.
 */

/** What the button and its menu are called. */
const VIEW_OPTIONS = "View options";

/** The View options button on `page`, pressed. */
export function openViewOptions(page: HTMLElement): void {
  const button = page.querySelector<HTMLButtonElement>(`button[aria-label="${VIEW_OPTIONS}"]`);
  if (button === null) throw new Error("no View options button");
  act(() => button.click());
}

/** The items the newest menu standing offers, by their labels, and whether each is checked. */
export function menuItems(): { label: string; checked: string | null }[] {
  const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving])')];
  const menu = menus.at(-1);
  if (menu === undefined) throw new Error("no menu stands");
  return [...menu.querySelectorAll<HTMLElement>(".luke-menu-item")]
    .filter((item) => item.closest('[role="menu"]') === menu)
    .map((item) => ({
      label: item.querySelector(".luke-menu-item-label")?.textContent ?? "",
      checked: item.getAttribute("aria-checked"),
    }));
}

/** Presses the standing menus' items named `names`, in order: a submenu, then its items. */
export function choose(...names: string[]): void {
  for (const name of names) {
    const item = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menu"]:not([data-leaving]) .luke-menu-item',
      ),
    ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === name);
    if (item === undefined) throw new Error(`${name} is not in the menu`);
    act(() => item.click());
  }
}
