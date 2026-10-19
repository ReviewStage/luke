import { act } from "react";

/**
 * segmented.ts -- a segmented control as a reader meets it: the radio group by its name, which option is checked, and where Tab lands in it.
 */

/** Fails the test where the control it reads is not drawn. */
function fail(reason: string): never {
  throw new Error(reason);
}

/** What a reader hears of a segmented control: its options in order, the checked one, and the one Tab lands on. */
export interface SegmentedReading {
  readonly options: readonly string[];
  readonly checked: readonly string[];
  readonly tabStops: readonly string[];
}

/** The radio group named `name` within `page`. */
export function segmentedGroup(page: ParentNode, name: string): HTMLElement {
  return (
    page.querySelector<HTMLElement>(`[role="radiogroup"][aria-label="${name}"]`) ??
    fail(`no ${name} radio group`)
  );
}

function radiosOf(group: HTMLElement): HTMLButtonElement[] {
  return [...group.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
}

/** The group's options, which are checked, and which take Tab. */
export function readSegmented(group: HTMLElement): SegmentedReading {
  const radios = radiosOf(group);
  const words = (each: HTMLElement) => each.textContent ?? "";
  return {
    options: radios.map(words),
    checked: radios.filter((each) => each.getAttribute("aria-checked") === "true").map(words),
    tabStops: radios.filter((each) => each.tabIndex === 0).map(words),
  };
}

/** The option reading `label`. */
export function segment(group: HTMLElement, label: string): HTMLButtonElement {
  return radiosOf(group).find((each) => each.textContent === label) ?? fail(`no ${label} option`);
}

/** Lands the keyboard on the group's tab stop, as Tab would, and presses `key` there. */
export function pressKeyIn(group: HTMLElement, key: string): void {
  const stop = radiosOf(group).find((each) => each.tabIndex === 0) ?? fail("no tab stop");
  act(() => {
    stop.focus();
    stop.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

/** The words of the option holding the keyboard. */
export function focusedSegment(): string | undefined {
  const focused = document.activeElement;
  return focused?.getAttribute("role") === "radio" ? (focused.textContent ?? "") : undefined;
}
