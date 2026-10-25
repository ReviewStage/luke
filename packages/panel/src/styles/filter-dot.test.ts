// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CornerDot, PROFILE, type SurfaceAttributes, surfaceAttributes, THEME } from "@luke/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * filter-dot.test.ts -- the dot the sidebar's View options and the Tasks
 * page's Filter wear while the view leaves tasks out is drawn in the
 * accent's hue, never a grey, and holds a mark's 3:1 against the ground it
 * stands on, at either profile in either theme: on the web the keyboard's
 * ring is the text's near-black or white, which said nothing a filter is
 * on. Both wear `@luke/ui`'s `CornerDot`. jsdom resolves no `var()` and no
 * `light-dark()`, so the sheets and the utilities are laid
 * (`testing/container-width.ts`) and the dot's fill is read off its mark,
 * followed through its tokens as a browser reads them.
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

/** Each button that wears the dot and the ground it stands on. */
const DOTTED = [
  { owner: "the sidebar's View options", ground: "var(--luke-color-sidebar)" },
  { owner: "the Tasks page's Filter", ground: "var(--luke-color-ground)" },
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

/** An opaque `#rrggbb` or `#rgb` colour's channels, each from 0 to 1. */
function channelsOf(colour: string): number[] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour)?.[1];
  assert.ok(hex, `${colour} is no opaque hex colour`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255);
}

/** An opaque colour's relative luminance, as WCAG 2 defines it. */
function luminanceOf(colour: string): number {
  const [red = 0, green = 0, blue = 0] = channelsOf(colour).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

for (const { name, dark, surface } of SURFACES) {
  for (const { owner, ground } of DOTTED) {
    test(`on ${name} the ${owner} dot is drawn in the accent's hue and holds a mark's 3:1`, () => {
      layUnder(surface);
      document.body.innerHTML = renderToStaticMarkup(
        createElement(CornerDot, { shown: true }, "Filter"),
      );
      const mark = document.querySelector(".luke-corner-dot-mark");
      assert.ok(mark, "the dot is drawn");
      const fill = resolved(
        mark,
        getComputedStyle(mark).getPropertyValue("background-color"),
        dark,
      );
      const behind = resolved(mark, ground, dark);
      assert.ok(
        /^#[0-9a-f]{3,6}$/i.test(fill),
        `the dot is ${fill || "undrawn"}, a grey, not the accent`,
      );
      const channels = channelsOf(fill);
      assert.ok(
        Math.max(...channels) - Math.min(...channels) > 0.25,
        `the dot (${fill}) is a grey, not the accent`,
      );
      const [lighter = 0, darker = 0] = [luminanceOf(fill), luminanceOf(behind)].sort(
        (a, b) => b - a,
      );
      const ratio = (lighter + 0.05) / (darker + 0.05);
      assert.ok(ratio >= 3, `the dot (${fill}) on ${behind} is ${ratio.toFixed(2)}:1`);
    });
  }
}
