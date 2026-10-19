// @vitest-environment jsdom

import assert from "node:assert/strict";
import base from "@luke/panel/styles/base.css?raw";
import desktop from "@luke/panel/styles/desktop.css?raw";
import tasks from "@luke/panel/styles/tasks.css?raw";
import { PROFILE, type SurfaceAttributes, surfaceAttributes, THEME, type ThemeOf } from "@luke/ui";
import { afterEach, test, vi } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * theme-inks.test.ts -- the panel's own inks, the code's and an
 * integration mark's, are drawn in the theme its root wears, whatever the
 * machine's appearance says: a web page in Light keeps light code on a dark
 * Mac, and one in Dark keeps dark code on a light one. A root that follows
 * the machine (`system`, the desktop's) draws the machine's. jsdom answers
 * no media query and resolves no `light-dark()`, so the sheets are laid
 * (`testing/container-width.ts`) and each pair is read as a browser reads
 * it: by the `color-scheme` the root's theme gives the element
 * (`@luke/ui`'s `palettes.css`), its machine half by the stubbed
 * appearance.
 */

/** Light and dark, each ink as the GitHub theme the panel draws code in names it, and an integration's as its brand does. */
const INKS = {
  light: {
    "--code-ground": "#fff",
    "--code-text": "#1f2328",
    "--terminal-red": "#cf222e",
    "--integration-ink-notion": "#000",
    "--integration-ink-sentry": "#181225",
  },
  dark: {
    "--code-ground": "#0d1117",
    "--code-text": "#e6edf3",
    "--terminal-red": "#ff7b72",
    "--integration-ink-notion": "#fff",
    "--integration-ink-sentry": "#fff",
  },
} as const;

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  for (const name of ["data-luke-profile", "data-luke-theme", "data-luke-density"]) {
    document.documentElement.removeAttribute(name);
  }
  vi.restoreAllMocks();
});

/** Says the machine's appearance is dark, or light, to every media query asked. */
function machineIs(dark: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: dark && query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  );
}

/** Lays the sheets under a root wearing `surface`. */
function layUnder(surface: SurfaceAttributes): void {
  for (const [name, value] of Object.entries(surface)) {
    if (value !== undefined) document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({});
}

/** The two arguments of a `light-dark()`, split at its one top-level comma. */
function halves(pair: string): readonly [string, string] {
  const inside = pair.slice("light-dark(".length, -1);
  let depth = 0;
  for (const [at, character] of [...inside].entries()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      return [inside.slice(0, at).trim(), inside.slice(at + 1).trim()];
    }
  }
  throw new Error(`not a light-dark() pair: ${pair}`);
}

/** The ink `token` draws on `element`: its `light-dark()` half for the scheme the element is drawn in. */
function inkOf(element: Element, token: string): string {
  const style = getComputedStyle(element);
  const value = style.getPropertyValue(token).trim();
  if (!value.startsWith("light-dark(")) return value;
  const scheme = style.getPropertyValue("color-scheme").trim();
  const [light, dark] = halves(value);
  if (scheme === "dark") return dark;
  if (scheme === "light") return light;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? dark : light;
}

/** Every ink as `element` draws it. */
function inksOf(element: Element): Record<string, string> {
  return Object.fromEntries(Object.keys(INKS.light).map((token) => [token, inkOf(element, token)]));
}

test("a web root's chosen theme picks the code's and the marks' inks, whatever the machine says", () => {
  const cases: readonly {
    theme: ThemeOf<typeof PROFILE.WEB>;
    machineDark: boolean;
    inks: keyof typeof INKS;
  }[] = [
    { theme: THEME.LIGHT, machineDark: true, inks: "light" },
    { theme: THEME.DARK, machineDark: false, inks: "dark" },
  ];
  for (const { theme, machineDark, inks } of cases) {
    machineIs(machineDark);
    layUnder(surfaceAttributes(PROFILE.WEB, theme));
    const mark = document.body.appendChild(document.createElement("span"));

    assert.deepEqual(
      inksOf(mark),
      INKS[inks],
      `${theme} on a ${machineDark ? "dark" : "light"} machine`,
    );

    mark.remove();
    laid?.remove();
    vi.restoreAllMocks();
  }
});

test("a desktop root that follows the machine draws the machine's inks, in either appearance", () => {
  for (const machineDark of [false, true]) {
    machineIs(machineDark);
    layUnder(surfaceAttributes(PROFILE.DESKTOP, THEME.SYSTEM));
    const mark = document.body.appendChild(document.createElement("span"));

    assert.deepEqual(inksOf(mark), INKS[machineDark ? "dark" : "light"]);

    mark.remove();
    laid?.remove();
    vi.restoreAllMocks();
  }
});

test("no sheet of the panel's asks the machine's appearance; the root's theme alone decides", () => {
  for (const [name, sheet] of Object.entries({ base, desktop, tasks })) {
    assert.doesNotMatch(sheet, /prefers-color-scheme/u, name);
  }
});
