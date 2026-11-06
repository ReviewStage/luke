import { act } from "react";

const VIEW_OPTIONS = "View options";

export function openViewOptions(page: HTMLElement): void {
  const button = page.querySelector<HTMLButtonElement>(`button[aria-label="${VIEW_OPTIONS}"]`);
  if (button === null) throw new Error("no View options button");
  act(() => button.click());
}

export function menuItems(): { label: string; checked: string | null }[] {
  const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving])')];
  const menu = menus.at(-1);
  if (menu === undefined) throw new Error("no menu stands");
  return [...menu.querySelectorAll<HTMLElement>(".ui-menu-item")]
    .filter((item) => item.closest('[role="menu"]') === menu)
    .map((item) => ({
      label: item.querySelector(".ui-menu-item-label")?.textContent ?? "",
      checked: item.getAttribute("aria-checked"),
    }));
}

export function choose(...names: string[]): void {
  for (const name of names) {
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .ui-menu-item'),
    ].find((each) => each.querySelector(".ui-menu-item-label")?.textContent === name);
    if (item === undefined) throw new Error(`${name} is not in the menu`);
    act(() => item.click());
  }
}
