// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CommandDialog } from "@luke/ui/command";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "./testing/container-width.js";

/**
 * short-windows.test.ts -- ⌘K in a window too short for its usual share:
 * the card stands two thirds of what is seen, as it always did, in a tall
 * window, and in a short one it takes what keeps three rows of its list
 * (and its field, band and foot) and moves up to make room, never standing
 * past the window. jsdom lays nothing out and resolves no `var()`, so the
 * stylesheets are laid (`testing/container-width.ts`) and a length is read
 * with its custom properties resolved and its arithmetic worked out.
 * Synthetic throughout.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** What a window of each height is, in pixels, and what a row of the list is. */
const WINDOW = { TALL: 900, SHORT: 260 } as const;
const MENU_ROW = 32;
const ROWS_KEPT = 3;
/** What the card's field, band and foot take of its height, as drawn. */
const CHROME = 125;

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => undefined;
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-luke-profile");
  document.documentElement.removeAttribute("data-luke-room");
});

/** A declared value with every `var()` replaced by what `element` inherits for it. */
function resolved(element: Element, value: string): string {
  const next = value.replace(/var\((--[\w-]+)\)/u, (_, name: string) => {
    const declared = getComputedStyle(element).getPropertyValue(name).trim();
    return declared === "" ? assert.fail(`${name} is declared`) : declared;
  });
  return next === value ? value : resolved(element, next);
}

/** A length's pixels: its `var()`s resolved for `element`, and its `calc()`, `min()` and `max()` worked out. */
function pixels(element: Element, value: string): number {
  const arithmetic = resolved(element, value)
    .replace(/\bcalc\(/gu, "(")
    .replace(/\bmin\(/gu, "Math.min(")
    .replace(/\bmax\(/gu, "Math.max(")
    .replace(/(-?\d*\.?\d+)px/gu, "$1");
  assert.match(arithmetic, /^[\d\s.+\-*/(),Mathminx]+$/u, `${value} is pixels alone`);
  return Number(new Function(`return ${arithmetic};`)());
}

/** The palette open over a window `height` tall, in `room`; answers its card and the dimmed window around it. */
async function paletteIn(
  height: number,
  room: "narrow" | "wide",
): Promise<{ card: Element; viewport: Element }> {
  document.documentElement.setAttribute("data-luke-profile", room === "narrow" ? "web" : "desktop");
  document.documentElement.setAttribute("data-luke-room", room);
  layContainersAt({}, { touch: room === "narrow" });
  document.documentElement.style.setProperty("--luke-stage-height", `${height}px`);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(CommandDialog, {
        open: true,
        onOpenChange: () => undefined,
        label: "Command palette",
        placeholder: "Search",
        groups: [],
      }),
    );
  });
  const card = document.querySelector('[role="dialog"]') ?? assert.fail("the card stands");
  const viewport = card.parentElement ?? assert.fail("the card stands in the dimmed window");
  return { card, viewport };
}

test("in a tall window, ⌘K's card stands two thirds of what is seen, a fifth of the way down", async () => {
  const { card, viewport } = await paletteIn(WINDOW.TALL, "wide");
  assert.equal(pixels(card, getComputedStyle(card).maxHeight), WINDOW.TALL * 0.64);
  assert.equal(pixels(viewport, getComputedStyle(viewport).paddingTop), WINDOW.TALL * 0.18);
});

test("in a short window, ⌘K's card keeps three rows of its list beside its chrome, and stands wholly in the window", async () => {
  const { card, viewport } = await paletteIn(WINDOW.SHORT, "wide");
  const height = pixels(card, getComputedStyle(card).maxHeight);
  const top = pixels(viewport, getComputedStyle(viewport).paddingTop);
  assert.ok(
    height >= CHROME + ROWS_KEPT * MENU_ROW,
    `${height}px is room for its chrome and ${ROWS_KEPT} rows`,
  );
  assert.ok(
    top + height <= WINDOW.SHORT,
    `the card ends at ${top + height}px in a window ${WINDOW.SHORT}px tall`,
  );
});

test("in a short narrow window, ⌘K's sheet keeps three rows of its list beside its chrome, and stands no taller than the window", async () => {
  const { card } = await paletteIn(WINDOW.SHORT, "narrow");
  const height = pixels(card, getComputedStyle(card).maxHeight);
  assert.ok(
    height >= CHROME + ROWS_KEPT * MENU_ROW,
    `${height}px is room for its chrome and ${ROWS_KEPT} rows`,
  );
  assert.ok(height <= WINDOW.SHORT);
});
