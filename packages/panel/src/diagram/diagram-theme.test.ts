// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PROFILE, surfaceAttributes, THEME } from "@luke/ui";
import { DIAGRAM_APPEARANCE } from "@luke/ui/diagram-contract";
import { afterEach, test, vi } from "vitest";
import { layContainersAt } from "../testing/container-width.js";
import { diagramThemeVariables } from "./diagram-theme.js";

/**
 * diagram-theme.test.ts -- a diagram draws in the window's palette, the dark
 * one when it is drawn dark and the light one when it is drawn light,
 * whichever the window stands in as it is asked. jsdom resolves no `var()`
 * and no `light-dark()` in a computed colour, so the sheets are laid
 * (`testing/container-width.ts`) and a computed `color` is answered as a
 * browser answers it: its tokens followed from the element, a
 * `light-dark()` pair taken by the theme the element wears, and a hex
 * colour written as `rgb()`.
 */

let laid: HTMLStyleElement | undefined;

/** jsdom's own computed style, which the stand-in reads tokens through. */
const jsdomStyle = window.getComputedStyle.bind(window);

afterEach(() => {
  vi.restoreAllMocks();
  laid?.remove();
  laid = undefined;
  for (const name of ["data-luke-profile", "data-luke-theme"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** The half of a `light-dark()` pair a theme draws, split at its one top-level comma. */
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

/** A colour with every `var()` read off `element` and every pair taken for its theme, as `rgb()` where it was hex. */
function browserColour(element: Element, value: string): string {
  const dark = element.closest("[data-luke-theme]")?.getAttribute("data-luke-theme") === "dark";
  const style = jsdomStyle(element);
  const once = themed(
    value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => style.getPropertyValue(name).trim()),
    dark,
  );
  if (once !== value) return browserColour(element, once);
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex === undefined) return value;
  const [red, green, blue] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${red}, ${green}, ${blue})`;
}

/** Lays the sheets under a desktop root standing in `theme`, and answers a computed `color` as a browser would. */
function desktopIn(theme: typeof THEME.LIGHT | typeof THEME.DARK): void {
  for (const [name, value] of Object.entries(surfaceAttributes(PROFILE.DESKTOP, theme))) {
    document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = jsdomStyle(element, pseudo);
    const asked = element instanceof HTMLElement ? element.style.color : "";
    if (!asked.startsWith("var(")) return style;
    const color = browserColour(element, asked);
    return new Proxy(style, {
      get: (target, key) => {
        if (key === "color") return color;
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

/** A token's colour as the window draws it in a theme, as `#rrggbb`, read off an element wearing that theme. */
function drawnColour(token: string, theme: typeof THEME.LIGHT | typeof THEME.DARK): string {
  const element = document.body.appendChild(document.createElement("span"));
  for (const [name, value] of Object.entries(surfaceAttributes(PROFILE.DESKTOP, theme))) {
    element.setAttribute(name, value);
  }
  const colour = browserColour(element, `var(${token})`);
  element.remove();
  const channels = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(colour);
  assert.ok(channels, `${token} is no opaque colour in ${theme}: ${colour}`);
  return `#${channels
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** An opaque `#rrggbb` colour's relative luminance, as WCAG 2 defines it. */
function luminanceOf(colour: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(colour.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The contrast between two opaque colours. */
function contrastOf(one: string, other: string): number {
  const [lighter = 0, darker = 0] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const CASES = [
  { appearance: DIAGRAM_APPEARANCE.LIGHT, theme: THEME.LIGHT, other: THEME.DARK },
  { appearance: DIAGRAM_APPEARANCE.DARK, theme: THEME.DARK, other: THEME.LIGHT },
] as const;

for (const { appearance, theme, other } of CASES) {
  test(`a diagram drawn ${appearance} draws its boxes, edges and groups in the ${theme} palette`, () => {
    desktopIn(theme);
    const drawn = diagramThemeVariables(appearance);
    assert.equal(drawn.darkMode, appearance === DIAGRAM_APPEARANCE.DARK);
    assert.equal(drawn.primaryColor, drawnColour("--luke-color-chip", theme));
    assert.equal(drawn.noteBkgColor, drawnColour("--luke-color-chip-hover", theme));
    assert.equal(drawn.primaryBorderColor, drawnColour("--luke-color-chip-edge-strong", theme));
    assert.equal(drawn.clusterBkg, drawnColour("--luke-color-well", theme));
    assert.equal(drawn.clusterBorder, drawnColour("--luke-color-chip-edge", theme));
  });

  test(`a diagram drawn ${appearance} while the window stands ${other} still takes the ${theme} palette`, () => {
    desktopIn(other);
    const drawn = diagramThemeVariables(appearance);
    assert.equal(drawn.primaryColor, drawnColour("--luke-color-chip", theme));
    assert.equal(drawn.clusterBkg, drawnColour("--luke-color-well", theme));
  });

  test(`a diagram drawn ${appearance} hands Mermaid opaque colours whose words read on its boxes`, () => {
    desktopIn(theme);
    const drawn = diagramThemeVariables(appearance);
    for (const [name, value] of Object.entries(drawn)) {
      if (name !== "darkMode") assert.match(String(value), /^#[0-9a-f]{6}$/, name);
    }
    const words = drawn.primaryTextColor ?? "";
    const box = drawn.primaryColor ?? "";
    assert.ok(contrastOf(words, box) >= 4.5, `words ${words} on a box ${box}`);
    assert.ok(contrastOf(drawn.lineColor ?? "", box) >= 3, `lines ${drawn.lineColor} on ${box}`);
  });
}
