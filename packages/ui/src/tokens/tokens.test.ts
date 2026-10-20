import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const SHEETS = ["scale", "profiles", "palettes", "display", "viewport"] as const;

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

/** A `#rrggbb` colour's relative luminance, as WCAG 2 defines it. */
function luminanceOf(hex: string): number {
  const linear = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = linear;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** The WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrastOf(first: string, second: string): number {
  const [lighter, darker] = [luminanceOf(first), luminanceOf(second)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
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

test("the web's dark accent ink reads at AA on every dark ground it stands on", () => {
  const dark = ruleOf("palettes", '[data-luke-profile="web"][data-luke-theme="dark"]').values;
  const ink = dark.get("--luke-color-accent-text") ?? "";
  for (const ground of ["--luke-color-ground", "--luke-color-surface", "--luke-color-well"]) {
    const behind = dark.get(ground) ?? "";
    assert.ok(contrastOf(ink, behind) >= 4.5, `${ink} on ${ground} (${behind})`);
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
