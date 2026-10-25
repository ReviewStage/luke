/**
 * laid-length.ts -- a length as the stylesheets laid for jsdom (`container-width.ts`) say it, in pixels, and the room a phone's bar leaves between its way back and the page under it.
 *
 * jsdom lays nothing out and answers a `var()` as it is spelled, so a length
 * built from the tokens reads as its formula. `pixelsOf` reads each custom
 * property it names where the element stands and works the `calc()` out;
 * `wayBackGap` reads, from a bar and the box that opens the page under it,
 * how far below the way back the page's first line stands.
 */

import assert from "node:assert/strict";

/** A custom property a length names. */
const NAMED = /var\((--[\w-]+)\)/u;

/** `sum`'s value: numbers under `+`, `-`, `*`, `/`, and brackets, as `calc()` takes them. */
function arithmetic(sum: string): number {
  const tokens = sum.match(/\d+(?:\.\d+)?|[-+*/()]/gu) ?? [];
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const value = terms();
      at += 1;
      return value;
    }
    if (token === "-") return -factor();
    return Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === "*" || tokens[at] === "/") {
      value = tokens[at++] === "*" ? value * factor() : value / factor();
    }
    return value;
  };
  const terms = (): number => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      value = tokens[at++] === "+" ? value + product() : value - product();
    }
    return value;
  };
  return terms();
}

/** `length` on `element` in pixels: each custom property it names read where the element stands, and its `calc()` worked out. */
export function pixelsOf(element: Element, length: string): number {
  const style = getComputedStyle(element);
  let spelled = length;
  for (let named = NAMED.exec(spelled); named !== null; named = NAMED.exec(spelled)) {
    const [whole, property = ""] = named;
    spelled = spelled.replace(whole, `(${style.getPropertyValue(property).trim()})`);
  }
  const sum = spelled.replace(/calc/gu, "").replace(/px/gu, "");
  assert.match(sum, /^[\d\s.+\-*/()]+$/u, `${length} works out to a length`);
  const pixels = arithmetic(sum);
  assert.ok(Number.isFinite(pixels), `${length} works out to a length`);
  return pixels;
}

/**
 * How far below the way back in `bar` the page's first line stands, where
 * `opening` is the box that opens the page under the bar: the room the bar's
 * row leaves under its way back, which it centres in the row, and the box's
 * own top padding.
 */
export function wayBackGap(bar: HTMLElement, opening: HTMLElement): number {
  const back = bar.querySelector("button") ?? assert.fail("the bar leads with a way back");
  const row = pixelsOf(bar, getComputedStyle(bar).minHeight);
  const control = pixelsOf(back, "var(--luke-control-height)");
  return (row - control) / 2 + pixelsOf(opening, getComputedStyle(opening).paddingTop);
}
