#!/usr/bin/env node
// Shared surface vocabulary — the single source for the tokens, marks, labels,
// and window-layout sizes both the desktop renderer and the marketing mock
// draw from.
//
//   node design/generate-surface-shared.mjs
//
// It writes three committed outputs into packages/surface/src/generated, all from the
// tables further down:
//
//   src/motion-tokens.css       springs, durations, and the layout sizes
//   src/motion-tokens.ts        the same durations and sizes, as numbers
//   src/provider-mark-paths.ts  SVG path data for the sign-in provider marks
//
// The React that traces the marks, and the rules that consume the tokens, stay
// in each app: a shared component would pull desktop-only code into the web
// bundle. Emitting the data from here keeps the second copy from being a
// second source. `repository-checks.sh` runs this with `--check`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE = join(HERE, "..", "packages", "surface", "src", "generated");

// ---------- Motion tokens ----------
// Sampled damped springs, one duration. A real spring's motion is a property
// of the spring, not of how far it is asked to travel, which is why the same
// samples serve a 176px peek and a 482px panel.
const SPRING = [
  0, 0.0285, 0.0993, 0.1943, 0.3005, 0.4083, 0.5115, 0.6061, 0.69, 0.7623, 0.8229, 0.8727, 0.9125,
  0.9437, 0.9674, 0.9848, 0.9972, 1.0056, 1.0109, 1.0138, 1.015, 1.015, 1.0142, 1.0129, 1.0114,
  1.0098, 1,
];
// The same damping ratio; only the frequency changes, which is what a smaller
// and lighter element wants.
const SPRING_FAST = [
  0, 0.0288, 0.1002, 0.1961, 0.3029, 0.4113, 0.5149, 0.6097, 0.6935, 0.7656, 0.826, 0.8755, 0.9149,
  0.9457, 0.969, 0.9861, 0.9982, 1.0063, 1.0113, 1.014, 1.0151, 1.015, 1.0141, 1.0127, 1.0112,
  1.0095, 1,
];

const MOTION_DURATION_MS = {
  FAST: 280,
  SURFACE: 460,
  EXIT: 90,
  QUICK: 140,
  HOVER: 70,
};
const MOTION_DELAY_MS = {
  EXPAND: 200,
  PEEK: 60,
  ROW_STAGGER: 32,
};
const MOTION_EXIT = "cubic-bezier(0.4, 0, 0.6, 1)";
const ROW_FAN_PX = 7;
const ROW_FAN_LIMIT = 5;

// Window layout sizes the main process and both stylesheets spend.
const SURFACE_GEOMETRY_PX = {
  // The caption block grows to the words and nothing scrolls, so the
  // reservation sits past what a reply wraps to at the peek's width: fourteen
  // 14px lines plus the block's own padding, room enough for two long
  // responses stacked. The window cannot resize for speech, so this bound is
  // physical: a stack taller still rolls up inside the block, its oldest
  // lines leaving under the housing, rather than growing the window.
  VOICE_CAPTION_MAX_HEIGHT: 210,
  // The one gap between anything the surface grows below the strip. The
  // words and the volume hint stack under the housing in the compact states
  // and at the panel's foot when it opens, and each of them is this far from
  // the strip above it, from the band before it, and from the shape's bottom
  // edge below it — so a reply that draws both reads as one evenly spaced
  // column rather than two bands that each chose their own breathing room.
  VOICE_BAND_INSET: 6,
  PANEL_WIDTH: 620,
  PANEL_MAX_HEIGHT: 520,
};

// ---------- Provider mark paths ----------
// Each is the provider's own mark, reproduced rather than redrawn. Attribution
// lives with the React that traces them; this table is only the geometry.
const MARK_PATHS = {
  /*
   * GitHub's Octocat mark, verbatim from the invertocat GitHub publishes, on
   * its 16-unit canvas. Drawn wherever a GitHub sign-in names itself: the
   * account row and the loopback landing page.
   */
  GITHUB:
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z",
};

const GOOGLE_MARK_LAYERS = [
  {
    fill: "#4285F4",
    path: "M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z",
  },
  {
    fill: "#34A853",
    path: "M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z",
  },
  {
    fill: "#FBBC05",
    path: "M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z",
  },
  {
    fill: "#EA4335",
    path: "M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z",
  },
];

// ---------- Emission ----------
const CHECK_ONLY = process.argv.includes("--check");
const written = [];
const stale = [];

function put(path, content) {
  if (CHECK_ONLY) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current !== content) stale.push(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function linearCss(samples) {
  return `linear(\n    ${samples.join(",\n    ")}\n  )`;
}

function ms(value) {
  return `${value}ms`;
}

function px(value) {
  return `${value}px`;
}

function motionTokensCss() {
  return `/* Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
   the tables in that script and re-run it.

   One motion vocabulary for both surfaces. The desktop renderer and the
   marketing mock import this file so a spring, a duration, or a layout size
   cannot drift between the product and the page that advertises it. */

:root {
  --spring: ${linearCss(SPRING)};
  --spring-fast: ${linearCss(SPRING_FAST)};
  --duration-fast: ${ms(MOTION_DURATION_MS.FAST)};
  --motion-exit: ${MOTION_EXIT};
  --duration-shape: ${ms(MOTION_DURATION_MS.SURFACE)};
  --duration-exit: ${ms(MOTION_DURATION_MS.EXIT)};
  --duration-quick: ${ms(MOTION_DURATION_MS.QUICK)};
  --duration-hover: ${ms(MOTION_DURATION_MS.HOVER)};
  --expand-delay: ${ms(MOTION_DELAY_MS.EXPAND)};
  --peek-delay: ${ms(MOTION_DELAY_MS.PEEK)};
  --row-stagger: ${ms(MOTION_DELAY_MS.ROW_STAGGER)};
  --row-fan: ${ROW_FAN_PX}px;
  --row-fan-limit: ${ROW_FAN_LIMIT};
  --slot-delay: calc(var(--duration-exit) + var(--peek-delay));
  --caption-max: ${px(SURFACE_GEOMETRY_PX.VOICE_CAPTION_MAX_HEIGHT)};
  --voice-band-inset: ${px(SURFACE_GEOMETRY_PX.VOICE_BAND_INSET)};
  --panel-width: ${px(SURFACE_GEOMETRY_PX.PANEL_WIDTH)};
  --panel-height-max: ${px(SURFACE_GEOMETRY_PX.PANEL_MAX_HEIGHT)};
}
`;
}

function tsRecord(entries, indent = "  ") {
  return entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");
}

function motionTokensTs() {
  return `// Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// Millisecond mirrors of the CSS duration tokens in motion-tokens.css, from the
// same table. A main-process constant that waits on a CSS total names these
// rather than restating the numbers. Pixel sizes follow the same rule: the
// window and the drawing both name these, and the stylesheet spends the CSS
// variables emitted beside them.

export const MOTION_DURATION_MS = {
${tsRecord(Object.entries(MOTION_DURATION_MS).map(([key, value]) => [key, value]))}
} as const;

export const MOTION_DELAY_MS = {
${tsRecord(Object.entries(MOTION_DELAY_MS).map(([key, value]) => [key, value]))}
} as const;

/** Tallest caption block the window holds — sized past a whole spoken reply,
 * because the block grows to the words and nothing scrolls; a taller stack
 * rolls up inside it. CSS: \`--caption-max\`. */
export const VOICE_CAPTION_MAX_HEIGHT = ${SURFACE_GEOMETRY_PX.VOICE_CAPTION_MAX_HEIGHT};

/** The one gap between the strip, each band grown below it, and the shape's
 * bottom edge. CSS: \`--voice-band-inset\`. */
export const VOICE_BAND_INSET = ${SURFACE_GEOMETRY_PX.VOICE_BAND_INSET};
`;
}

function tsStringConst(name, value) {
  const single = `export const ${name} = "${value}";`;
  return single.length <= 100 ? single : `export const ${name} =\n  "${value}";`;
}

function providerMarkPathsTs() {
  const pathConsts = Object.entries(MARK_PATHS)
    .map(([name, path]) => tsStringConst(`${name}_PATH`, path))
    .join("\n\n");
  // One property per line, matching the shape Biome would format these to —
  // the emitted file is committed and linted, so the two must agree exactly.
  const google = GOOGLE_MARK_LAYERS.map(
    (layer) => `  {\n    fill: "${layer.fill}",\n    path: "${layer.path}",\n  },`,
  ).join("\n");
  return `// Generated by design/generate-surface-shared.mjs. Do not edit by hand: change
// the tables in that script and re-run it.
//
// SVG path data for the marks a sign-in names itself by. The React that traces
// them stays in each app.

${pathConsts}

// Google's "G" sign-in mark, drawn as filled layers in an 18×18 box.
export const GOOGLE_MARK_LAYERS: readonly { fill: string; path: string }[] = [
${google}
];
`;
}

const outputs = [
  ["motion-tokens.css", motionTokensCss()],
  ["motion-tokens.ts", motionTokensTs()],
  ["provider-mark-paths.ts", providerMarkPathsTs()],
];

for (const [name, content] of outputs) {
  put(join(SURFACE, name), content);
  written.push(name);
}

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} files written to packages/surface/src/generated/\n`);
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node design/generate-surface-shared.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length} generated files are up to date\n`);
}
