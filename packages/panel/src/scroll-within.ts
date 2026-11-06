import { askScroll } from "@repo/ui/scroll-asked";

/**
 * scroll-within.ts -- a reveal that scrolls one box alone, never every box around the element, so a pane still sliding in is not scrolled sideways after it.
 */

/**
 * Scrolls `lines` alone until `target` stands in its middle. Note that this
 * is not `scrollIntoView`, because that scrolls every box around the line as
 * well, and the panel often arrives sliding in from past the window's edge,
 * so the window's own layout would be scrolled sideways after it. The
 * scroll is asked for (`askScroll`), so a log it centers a line in leaves
 * its newest line for it.
 */
export function centerWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  askScroll(lines);
  lines.scrollTop += line.top + line.height / 2 - (box.top + box.height / 2);
}

/** Scrolls `lines` alone, the least it can, until `target` stands whole in it, as a list keeps the row a key stepped to in view. */
export function revealWithin(lines: HTMLElement, target: HTMLElement): void {
  const box = lines.getBoundingClientRect();
  const line = target.getBoundingClientRect();
  if (line.top < box.top) lines.scrollTop -= box.top - line.top;
  else if (line.bottom > box.bottom) lines.scrollTop += line.bottom - box.bottom;
}

/** The nearest box around an element that scrolls, which a reveal scrolls rather than every box around it; none where nothing around it scrolls. */
export function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = window.getComputedStyle(box);
    if ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight) {
      return box;
    }
  }
  return undefined;
}
