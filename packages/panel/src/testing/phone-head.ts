import { act } from "react";

export interface ReadPhoneHead {
  readonly start: readonly string[];
  readonly title: string | undefined;
  readonly end: readonly string[];
}

function namesIn(slot: Element | null): string[] {
  if (slot === null) return [];
  return [...slot.querySelectorAll("button")].map(
    (each) => each.getAttribute("aria-label") ?? each.textContent?.trim() ?? "",
  );
}

function standingHeads(root: ParentNode, place: string): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(`header.ui-toolbar[data-look="phone"].${place}-head`),
  ].filter((each) => each.closest("[hidden]") === null);
}

export function readPhoneHead(root: ParentNode, place: string): ReadPhoneHead {
  const heads = standingHeads(root, place);
  const [head] = heads;
  if (head === undefined || heads.length !== 1) throw new Error(`one ${place} header stands`);
  return {
    start: namesIn(head.querySelector(":scope > .ui-toolbar-lead")),
    title: head.querySelector(":scope > .ui-toolbar-heading h1")?.textContent ?? undefined,
    end: namesIn(head.querySelector(":scope > .ui-toolbar-actions")),
  };
}

export function pressInPhoneHead(root: ParentNode, place: string, label: string): void {
  const button = standingHeads(root, place)
    .flatMap((head) => [...head.querySelectorAll("button")])
    .find((each) => (each.getAttribute("aria-label") ?? each.textContent?.trim()) === label);
  if (button === undefined) throw new Error(`the ${place} header offers ${label}`);
  act(() => button.click());
}

export function menuItems(): { label: string; disabled: boolean }[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .ui-menu-item'),
  ].map((item) => ({
    label: item.querySelector(".ui-menu-item-label")?.textContent ?? "",
    disabled:
      item.getAttribute("aria-disabled") === "true" ||
      (item instanceof HTMLButtonElement && item.disabled),
  }));
}

export function chooseMenuItem(label: string): void {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .ui-menu-item'),
  ].find((each) => each.querySelector(".ui-menu-item-label")?.textContent === label);
  if (item === undefined) throw new Error(`${label} is in the menu`);
  act(() => item.click());
}
