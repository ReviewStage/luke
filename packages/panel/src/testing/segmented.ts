import { act } from "react";

function fail(reason: string): never {
  throw new Error(reason);
}

export interface SegmentedReading {
  readonly options: readonly string[];
  readonly checked: readonly string[];
  readonly tabStops: readonly string[];
}

export function segmentedGroup(page: ParentNode, name: string): HTMLElement {
  return (
    page.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${name}"]`) ??
    fail(`no ${name} radio group`)
  );
}

function radiosOf(group: HTMLElement): HTMLButtonElement[] {
  return [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

export function readSegmented(group: HTMLElement): SegmentedReading {
  const radios = radiosOf(group);
  const words = (each: HTMLElement) => each.textContent ?? "";
  return {
    options: radios.map(words),
    checked: radios.filter((each) => each.getAttribute("aria-checked") === "true").map(words),
    tabStops: radios.filter((each) => each.tabIndex === 0).map(words),
  };
}

export function segment(group: HTMLElement, label: string): HTMLButtonElement {
  return radiosOf(group).find((each) => each.textContent === label) ?? fail(`no ${label} option`);
}

export function pressKeyIn(group: HTMLElement, key: string): void {
  const stop = radiosOf(group).find((each) => each.tabIndex === 0) ?? fail("no tab stop");
  act(() => {
    stop.focus();
    stop.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

export function focusedSegment(): string | undefined {
  const focused = document.activeElement;
  return focused?.getAttribute("role") === "radio" ? (focused.textContent ?? "") : undefined;
}
