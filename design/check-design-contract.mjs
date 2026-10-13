#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STYLE_ROOT = join(ROOT, "apps", "desktop", "src", "renderer", "styles");
const failures = [];
// The window's own sheets, which spend the spacing scale in desktop.css's
// :root rather than a pixel of their own (docs/DESIGN.md).
const SPACED_SHEETS = new Set(["desktop.css", "sign-in.css", "tooltip.css"]);
const SPACING_DECLARATION =
  /(?<![\w-])((?:padding|margin)(?:-[a-z-]+)?|(?:row-|column-)?gap)\s*:\s*([^;]+);([ \t]*\/\*\s*off-scale\b)?/gu;
// A colour is a token: named in a `:root` block, the dark one or the light
// one under `prefers-color-scheme`, so every sheet flips with the appearance.
// A mask's black is an alpha rather than a colour, so a mask may spell it.
const COLOUR_LITERAL =
  /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(?:white|black)(?![\w-])/iu;
const MASK_PROPERTY = /^(?:-webkit-)?mask(?:-image)?$/u;
// The keyboard's ring is base.css's, drawn on the --focus-ring tokens. A rule
// that takes it away says what marks the focus instead, as `/* no ring: … */`
// on the declaration, and a rule that draws one draws it on the tokens.
const RING_REMOVED = /(?<![\w-])outline(?:-style)?\s*:\s*(?:none|0)\s*;(?![ \t]*\/\*\s*no ring:)/u;
const FOCUS_SELECTOR = /:focus(?:-visible|-within)?\b/u;
const OUTLINE_DECLARATION = /(?<![\w-])(outline(?:-color|-width|-offset)?)\s*:\s*([^;]+);/gu;
// Every menu and popover draws its corner, shadow, and ground from the menu
// tokens in desktop.css's :root, and every menu row its height and corner, so
// no two of them disagree (docs/DESIGN.md). The command palette is a dialog,
// cornered and shadowed as one, so only its rows are held to the menu's.
const MENU_TOKENS = [
  {
    classes: [
      "plan-menu",
      "plan-compose-menu",
      "plan-compose-submenu",
      "file-crumb-tree",
      "find-bar",
      "tooltip-card",
      "agent-context-popover",
    ],
    spend: {
      "border-radius": "var(--menu-radius)",
      "box-shadow": "var(--menu-shadow)",
      background: "var(--surface-popover)",
    },
  },
  {
    classes: ["plan-menu-item", "plan-compose-menu-row", "command-palette-row"],
    spend: { height: "var(--menu-row-height)", "border-radius": "var(--menu-row-radius)" },
  },
];

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

// The body of every block whose opening the pattern matches, braces balanced.
function blockBodies(source, pattern) {
  const bodies = [];
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

// The menu tokens a rule's selector owes, read off the last compound of each
// selector in its list: `.anchored-popover > .plan-compose-menu` styles the
// menu, `.plan-compose-menu-row svg` styles a glyph.
function menuTokensOwed(selector) {
  const owed = {};
  let depth = 0;
  let start = 0;
  const selectors = [];
  for (let cursor = 0; cursor <= selector.length; cursor += 1) {
    const character = selector[cursor];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (cursor === selector.length || (character === "," && depth === 0)) {
      selectors.push(selector.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  for (const one of selectors) {
    const subject = one.split(/\s*[>+~]\s*|\s+/u).at(-1) ?? "";
    for (const { classes, spend } of MENU_TOKENS) {
      if (classes.some((name) => new RegExp(`\\.${name}(?![\\w-])`, "u").test(subject))) {
        Object.assign(owed, spend);
      }
    }
  }
  return owed;
}

function keyframeBodies(source) {
  return blockBodies(source, /@keyframes\s+[\w-]+\s*\{/gu);
}

// The window's native ground shows before the renderer paints and wherever it
// has not yet, so main's ground for each appearance has to be desktop.css's
// --desktop-ground for that appearance, or a launch or a resize flashes
// another colour. The light one is held once the sheet declares it.
function checkWindowGrounds() {
  const panelManager = readFileSync(
    join(ROOT, "apps", "desktop", "src", "main", "window", "panel-manager.ts"),
    "utf8",
  );
  const sheet = readFileSync(join(STYLE_ROOT, "desktop.css"), "utf8");
  const grounds = /BACKGROUND:\s*\{\s*DARK:\s*"([^"]+)",\s*LIGHT:\s*"([^"]+)"\s*\}/u.exec(
    panelManager,
  );
  if (!grounds) {
    failures.push("panel-manager.ts: DESKTOP_WINDOW.BACKGROUND is not { DARK, LIGHT }");
    return;
  }
  const lightPattern = /@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)\s*\{/gu;
  const groundIn = (css) => /--desktop-ground\s*:\s*([^;]+);/u.exec(css)?.[1].trim();
  const lightBodies = blockBodies(sheet, lightPattern);
  const light = lightBodies.map(groundIn).find(Boolean);
  const dark = groundIn(lightBodies.reduce((rest, body) => rest.replace(body, ""), sheet));
  const expected = [
    ["DARK", grounds[1], dark],
    ["LIGHT", grounds[2], light],
  ];
  for (const [appearance, main, css] of expected) {
    if (css !== undefined && main.toLowerCase() !== css.toLowerCase()) {
      failures.push(
        `panel-manager.ts: the ${appearance} window ground ${main} is not desktop.css's --desktop-ground ${css}`,
      );
    }
  }
  if (dark === undefined) failures.push("desktop.css: --desktop-ground is not declared");
}

checkWindowGrounds();

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
    const bare = selector.replace(/\/\*[\s\S]*?\*\//gu, "").trim();
    if (bare !== ":root") {
      for (const declaration of body.replace(/\/\*[\s\S]*?\*\//gu, "").split(";")) {
        const colon = declaration.indexOf(":");
        const property = declaration.slice(0, colon).trim();
        if (colon < 0 || MASK_PROPERTY.test(property)) continue;
        if (COLOUR_LITERAL.test(declaration.slice(colon + 1))) {
          failures.push(`${name}: ${bare} spends a literal colour in ${property}; use a token`);
        }
      }
    }

    const oneLine = bare.replace(/\s+/gu, " ");
    if (RING_REMOVED.test(body)) {
      failures.push(
        `${name}: ${oneLine} takes the focus ring away; say what marks focus instead with /* no ring: … */`,
      );
    }
    const offTokens = [...body.matchAll(OUTLINE_DECLARATION)].some(
      ([, property, value]) =>
        /\d*\.?\d+px\b/u.test(withoutTokenCalcs(value)) ||
        ((property === "outline" || property === "outline-color") &&
          !/^(?:none|0)$/u.test(value.trim()) &&
          !/var\(--focus-ring\)/u.test(value)),
    );
    if (FOCUS_SELECTOR.test(bare) && offTokens) {
      failures.push(`${name}: ${oneLine} draws a focus ring off the --focus-ring tokens`);
    }

    const owed = menuTokensOwed(bare);
    for (const declaration of body.replace(/\/\*[\s\S]*?\*\//gu, "").split(";")) {
      const colon = declaration.indexOf(":");
      const property = declaration.slice(0, colon).trim();
      const token = owed[property];
      if (colon < 0 || token === undefined) continue;
      const value = declaration.slice(colon + 1).trim();
      if (value !== token) {
        failures.push(`${name}: ${bare} spends ${value} for its ${property}; use ${token}`);
      }
    }

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
        /\b(?:width|height|padding|font-size)\b/u.test(value)
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
