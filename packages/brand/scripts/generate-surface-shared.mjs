#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND } from "./brand-palette.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACE = join(HERE, "..", "src", "generated");
const UI_TOKENS = join(HERE, "..", "..", "ui", "src", "tokens");

const SPRING = [
  0, 0.0285, 0.0993, 0.1943, 0.3005, 0.4083, 0.5115, 0.6061, 0.69, 0.7623, 0.8229, 0.8727, 0.9125,
  0.9437, 0.9674, 0.9848, 0.9972, 1.0056, 1.0109, 1.0138, 1.015, 1.015, 1.0142, 1.0129, 1.0114,
  1.0098, 1,
];
const SPRING_FAST = [
  0, 0.0288, 0.1002, 0.1961, 0.3029, 0.4113, 0.5149, 0.6097, 0.6935, 0.7656, 0.826, 0.8755, 0.9149,
  0.9457, 0.969, 0.9861, 0.9982, 1.0063, 1.0113, 1.014, 1.0151, 1.015, 1.0141, 1.0127, 1.0112,
  1.0095, 1,
];

const MOTION_DURATION_MS = {
  FAST: 280,
  SHAPE: 460,
  EXIT: 90,
  QUICK: 140,
  HOVER: 70,
  PANE: 240,
};
const MOTION_DELAY_MS = {
  ROW_STAGGER: 32,
  HINT: 500,
  LATE: 1000,
  CONFIRM: 1200,
  FLASH: 800,
  SETTLE: 180,
};
const MOTION_EXIT = "cubic-bezier(0.4, 0, 0.6, 1)";
const MOTION_PANE = "cubic-bezier(0.2, 0, 0, 1)";

const MARK_PATHS = {
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

function uiMotionTokensCss() {
  return `:root {
  --ui-spring: ${linearCss(SPRING)};
  --ui-spring-fast: ${linearCss(SPRING_FAST)};
  --ui-duration-hover: ${ms(MOTION_DURATION_MS.HOVER)};
  --ui-duration-exit: ${ms(MOTION_DURATION_MS.EXIT)};
  --ui-duration-quick: ${ms(MOTION_DURATION_MS.QUICK)};
  --ui-duration-pane: ${ms(MOTION_DURATION_MS.PANE)};
  --ui-duration-fast: ${ms(MOTION_DURATION_MS.FAST)};
  --ui-duration-shape: ${ms(MOTION_DURATION_MS.SHAPE)};
  --ui-motion-exit: ${MOTION_EXIT};
  --ui-motion-pane: ${MOTION_PANE};
  --ui-row-stagger: ${ms(MOTION_DELAY_MS.ROW_STAGGER)};
  --ui-hint-delay: ${ms(MOTION_DELAY_MS.HINT)};
  --ui-late-delay: ${ms(MOTION_DELAY_MS.LATE)};
  --ui-confirm-delay: ${ms(MOTION_DELAY_MS.CONFIRM)};
  --ui-flash-delay: ${ms(MOTION_DELAY_MS.FLASH)};
  --ui-settle-delay: ${ms(MOTION_DELAY_MS.SETTLE)};
}
`;
}

function tsRecord(entries, indent = "  ") {
  return entries.map(([key, value]) => `${indent}${key}: ${value},`).join("\n");
}

function motionTokensTs() {
  return `export const MOTION_DURATION_MS = {
${tsRecord(Object.entries(MOTION_DURATION_MS).map(([key, value]) => [key, value]))}
} as const;

export const MOTION_DELAY_MS = {
${tsRecord(Object.entries(MOTION_DELAY_MS).map(([key, value]) => [key, value]))}
} as const;
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
  const google = GOOGLE_MARK_LAYERS.map(
    (layer) => `  {\n    fill: "${layer.fill}",\n    path: "${layer.path}",\n  },`,
  ).join("\n");
  return `${pathConsts}

export const GOOGLE_MARK_LAYERS: readonly { fill: string; path: string }[] = [
${google}
];
`;
}

const roleName = (key) => `--ui-color-${key.toLowerCase().replaceAll("_", "-")}`;

function uiBrandCss() {
  const keys = Object.keys(BRAND.LIGHT);
  const pair = (key) =>
    BRAND.LIGHT[key] === BRAND.DARK[key]
      ? BRAND.LIGHT[key]
      : `light-dark(${BRAND.LIGHT[key]}, ${BRAND.DARK[key]})`;
  const block = (value) => keys.map((key) => `  ${roleName(key)}: ${value(key)};`).join("\n");
  return `[data-ui-profile="desktop"] {
${block(pair)}
}

[data-ui-profile="web"],
[data-ui-profile="web"][data-ui-theme="light"] {
${block((key) => BRAND.LIGHT[key])}
}

[data-ui-profile="web"][data-ui-theme="dark"] {
${block((key) => BRAND.DARK[key])}
}

[data-ui-profile] {
  --ui-color-accent-on-light: ${BRAND.LIGHT.ACCENT};
  --ui-color-accent-on-dark: ${BRAND.DARK.ACCENT};
}
`;
}

function brandPaletteTs() {
  const theme = (values) =>
    tsRecord(
      Object.entries(values).map(([key, value]) => [key, `"${value}"`]),
      "    ",
    );
  return `export const BRAND_PALETTE = {
  LIGHT: {
${theme(BRAND.LIGHT)}
  },
  DARK: {
${theme(BRAND.DARK)}
  },
} as const;
`;
}

const outputs = [
  [join(SURFACE, "motion-tokens.ts"), motionTokensTs()],
  [join(SURFACE, "provider-mark-paths.ts"), providerMarkPathsTs()],
  [join(UI_TOKENS, "motion-tokens.css"), uiMotionTokensCss()],
  [join(SURFACE, "brand-palette.ts"), brandPaletteTs()],
  [join(UI_TOKENS, "brand.css"), uiBrandCss()],
];

for (const [path, content] of outputs) {
  put(path, content);
  written.push(path);
}

if (!CHECK_ONLY) {
  process.stdout.write(`${written.length} generated files written\n`);
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node packages/brand/scripts/generate-surface-shared.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length} generated files are up to date\n`);
}
