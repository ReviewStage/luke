import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * scroll-fade.ts -- which edges of a scroller fade into what stands pinned there (base.css's `scroll-fade`), for jsdom.
 *
 * The fade is a mask whose two depths ride scroll timelines, and jsdom runs
 * no timeline and draws no mask. What it can say, with the sheets the fade
 * is written in laid into the document (`layFades`), is which of the fade's
 * two animations an element runs, the rise at its top edge and the lift at
 * its foot, and how far below its top the fade begins. Only the sheets
 * asked for, because jsdom parses every rule laid and matches it on every
 * style it computes, and the window's whole set makes a test take seconds.
 */

const STYLES = path.join(import.meta.dirname, "../renderer/styles");

/** The sheets a fade is written in: the fade itself, and the sheet of the logs that start it beneath a band of their own. */
export const FADE_SHEET = { FADE: "base.css", LOGS: "tasks.css" } as const;
export type FadeSheet = (typeof FADE_SHEET)[keyof typeof FADE_SHEET];

/** The keyframes that ease a scroller's top fade in, and its foot's out (base.css). */
const RISE = "scroll-fade-start";
const LIFT = "scroll-fade-end";

export type FadedEdges = {
  /** Content scrolled up past its top edge dissolves there. */
  top: boolean;
  /** Content below its foot dissolves there. */
  bottom: boolean;
};

/** Lays the sheets given (the fade's own by default) into the document, answering the style element, which the caller removes. */
export function layFades(sheets: readonly FadeSheet[] = [FADE_SHEET.FADE]): HTMLStyleElement {
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = sheets
    .map((name) => readFileSync(path.join(STYLES, name), "utf8"))
    .join("\n");
  return style;
}

/** The edges `scroller` fades at, as the laid sheets say. */
export function fadedEdges(scroller: Element): FadedEdges {
  const running = getComputedStyle(scroller)
    .animationName.split(",")
    .map((name) => name.trim());
  return { top: running.includes(RISE), bottom: running.includes(LIFT) };
}

/** How far below `scroller`'s top its fade begins, as the laid sheets spell it: where a band stuck there ends. */
export function fadeInsetTop(scroller: Element): string {
  return getComputedStyle(scroller).getPropertyValue("--fade-inset-top").trim();
}
