// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PROFILE, type SurfaceAttributes, surfaceAttributes, THEME } from "@luke/ui";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * unread-dot.test.ts -- an unread Inbox item's dot holds a mark's 3:1
 * against the page it stands on, at either profile in either theme, the
 * web's light page among them, where the accent's cyan fill would all but
 * vanish. jsdom resolves no `var()` and no `light-dark()`, so the sheets are
 * laid (`testing/container-width.ts`) and the dot's fill is read as a
 * browser reads it: its tokens followed from the element, and a
 * `light-dark()` pair by the theme its root wears.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-theme", "data-luke-density"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** The pages a dot is drawn on: each profile, in each theme it draws. */
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

/** Lays the sheets under a root wearing `surface`. */
function layUnder(surface: SurfaceAttributes): void {
  for (const [name, value] of Object.entries(surface)) {
    if (value !== undefined) document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
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

/** An opaque `#rrggbb` or `#rgb` colour's relative luminance, as WCAG 2 defines it. */
function luminanceOf(colour: string): number {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour)?.[1];
  assert.ok(hex, `${colour} is no opaque hex colour`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

for (const { name, dark, surface } of SURFACES) {
  test(`on ${name} an unread Inbox item's dot holds a mark's 3:1 against the page`, () => {
    layUnder(surface);
    const dot = document.body.appendChild(document.createElement("span"));
    dot.className = "inbox-row-unread";
    const style = getComputedStyle(dot);
    const fill = resolved(
      dot,
      (style.getPropertyValue("background") || style.getPropertyValue("background-color")).trim(),
      dark,
    );
    const ground = resolved(dot, "var(--luke-color-ground)", dark);
    const [lighter = 0, darker = 0] = [luminanceOf(fill), luminanceOf(ground)].sort(
      (a, b) => b - a,
    );
    const ratio = (lighter + 0.05) / (darker + 0.05);
    assert.ok(ratio >= 3, `the dot (${fill}) on the page (${ground}) is ${ratio.toFixed(2)}:1`);
  });
}
