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
// The one monospace stack is base.css's `--font-mono`; any other sheet, or
// any other rule, spends the token rather than spelling a stack of its own.
const MONOSPACE_STACK = /(?<![\w-])monospace(?![\w-])/u;
const FONT_PROPERTY = /^(?:font(?:-family)?|--[\w-]*font[\w-]*)$/u;
// A control floating over a thumbnail keeps a target of at least 24px
// however small the disc it draws (docs/DESIGN.md), so no rule on the
// control itself, a state or a placement of it included, sizes it smaller.
const THUMBNAIL_CONTROLS = [".corner-dismiss"];
const MINIMUM_TARGET = 24;
const BOX_SIZE = /(?<![\w-])((?:min-|max-)?(?:width|height))\s*:\s*(\d*\.?\d+)px\b/gu;

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

// Content arriving rides the pair every arriving element rides, its opacity
// over `--duration-quick` and any travel on the spring, and content leaving
// goes first, over `--duration-exit` (docs/DESIGN.md). A keyframes block that
// holds a `from` alone is an arrival, one that holds a `to` alone an exit.
// Travel may ride the panes' curve instead, the vocabulary's one exception,
// for what moves with a pane's edge or a clip unrolled on it.
const TRAVEL = /\b(?:transform|translate|scale|rotate)\s*:/u;
const OPACITY = /\bopacity\s*:/u;
const KEYFRAMES_KIND = { ARRIVAL: "arrival", EXIT: "exit", OTHER: "other" };

// Each keyframes block across the sheets, by name: whether it is an arrival,
// an exit, or neither, and whether it moves and whether it fades.
function keyframesByName(sources) {
  const named = new Map();
  for (const source of sources) {
    const names = [...source.matchAll(/@keyframes\s+([\w-]+)\s*\{/gu)].map((match) => match[1]);
    keyframeBodies(source).forEach((body, index) => {
      const steps = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)];
      const only = steps.length === 1 ? steps[0][1].trim() : undefined;
      const kind =
        only === "from"
          ? KEYFRAMES_KIND.ARRIVAL
          : only === "to"
            ? KEYFRAMES_KIND.EXIT
            : KEYFRAMES_KIND.OTHER;
      named.set(names[index], { kind, travels: TRAVEL.test(body), fades: OPACITY.test(body) });
    });
  }
  return named;
}

// The comma-separated parts of a value, commas inside parentheses left whole.
function topLevelParts(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let cursor = 0; cursor <= value.length; cursor += 1) {
    const character = value[cursor];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (cursor === value.length || (character === "," && depth === 0)) {
      parts.push(value.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  return parts;
}

// What one `animation` shorthand owes the pair: an arrival keeps its fade and
// its travel apart, fades over `--duration-quick`, and travels on the spring;
// an exit runs over `--duration-exit` on `--motion-exit`.
function motionPairFailures(name, selector, value, keyframes) {
  const found = [];
  for (const part of topLevelParts(value)) {
    const frames = part
      .split(/\s+/u)
      .map((token) => keyframes.get(token))
      .find(Boolean);
    if (frames === undefined || /\binfinite\b/u.test(part)) continue;
    const where = `${name}: ${selector}`;
    if (frames.kind === KEYFRAMES_KIND.ARRIVAL) {
      if (frames.travels && frames.fades) {
        found.push(`${where} arrives fading and travelling in one keyframes; split the pair`);
      } else if (frames.fades && !part.includes("var(--duration-quick)")) {
        found.push(`${where} fades in over another time than --duration-quick`);
      } else if (
        frames.travels &&
        !part.includes("var(--spring") &&
        !part.includes("var(--motion-pane)")
      ) {
        found.push(`${where} travels in on another curve than the spring`);
      }
    }
    if (
      frames.kind === KEYFRAMES_KIND.EXIT &&
      !(part.includes("var(--duration-exit)") && part.includes("var(--motion-exit)"))
    ) {
      found.push(`${where} leaves over another time than --duration-exit on --motion-exit`);
    }
  }
  return found;
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

// Which thumbnail control a selector list sizes, if one of its selectors
// ends on the control itself rather than on something inside it.
function thumbnailControlOf(selector) {
  return THUMBNAIL_CONTROLS.find((control) =>
    selector.split(",").some((each) =>
      each
        .trim()
        .replace(/(?::[\w-]+(?:\([^)]*\))?)+$/u, "")
        .endsWith(control),
    ),
  );
}

// Every token whose value is a computation rather than a bare alias, keyed
// by that value. A rule that spells the computation out keeps one
// appearance's value when the other :root restates the token, as the compose
// menu's switch once drew the dark --switch-on in light.
function computedTokens(names) {
  const tokens = new Map();
  for (const name of names) {
    const source = readFileSync(join(STYLE_ROOT, name), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)) {
      if (selector.trim() !== ":root") continue;
      for (const [, token, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)) {
        const spelled = value.trim().replace(/\s+/gu, " ");
        if (/\w\(/u.test(spelled) && !/^var\([^()]*\)$/u.test(spelled)) tokens.set(spelled, token);
      }
    }
  }
  return tokens;
}

const SHEETS = readdirSync(STYLE_ROOT).filter((entry) => entry.endsWith(".css"));
const KEYFRAMES = keyframesByName(
  SHEETS.map((name) => readFileSync(join(STYLE_ROOT, name), "utf8")),
);
const COMPUTED_TOKENS = computedTokens(SHEETS);
const thumbnailControlSizes = new Map(THUMBNAIL_CONTROLS.map((control) => [control, new Map()]));

for (const name of SHEETS) {
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

    const ownsMonospace = name === "base.css" && bare === ":root";
    for (const declaration of body.replace(/\/\*[\s\S]*?\*\//gu, "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration
        .slice(colon + 1)
        .trim()
        .replace(/\s+/gu, " ");
      if (!ownsMonospace && FONT_PROPERTY.test(property) && MONOSPACE_STACK.test(value)) {
        failures.push(
          `${name}: ${bare} spells a monospace stack in ${property}; use var(--font-mono)`,
        );
      }
      if (bare !== ":root" && COMPUTED_TOKENS.has(value)) {
        failures.push(
          `${name}: ${bare} spells ${COMPUTED_TOKENS.get(value)}'s value in ${property}; use the token`,
        );
      }
    }

    const control = thumbnailControlOf(bare);
    for (const [, property, pixels] of control ? body.matchAll(BOX_SIZE) : []) {
      if (Number(pixels) < MINIMUM_TARGET) {
        failures.push(
          `${name}: ${bare} sizes a thumbnail control's ${property} to ${pixels}px; its target is at least ${MINIMUM_TARGET}px`,
        );
      }
      if (bare === control) thumbnailControlSizes.get(control).set(property, Number(pixels));
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
      if (property === "animation") {
        failures.push(...motionPairFailures(name, bare, value, KEYFRAMES));
      }
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

for (const [control, sizes] of thumbnailControlSizes) {
  for (const property of ["width", "height"]) {
    if (!sizes.has(property)) {
      failures.push(
        `${control} declares no ${property} of its own; give its target at least ${MINIMUM_TARGET}px`,
      );
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
