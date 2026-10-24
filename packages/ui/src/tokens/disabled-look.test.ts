import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";

/**
 * disabled-look.test.ts -- every `@luke/ui` control that fades while it
 * cannot be used fades by the one token, `--luke-disabled-opacity` (in
 * Tailwind, `opacity-disabled`), never a number of its own, so a switched-off
 * button, field, switch, and menu row read as the same state.
 */

/** Where the package's sources stand. */
const SOURCES = new URL("../", import.meta.url);

/** Every stylesheet and every module under the package's sources, tests aside. */
function sources(): { path: string; text: string }[] {
  return readdirSync(SOURCES, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(css|tsx?)$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => ({ path, text: readFileSync(new URL(path, SOURCES), "utf8") }));
}

/** A selector's state words, outside any `:not(…)`: a press that is held back, or a page link that goes nowhere. */
const UNAVAILABLE = /disabled|idle/;

/** A stylesheet's rules that fade an unavailable control by a number of their own. */
function cssFades(text: string): string[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const [, selector = "", body = ""] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Note that a `:not(:disabled)` names the state the rule leaves alone.
    if (!UNAVAILABLE.test(selector.replace(/:not\([^)]*\)/g, ""))) continue;
    const opacity = /(?:^|[\s;])opacity\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    // Note that an opacity of 1 holds a control unfaded, which is no fade of its own.
    if (opacity === undefined || opacity === "1" || opacity === "var(--luke-disabled-opacity)") {
      continue;
    }
    found.push(`${selector.trim()} { opacity: ${opacity} }`);
  }
  return found;
}

/** A module's Tailwind classes that fade an unavailable control by a number of their own. */
function classFades(text: string): string[] {
  return [
    ...text.matchAll(/[^\s"'`]*(?:disabled|idle)[^\s"'`]*:opacity-(?!disabled\b)[\w.[\]-]+/g),
  ].map(([match]) => match);
}

test("every control that fades while it cannot be used fades by the one disabled token", () => {
  const strays = sources().flatMap(({ path, text }) =>
    (path.endsWith(".css") ? cssFades(text) : classFades(text)).map((fade) => `${path}: ${fade}`),
  );
  assert.deepEqual(strays, []);
});

test("the disabled token is one value, the same in every profile", () => {
  const profiles = readFileSync(new URL("./profiles.css", import.meta.url), "utf8");
  const values = new Set(
    [...profiles.matchAll(/--luke-disabled-opacity:\s*([^;]+);/g)].map(([, value]) => value),
  );
  assert.equal(values.size, 1);
});
