// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  Badge,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  PROFILE,
  STATUS_TONE,
  type SurfaceAttributes,
  surfaceAttributes,
  THEME,
} from "@luke/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * chip-faces.test.ts -- a filter chip, at rest, pressed, or applied, a
 * reaction's count the reader gave, a pull request's toned state chip, and
 * a badge each stand on a face of their own, so no ground behind one shows
 * through it, at either profile in either theme. jsdom resolves no `var()`
 * and no `light-dark()`, so the sheets are laid
 * (`testing/container-width.ts`) and each chip's fill is read as a browser
 * reads it: its tokens followed from the element, and a `light-dark()` pair
 * by the theme its root wears.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-theme", "data-luke-density"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** The surfaces a chip is drawn on: each profile, in each theme it draws. */
const SURFACES = [
  {
    name: "the desktop in light",
    dark: false,
    surface: surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  },
  {
    name: "the desktop in dark",
    dark: true,
    surface: surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  },
  { name: "the site in light", dark: false, surface: surfaceAttributes(PROFILE.WEB, THEME.LIGHT) },
  { name: "the site in dark", dark: true, surface: surfaceAttributes(PROFILE.WEB, THEME.DARK) },
] as const;

/** The chips whose face is read, each by what it is. */
const CHIPS: readonly (readonly [string, ReactElement])[] = [
  [
    "a filter at rest",
    createElement(
      Chip,
      { look: CHIP_LOOK.FILTER, "aria-pressed": false },
      createElement(ChipName, null, "Hide bots"),
    ),
  ],
  [
    "a pressed filter",
    createElement(
      Chip,
      { look: CHIP_LOOK.FILTER, "aria-pressed": true },
      createElement(ChipName, null, "Hide resolved"),
    ),
  ],
  [
    "an applied filter",
    createElement(Chip, {
      look: CHIP_LOOK.FILTER,
      removeLabel: "Show everyone's tasks",
      onRemove: () => undefined,
      children: createElement(ChipName, null, "Mine"),
    }),
  ],
  [
    "the reader's own reaction",
    createElement(
      Chip,
      { look: CHIP_LOOK.FILTER, size: CHIP_SIZE.COMPACT, "aria-pressed": true },
      "👍 12",
    ),
  ],
  [
    "a pull request's state",
    createElement(
      Chip,
      { look: CHIP_LOOK.PILL, size: CHIP_SIZE.COMPACT, tone: STATUS_TONE.MERGED, chevron: true },
      createElement(ChipName, null, "Merged"),
    ),
  ],
  [
    "a pill",
    createElement(
      Chip,
      { look: CHIP_LOOK.PILL },
      createElement(ChipName, null, "luke/expire-invites"),
    ),
  ],
  [
    "a badge in a tone",
    createElement(Badge, { tone: STATUS_TONE.COMPLETE, children: "Connected" }),
  ],
  ["a neutral badge", createElement(Badge, { children: "Outdated" })],
];

/** Lays the sheets under a root wearing `surface`. */
function layUnder(surface: SurfaceAttributes): void {
  for (const [name, value] of Object.entries(surface)) {
    if (value !== undefined) document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
}

/** Draws `element` and answers the chip it draws. */
function draw(element: ReactElement): Element {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  const chip = container.querySelector(".luke-chip, .luke-badge");
  assert.ok(chip, "a chip is drawn");
  return chip;
}

/** The half of a `light-dark()` pair the theme draws, split at its one top-level comma. */
function themed(value: string, dark: boolean): string {
  if (!value.startsWith("light-dark(")) return value;
  const inside = value.slice("light-dark(".length, -1);
  let depth = 0;
  for (const [at, character] of [...inside].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      return (dark ? inside.slice(at + 1) : inside.slice(0, at)).trim();
    }
  }
  return value;
}

/** A colour with every `var()` in it read off `element` and every pair taken for the theme, through as many as it names. */
function resolved(element: Element, value: string, dark: boolean): string {
  const style = getComputedStyle(element);
  const once = themed(
    value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => style.getPropertyValue(name).trim()),
    dark,
  );
  return once === value ? once : resolved(element, once, dark);
}

/** The fill a chip's face is drawn in, as its own rules declare it. */
function fillOf(chip: Element, dark: boolean): string {
  const style = getComputedStyle(chip);
  // Note that the shorthand is read first, because jsdom keeps a `var()` there as written and answers its longhand transparent.
  const declared =
    style.getPropertyValue("background") || style.getPropertyValue("background-color");
  return resolved(chip, declared.trim(), dark);
}

/** Whether a colour hides what is behind it: a solid hex or `rgb()`, never an alpha, a mix with `transparent`, or none. */
function isOpaque(colour: string): boolean {
  if (/^#[0-9a-f]{6}$/i.test(colour) || /^#[0-9a-f]{3}$/i.test(colour)) return true;
  if (/^rgb\(\s*\d+,\s*\d+,\s*\d+\s*\)$/.test(colour)) return true;
  const alpha = /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([\d.]+)\s*\)$/.exec(colour);
  if (alpha !== null) return Number(alpha[1]) === 1;
  return /^oklch\([\d.]+ [\d.]+ [\d.]+\)$/.test(colour);
}

for (const { name: surfaceName, dark, surface } of SURFACES) {
  test(`on ${surfaceName} every filter, reaction, state chip, pill, and badge stands on an opaque face`, () => {
    layUnder(surface);
    const seeThrough = CHIPS.map(([name, element]) => [name, fillOf(draw(element), dark)] as const)
      .filter(([, fill]) => !isOpaque(fill))
      .map(([name, fill]) => `${name} (${fill || "no fill"})`);
    assert.deepEqual(seeThrough, []);
  });
}
