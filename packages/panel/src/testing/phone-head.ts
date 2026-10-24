import { act } from "react";

/**
 * phone-head.ts -- a phone's header read as a reader meets it (`desktop/phone-head.tsx`): each corner's controls by name and the title between them, and the ⋯'s items once it is pressed.
 */

/** A phone's header as it reads: the start corner's controls, the title centred between the corners, and the end corner's controls. */
export interface ReadPhoneHead {
  readonly start: readonly string[];
  readonly title: string | undefined;
  readonly end: readonly string[];
}

/** The names of the controls in one of the header's three places, none where the place is not drawn. */
function namesIn(slot: Element | null): string[] {
  if (slot === null) return [];
  return [...slot.querySelectorAll("button")].map(
    (each) => each.getAttribute("aria-label") ?? each.textContent?.trim() ?? "",
  );
}

/** The phone's headers heading `place` within `root` that stand, as `Toolbar`'s phone look draws them. */
function standingHeads(root: ParentNode, place: string): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(`header.luke-toolbar[data-look="phone"].${place}-head`),
  ].filter((each) => each.closest("[hidden]") === null);
}

/** The header heading `place` within `root`, the one standing where several are drawn, by its corners and its title. */
export function readPhoneHead(root: ParentNode, place: string): ReadPhoneHead {
  const heads = standingHeads(root, place);
  const [head] = heads;
  if (head === undefined || heads.length !== 1) throw new Error(`one ${place} header stands`);
  return {
    start: namesIn(head.querySelector(":scope > .luke-toolbar-lead")),
    title: head.querySelector(":scope > .luke-toolbar-heading h1")?.textContent ?? undefined,
    end: namesIn(head.querySelector(":scope > .luke-toolbar-actions")),
  };
}

/** Presses the control named `label` in the standing header heading `place`. */
export function pressInPhoneHead(root: ParentNode, place: string, label: string): void {
  const button = standingHeads(root, place)
    .flatMap((head) => [...head.querySelectorAll("button")])
    .find((each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === label);
  if (button === undefined) throw new Error(`the ${place} header offers ${label}`);
  act(() => button.click());
}

/** The open menu's items as a reader meets them: each one's words, and whether it is unavailable. */
export function menuItems(): { label: string; disabled: boolean }[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .luke-menu-item'),
  ].map((item) => ({
    label: item.querySelector(".luke-menu-item-label")?.textContent ?? "",
    disabled:
      item.getAttribute("aria-disabled") === "true" ||
      (item instanceof HTMLButtonElement && item.disabled),
  }));
}

/** Presses the open menu's item whose words are `label`. */
export function chooseMenuItem(label: string): void {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .luke-menu-item'),
  ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === label);
  if (item === undefined) throw new Error(`${label} is in the menu`);
  act(() => item.click());
}
