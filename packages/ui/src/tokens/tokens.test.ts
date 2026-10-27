import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * tokens.test.ts -- a base value means one length everywhere, and every
 * profile and palette sets every role, so a component drawn at either
 * density, in either theme, never reads a token that is not there.
 */

/** One rule of a token sheet: its selector and the custom properties it sets, by name. */
interface TokenRule {
  readonly selector: string;
  readonly values: ReadonlyMap<string, string>;
}

/** The spacing scale every app shares, in pixels. */
const SPACE_STEPS = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96];

const SHEETS = ["scale", "profiles", "palettes", "status-tone", "display", "viewport"] as const;

/** The rules of `tokens/<sheet>.css`, comments dropped; a rule inside a media query is read as any other, since the sheets nest nothing deeper. */
function rulesOf(sheet: (typeof SHEETS)[number]): TokenRule[] {
  const source = readFileSync(new URL(`./${sheet}.css`, import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
    selector: selector.trim().replace(/\s+/g, " "),
    values: new Map(
      [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name = "", value = ""]) => [
        name,
        value.trim(),
      ]),
    ),
  }));
}

/** The one rule of `sheet` whose selector is `selector`. */
function ruleOf(sheet: (typeof SHEETS)[number], selector: string): TokenRule {
  const rule = rulesOf(sheet).find((candidate) => candidate.selector === selector);
  assert.ok(rule, `${sheet}.css has no rule for ${selector}`);
  return rule;
}

/** Which half of a `light-dark()` pair a palette is read for. */
const SCHEME = { LIGHT: "light", DARK: "dark" } as const;
type Scheme = (typeof SCHEME)[keyof typeof SCHEME];

/** A colour in sRGB, each channel from 0 to 1, with its alpha. */
interface Colour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** A function's arguments, split at the commas outside any parenthesis of their own. */
function argumentsOf(inner: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const character of inner) {
    depth += character === "(" ? 1 : character === ")" ? -1 : 0;
    if (character === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += character;
  }
  return parts.map((part) => part.trim());
}

/** An sRGB channel from its gamma-encoded value to its linear light, as WCAG 2 defines it. */
function linearOf(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** An `oklch(L C H)` colour in sRGB, by Björn Ottosson's OKLab matrices. */
function oklchOf(lightness: number, chroma: number, hue: number): Colour {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) =>
    linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return {
    red: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    green: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    blue: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha: 1,
  };
}

/** A palette value as a colour, its `scheme` half where it is a `light-dark()` pair: `#rgb`, `#rrggbb`, `rgb[a]()`, or `oklch()`. */
function colourOf(value: string, scheme: Scheme): Colour {
  const pair = /^light-dark\((.*)\)$/.exec(value);
  if (pair) {
    const [light = "", dark = ""] = argumentsOf(pair[1] ?? "");
    return colourOf(scheme === SCHEME.LIGHT ? light : dark, scheme);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const [red = 0, green = 0, blue = 0] = [0, 2, 4].map(
      (at) => Number.parseInt(full.slice(at, at + 2), 16) / 255,
    );
    return { red, green, blue, alpha: 1 };
  }
  const rgb = /^rgba?\((.*)\)$/.exec(value);
  if (rgb) {
    const [red = 0, green = 0, blue = 0, alpha = 1] = argumentsOf(rgb[1] ?? "").map(Number);
    return { red: red / 255, green: green / 255, blue: blue / 255, alpha };
  }
  const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  assert.ok(oklch, `${value} is no colour this test reads`);
  const [, lightness = "0", chroma = "0", hue = "0"] = oklch;
  return oklchOf(Number(lightness), Number(chroma), Number(hue));
}

/** `top` laid over the opaque `ground`, as a browser blends it, in gamma-encoded sRGB. */
function over(top: Colour, ground: Colour): Colour {
  const mix = (above: number, below: number) => above * top.alpha + below * (1 - top.alpha);
  return {
    red: mix(top.red, ground.red),
    green: mix(top.green, ground.green),
    blue: mix(top.blue, ground.blue),
    alpha: 1,
  };
}

/** An opaque colour's relative luminance, as WCAG 2 defines it. */
function luminanceOf(colour: Colour): number {
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return (
    0.2126 * linearOf(clamp(colour.red)) +
    0.7152 * linearOf(clamp(colour.green)) +
    0.0722 * linearOf(clamp(colour.blue))
  );
}

/** The WCAG 2 contrast ratio of an ink laid over an opaque ground. */
function contrastOf(ink: Colour, ground: Colour): number {
  const [lighter = 0, darker = 0] = [luminanceOf(over(ink, ground)), luminanceOf(ground)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function sortedNames(rule: TokenRule): string[] {
  return [...rule.values.keys()].sort();
}

test("the base scale holds every step of the contract, each its own length in pixels", () => {
  const scale = ruleOf("scale", ":root");
  for (const step of SPACE_STEPS) {
    assert.equal(scale.values.get(`--luke-space-${step}`), `${step}px`);
  }
  const spaces = [...scale.values.keys()].filter((name) => name.startsWith("--luke-space-"));
  assert.equal(spaces.length, SPACE_STEPS.length);
});

test("no profile, palette, or alias restates a base value", () => {
  const base = new Set(ruleOf("scale", ":root").values.keys());
  for (const sheet of SHEETS.filter((name) => name !== "scale")) {
    for (const rule of rulesOf(sheet)) {
      const restated = [...rule.values.keys()].filter((name) => base.has(name));
      assert.deepEqual(restated, [], `${sheet}.css's ${rule.selector} restates the base`);
    }
  }
});

test("the desktop and web profiles set the same roles", () => {
  assert.deepEqual(
    sortedNames(ruleOf("profiles", '[data-luke-profile="desktop"]')),
    sortedNames(ruleOf("profiles", '[data-luke-profile="web"]')),
  );
});

test("a compact site sets only sizes, and only roles the site's profile sets", () => {
  const web = new Set(ruleOf("profiles", '[data-luke-profile="web"]').values.keys());
  const compact = sortedNames(
    ruleOf("profiles", '[data-luke-profile="web"][data-luke-density="compact"]'),
  );
  for (const name of compact) {
    assert.ok(web.has(name), `the compact site sets ${name}, which the site's profile does not`);
    assert.match(name, /^--luke-(control|type|menu-row)-/, `the compact site sets ${name}`);
  }
});

test("every palette sets the same colours", () => {
  const desktop = sortedNames(ruleOf("palettes", '[data-luke-profile="desktop"]'));
  const webLight = sortedNames(
    ruleOf(
      "palettes",
      '[data-luke-profile="web"], [data-luke-profile="web"][data-luke-theme="light"]',
    ),
  );
  const webDark = sortedNames(
    ruleOf("palettes", '[data-luke-profile="web"][data-luke-theme="dark"]'),
  );
  assert.deepEqual(webLight, desktop);
  assert.deepEqual(webDark, desktop);
});

/** The colours a chip's own face is drawn in, which no ground behind it may show through. */
const CHIP_FACE = [
  "--luke-color-chip",
  "--luke-color-chip-hover",
  "--luke-color-chip-selected",
  "--luke-color-chip-edge",
  "--luke-color-chip-edge-strong",
] as const;

/** The palettes' rules, by the selector each is written under. */
const PALETTES = [
  '[data-luke-profile="desktop"]',
  '[data-luke-profile="web"], [data-luke-profile="web"][data-luke-theme="light"]',
  '[data-luke-profile="web"][data-luke-theme="dark"]',
] as const;

/** Whether a value is an opaque colour: one `#rrggbb`, or a `light-dark()` pair of them. */
function isOpaque(value: string): boolean {
  return /^(#[0-9a-f]{6}|light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\))$/i.test(value);
}

test("a chip's face is opaque in every palette, so no ground shows through it", () => {
  for (const selector of PALETTES) {
    const palette = ruleOf("palettes", selector).values;
    for (const name of CHIP_FACE) {
      const value = palette.get(name) ?? "";
      assert.ok(isOpaque(value), `${selector}'s ${name} is ${value || "unset"}`);
    }
  }
});

test("the web's dark accent ink reads at AA on every dark ground it stands on", () => {
  const dark = ruleOf("palettes", '[data-luke-profile="web"][data-luke-theme="dark"]').values;
  const ink = dark.get("--luke-color-accent-text") ?? "";
  for (const ground of ["--luke-color-ground", "--luke-color-surface", "--luke-color-well"]) {
    const behind = dark.get(ground) ?? "";
    const ratio = contrastOf(colourOf(ink, SCHEME.DARK), colourOf(behind, SCHEME.DARK));
    assert.ok(ratio >= 4.5, `${ink} on ${ground} (${behind})`);
  }
});

test("no component draws words in the accent's fill, which the web's light page cannot read", () => {
  const components = new URL("../components/", import.meta.url);
  const sheets = readdirSync(components, { recursive: true, encoding: "utf8" }).filter((path) =>
    path.endsWith(".css"),
  );
  for (const path of sheets) {
    const source = readFileSync(new URL(path, components), "utf8");
    assert.doesNotMatch(
      source,
      /(?:^|[\s;{])color\s*:\s*var\(--luke-color-accent\)/,
      `${path} draws words in --luke-color-accent; words take --luke-color-accent-text`,
    );
  }
});

test("every shared token a sheet reads is one some sheet sets", () => {
  const set = new Set(SHEETS.flatMap((sheet) => rulesOf(sheet).flatMap(sortedNames)));
  for (const sheet of SHEETS) {
    for (const rule of rulesOf(sheet)) {
      for (const [name, value] of rule.values) {
        for (const [, read = ""] of value.matchAll(/var\((--luke-[\w-]+)\)/g)) {
          assert.ok(set.has(read), `${sheet}.css's ${name} reads ${read}, which nothing sets`);
        }
      }
    }
  }
});

/** `name`'s colour in `palette`, followed through any `var()` alias to the role it names there. */
function paletteColour(palette: ReadonlyMap<string, string>, name: string, scheme: Scheme): Colour {
  const value = palette.get(name) ?? "";
  const alias = /^var\((--luke-[\w-]+)\)$/.exec(value)?.[1];
  return alias === undefined ? colourOf(value, scheme) : paletteColour(palette, alias, scheme);
}

/** The grounds words stand on in `scheme`, each opaque: the page's, a card's, a well's, the
 * sidebar's, and the sidebar's current row, its selected fill laid over the sidebar. */
function groundsOf(palette: ReadonlyMap<string, string>, scheme: Scheme): Map<string, Colour> {
  const read = (name: string) => paletteColour(palette, name, scheme);
  const grounds = new Map(
    [
      "--luke-color-ground",
      "--luke-color-surface",
      "--luke-color-well",
      "--luke-color-sidebar",
    ].map((name) => [name, read(name)] as const),
  );
  for (const [name, ground] of grounds) {
    if (ground.alpha < 1) grounds.set(name, over(ground, read("--luke-color-ground")));
  }
  grounds.set(
    "the selected fill over the sidebar",
    over(read("--luke-color-fill-selected"), read("--luke-color-sidebar")),
  );
  return grounds;
}

/** Whether `ink` in `palette` reads at AA (4.5:1) on every ground of `palette` in `scheme`. */
function assertAA(palette: ReadonlyMap<string, string>, ink: string, scheme: Scheme): void {
  for (const [ground, behind] of groundsOf(palette, scheme)) {
    const ratio = contrastOf(paletteColour(palette, ink, scheme), behind);
    assert.ok(ratio >= 4.5, `${ink} on ${ground} in the ${scheme} is ${ratio.toFixed(2)}:1`);
  }
}

/** Each palette's rule, with the themes it is read in. */
const PALETTE_SCHEMES = [
  [PALETTES[0], [SCHEME.LIGHT, SCHEME.DARK]],
  [PALETTES[1], [SCHEME.LIGHT]],
  [PALETTES[2], [SCHEME.DARK]],
] as const;

test("every grey words are drawn in reads at AA on every ground, a current sidebar row's included, in every palette and theme", () => {
  for (const [selector, schemes] of PALETTE_SCHEMES) {
    const palette = ruleOf("palettes", selector).values;
    const greys = [...palette.keys()].filter((name) => name.startsWith("--luke-color-text-"));
    for (const scheme of schemes) for (const grey of greys) assertAA(palette, grey, scheme);
  }
});

test("the desktop's light accent ink, which work under way shares, reads at AA on every light ground, a current sidebar row's included", () => {
  const desktop = ruleOf("palettes", '[data-luke-profile="desktop"]').values;
  assertAA(desktop, "--luke-color-accent-text", SCHEME.LIGHT);
  assertAA(desktop, "--luke-color-working", SCHEME.LIGHT);
});

test("the quieter words on the accent, a primary button's shortcut, read at AA on its fill in every palette and theme", () => {
  for (const [selector, schemes] of PALETTE_SCHEMES) {
    const palette = ruleOf("palettes", selector).values;
    for (const scheme of schemes) {
      const ratio = contrastOf(
        paletteColour(palette, "--luke-color-on-accent-muted", scheme),
        paletteColour(palette, "--luke-color-accent", scheme),
      );
      assert.ok(
        ratio >= 4.5,
        `${selector}'s on-accent-muted in the ${scheme} is ${ratio.toFixed(2)}:1`,
      );
    }
  }
});

/** The parts of a list row that are marks, whose meaning its words carry, so a muted row may fade them. */
const LIST_ROW_MARKS = new Set([".luke-list-row-leading", ".luke-list-row-attachments"]);

test("a muted list row fades only its marks, never its words, which must still read at AA", () => {
  const source = readFileSync(
    new URL("../components/list-row/list-row.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors = "", body = ""] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|[\s;])opacity\s*:/.test(body)) continue;
    for (const selector of selectors.split(",").map((part) => part.trim())) {
      if (!selector.includes('[data-muted="true"]')) continue;
      const part = selector.split(/[\s>+~]+/).at(-1) ?? "";
      assert.ok(
        LIST_ROW_MARKS.has(part),
        `list-row.css fades a muted row's ${part}, words included`,
      );
    }
  }
});
