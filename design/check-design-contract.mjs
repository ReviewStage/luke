#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STYLE_ROOT = join(ROOT, "apps", "desktop", "src", "renderer", "styles");
const failures = [];

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

  // Generated face keyframes own their literal cycles as artwork. Their shared
  // .luke-face-part rule supplies --face-motion, so per-rule checking would
  // mistake that inheritance for an unguarded animation.
  const checksLiteralCycles = name !== "face-motion.css";
  const rules = source.matchAll(/([^{}]+)\{([^{}]*)\}/gsu);
  for (const [, selector, body] of rules) {
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

      if (!checksLiteralCycles) continue;
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
