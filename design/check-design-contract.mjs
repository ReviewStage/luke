#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STYLE_ROOT = join(ROOT, "apps", "desktop", "src", "renderer", "styles");
const failures = [];
// The window's own sheets, which spend the spacing scale in desktop.css's
// :root rather than a pixel of their own (docs/DESIGN.md).
const SPACED_SHEETS = new Set(["desktop.css", "tooltip.css"]);
const SPACING_DECLARATION =
  /(?<![\w-])((?:padding|margin)(?:-[a-z-]+)?|(?:row-|column-)?gap)\s*:\s*([^;]+);([ \t]*\/\*\s*off-scale\b)?/gu;

// A value less every calc that spends a token, which may adjust it by a pixel
// as a border asks.
function withoutTokenCalcs(value) {
  let rest = value;
  let start = rest.indexOf("calc(");
  while (start >= 0) {
    let depth = 0;
    let end = start + "calc".length;
    do {
      if (rest[end] === "(") depth += 1;
      if (rest[end] === ")") depth -= 1;
      end += 1;
    } while (depth > 0 && end < rest.length);
    const spends = rest.slice(start, end).includes("var(");
    if (spends) rest = rest.slice(0, start) + rest.slice(end);
    start = rest.indexOf("calc(", spends ? start : end);
  }
  return rest;
}

function keyframeBodies(source) {
  const bodies = [];
  const pattern = /@keyframes\s+[\w-]+\s*\{/gu;
  for (const match of source.matchAll(pattern)) {
    const opening = (match.index ?? 0) + match[0].length - 1;
    let depth = 1;
    let cursor = opening + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    bodies.push(source.slice(opening + 1, cursor - 1));
  }
  return bodies;
}

for (const name of readdirSync(STYLE_ROOT).filter((entry) => entry.endsWith(".css"))) {
  const source = readFileSync(join(STYLE_ROOT, name), "utf8");
  if (/^[\t ]*@starting-style\b/mu.test(source)) {
    failures.push(`${name}: use a backwards-filled mount animation, not @starting-style`);
  }

  for (const body of keyframeBodies(source)) {
    if (/\b(?:width|height|padding|font-size)\s*:/u.test(body)) {
      failures.push(`${name}: keyframes may not animate layout properties`);
    }
  }

  const rules = source.matchAll(/([^{}]+)\{([^{}]*)\}/gsu);
  for (const [, selector, body] of rules) {
    if (SPACED_SHEETS.has(name)) {
      for (const [, property, value, offScale] of body.matchAll(SPACING_DECLARATION)) {
        if (offScale || !/(?<![\w.])0*[1-9]\d*(?:\.\d+)?px\b/u.test(withoutTokenCalcs(value))) {
          continue;
        }
        failures.push(
          `${name}: ${selector.replace(/\/\*[\s\S]*?\*\//gu, "").trim()} spends a literal ${property}; use the spacing scale or mark it /* off-scale */`,
        );
      }
    }

    for (const declaration of body.matchAll(
      /\b(animation(?:-duration|-delay)?|transition(?:-duration|-delay|-property)?)\s*:\s*([^;]+);/gu,
    )) {
      const [property, value] = declaration.slice(1);
      if (property.startsWith("animation") && /\binfinite\b/u.test(value)) {
        if (!/animation-play-state\s*:\s*var\(--(?:loop|face)-motion\)/u.test(body)) {
          failures.push(`${name}: ${selector.trim()} loops without a motion play-state token`);
        }
      }

      if (
        property.startsWith("transition") &&
        /\b(?:width|height|padding|font-size)\b/u.test(value) &&
        !selector.includes(".panel-surface")
      ) {
        failures.push(`${name}: ${selector.trim()} transitions a layout property`);
      }

      const literalTimes = [...value.matchAll(/(-?\d*\.?\d+)(ms|s)\b/gu)].filter((match) => {
        const milliseconds = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
        return milliseconds > 1;
      });
      if (literalTimes.length === 0) continue;
      const guardedAnimation =
        property.startsWith("animation") &&
        /animation-play-state\s*:\s*var\(--(?:loop|face)-motion\)/u.test(body);
      if (!guardedAnimation) {
        failures.push(
          `${name}: ${selector.trim()} uses a literal motion time without a play-state token`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Design contract checks failed:\n${failures.map((line) => `- ${line}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write("Design contract checks passed.\n");
