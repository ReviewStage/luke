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

const SHEETS = ["scale", "profiles", "palettes", "display", "legacy"] as const;

/** The rules of `tokens/<sheet>.css`, comments dropped; the sheets hold no nested block. */
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

test("an app's old names are aliases of shared roles, each under its own profile", () => {
  for (const rule of rulesOf("legacy")) {
    assert.match(rule.selector, /^\[data-luke-profile="(desktop|web)"\]$/);
    for (const [name, value] of rule.values) {
      assert.ok(!name.startsWith("--luke-"), `legacy.css sets the shared ${name}`);
      assert.match(value, /^var\(--luke-[\w-]+\)$/, `legacy.css's ${name} is not an alias`);
    }
  }
});
