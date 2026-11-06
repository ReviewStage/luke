#!/usr/bin/env node
// Brand-asset generator -- the single source of truth for the artwork.
// The identity is the Keel: a disc cut by a narrow V that opens through its
// top edge and cradles an island, drawn in one color. Edit the constants
// below and re-run:
//
//   node packages/brand/scripts/generate-brand-assets.mjs
//
// It writes two kinds of output, both from the one description of the mark:
//
//   packages/brand/assets/**.svg                 standalone assets
//   packages/brand/src/generated/mark-art.ts     the mark's and the wordmark's geometry, for @repo/ui
//
// The colors are the brand's, read from brand-palette.mjs, the table
// @repo/ui's palette is generated from too, so a change of brand redraws
// the icons with the app.
//
// PNG derivatives (app icon sizes, the cards) are rasterized separately --
// see packages/brand/README.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_NAME } from "../../features/src/product-name.ts";
import { bayerAt } from "../src/dither.ts";
import { BRAND } from "./brand-palette.mjs";
import { DMG_WINDOW } from "./dmg-window.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "assets");
const SURFACE = join(HERE, "..", "src", "generated");

// ---------- The mark ----------
// Keel H, on a 100-unit disc of radius 50 centered at (50, 50), built from
// straight lines and circular arcs only and booleaned into one outline: the
// V's arms open 25 degrees off vertical and meet on a round join 70% down,
// the channel is 10.5% of the disc, and every corner where the channel meets
// the rim, and the island's tip, is rounded at 3%. Its one color fills it,
// the body and the island alike. Below 32 pixels the small cut takes over,
// its channel opened to 13.5% so the V still reads at 16, the way a typeface
// has optical sizes.
const MARK = {
  VIEW_BOX: "0 0 100 100",
  PATH: "M0,50c0,-13.55 5.39,-25.84 14.14,-34.84c0.54,-0.56 1.30,-0.90 2.15,-0.90c1.22,0 2.28,0.73 2.74,1.79l26.14,56.07c0.81,1.84 2.65,3.13 4.80,3.13c2.14,0 3.99,-1.29 4.80,-3.13l26.14,-56.07c0.46,-1.05 1.51,-1.79 2.74,-1.79c0.84,0 1.60,0.34 2.15,0.90c8.75,9.00 14.14,21.29 14.14,34.84c0,27.61 -22.38,50 -50,50c-27.61,0 -50,-22.38 -50,-50zM28.66,4.76c6.46,-3.05 13.70,-4.76 21.33,-4.76c7.63,0 14.86,1.70 21.33,4.76l-0.00,0.01c1.01,0.48 1.72,1.51 1.72,2.71c0,0.47 -0.11,0.92 -0.30,1.32l-19.99,42.87c-0.46,1.05 -1.51,1.79 -2.74,1.79c-1.22,0 -2.28,-0.73 -2.74,-1.79l-19.99,-42.87c-0.19,-0.39 -0.30,-0.84 -0.30,-1.32c0,-1.19 0.70,-2.23 1.72,-2.71z",
  SMALL_PATH:
    "M0,50c0,-12.93 4.91,-24.71 12.96,-33.59l0.00,0.00c0.54,-0.60 1.34,-0.98 2.22,-0.98c1.22,0 2.28,0.73 2.74,1.79l25.88,55.50c1.04,2.37 3.41,4.03 6.18,4.03c2.76,0 5.13,-1.65 6.18,-4.03l25.88,-55.50c0.46,-1.05 1.51,-1.79 2.74,-1.79c0.88,0 1.67,0.37 2.22,0.98l0.00,-0.00c8.05,8.87 12.96,20.66 12.96,33.59c0,27.61 -22.38,50 -50,50c-27.61,0 -50,-22.38 -50,-50zM30.12,4.10c6.09,-2.64 12.81,-4.10 19.87,-4.10c7.06,0 13.78,1.46 19.87,4.10l-0.00,0.01c1.06,0.46 1.80,1.52 1.80,2.75c0,0.47 -0.11,0.92 -0.30,1.32l-18.16,38.95c-0.54,1.23 -1.77,2.09 -3.20,2.09c-1.43,0 -2.66,-0.86 -3.20,-2.09l-18.16,-38.95c-0.19,-0.39 -0.30,-0.84 -0.30,-1.32c0,-1.23 0.74,-2.29 1.80,-2.75z",
};

// ---------- The wordmark ----------
// The name set in Geist SemiBold at -2% tracking and outlined, so no asset
// depends on an installed font, with the i's square dot drawn as a circle a
// touch wider than the stem, since a round dot reads smaller than a square
// one. Units are the type's, at 100 to the em: the baseline is y 0, the cap
// height 71 above it, and INK the outline's own box.
const WORDMARK = {
  PATH: "M43.2 0L27.6 0L1.9 -71L15.6 -71L35.5 -14.5L55.3 -71L69 -71L43.2 0M94.2 1.2L94.2 1.2Q86.2 1.2 80.3 -2.25Q74.4 -5.7 71.2 -12Q68 -18.3 68 -26.7L68 -26.7Q68 -35.1 71.2 -41.4Q74.4 -47.7 80.25 -51.15Q86.1 -54.6 93.9 -54.6L93.9 -54.6Q101.5 -54.6 107.2 -51.2Q112.9 -47.8 116.05 -41.4Q119.2 -35 119.2 -26L119.2 -26L119.2 -23.1L81.3 -23.1Q81.6 -16.1 85.1 -12.55Q88.6 -9 94.3 -9L94.3 -9Q103 -9 105.4 -16.4L105.4 -16.4L118.5 -15.6Q116.3 -7.8 109.85 -3.3Q103.4 1.2 94.2 1.2M81.3 -31.7L81.3 -31.7L106 -31.7Q105.5 -38.2 102.25 -41.35Q99 -44.5 93.9 -44.5L93.9 -44.5Q88.7 -44.5 85.4 -41.2Q82.1 -37.9 81.3 -31.7M148.9 1.2L148.9 1.2Q136.7 1.2 130.7 -3.9Q124.7 -9 124.1 -16.8L124.1 -16.8L137.2 -17.4Q137.9 -13.2 140.55 -10.9Q143.2 -8.6 149 -8.6L149 -8.6Q153.5 -8.6 155.85 -10.05Q158.2 -11.5 158.2 -14.6L158.2 -14.6Q158.2 -16.4 157.35 -17.6Q156.5 -18.8 154.05 -19.7Q151.6 -20.6 146.9 -21.5L146.9 -21.5Q138.8 -22.9 134.2 -24.95Q129.6 -27 127.75 -30.1Q125.9 -33.2 125.9 -37.8L125.9 -37.8Q125.9 -45.2 131.65 -49.9Q137.4 -54.6 148.5 -54.6L148.5 -54.6Q156.2 -54.6 161.15 -52.15Q166.1 -49.7 168.65 -45.65Q171.2 -41.6 171.6 -36.6L171.6 -36.6L158.6 -36Q158.4 -39.8 156 -42.3Q153.6 -44.8 148.3 -44.8L148.3 -44.8Q143.8 -44.8 141.45 -43Q139.1 -41.2 139.1 -38.2L139.1 -38.2Q139.1 -35 141.35 -33.45Q143.6 -31.9 149.6 -30.9L149.6 -30.9Q157.8 -29.7 162.6 -27.6Q167.4 -25.5 169.45 -22.35Q171.5 -19.2 171.5 -14.8L171.5 -14.8Q171.5 -7.1 165.35 -2.95Q159.2 1.2 148.9 1.2M192.3 15L179.5 15L179.5 -53.4L191.8 -53.4L192 -45.4Q194.3 -49.9 198.5 -52.25Q202.7 -54.6 208 -54.6L208 -54.6Q215.6 -54.6 220.65 -50.85Q225.7 -47.1 228.2 -40.75Q230.7 -34.4 230.7 -26.7L230.7 -26.7Q230.7 -19 228.15 -12.7Q225.6 -6.4 220.55 -2.6Q215.5 1.2 207.9 1.2L207.9 1.2Q202.8 1.2 198.65 -1.05Q194.5 -3.3 192.3 -7.3L192.3 -7.3L192.3 15M204.9 -9.2L204.9 -9.2Q210.7 -9.2 214.05 -13.85Q217.4 -18.5 217.4 -26.7L217.4 -26.7Q217.4 -34.9 214.05 -39.55Q210.7 -44.2 204.9 -44.2L204.9 -44.2Q199.1 -44.2 195.7 -39.8Q192.3 -35.4 192.3 -26.7L192.3 -26.7Q192.3 -18 195.65 -13.6Q199 -9.2 204.9 -9.2M237.83 -66.20a7.17 7.17 0 1 0 14.34 0a7.17 7.17 0 1 0 -14.34 0ZM251.4 0L238.6 0L238.6 -53.4L251.4 -53.4L251.4 0M276.9 0L264.1 0L264.1 -53.4L275.7 -53.4L276 -44.3Q278.2 -49.8 282.45 -52.2Q286.7 -54.6 292 -54.6L292 -54.6Q300.8 -54.6 305.5 -48.95Q310.2 -43.3 310.2 -34.3L310.2 -34.3L310.2 0L297.4 0L297.4 -30.2Q297.4 -37 295.35 -40.6Q293.3 -44.2 288.1 -44.2L288.1 -44.2Q282.9 -44.2 279.9 -40.6Q276.9 -37 276.9 -30.2L276.9 -30.2L276.9 0",
  CAP_HEIGHT: 71,
  INK: { LEFT: 1.9, RIGHT: 310.2, TOP: -75, BOTTOM: 15 },
};
// The lockup: the disc 1.3 times the cap height, centered on it, a third of
// the disc from the word.
const LOCKUP = { DISC: 1.3, GAP: 0.34 };
// The stacked lockup: the disc twice the cap height, under half the
// word's width, centered over it, and 0.45 of the cap height above the i's dot.
const STACKED = { DISC: 2, GAP: 0.45 };

// ---------- Palette ----------
// Inks are named for the UI mode they serve: the dark-mode asset is light.
const INKS = { light: BRAND.LIGHT.TEXT, dark: BRAND.DARK.TEXT };
// The app icon's two tiles: the dark mode's is the night ground under the
// mark in copper, the light mode's is copper under a white mark. Flat, both:
// no gradient and no shadow.
const TILES = {
  light: { tile: BRAND.LIGHT.ACCENT, ink: BRAND.LIGHT.ON_ACCENT },
  dark: { tile: BRAND.DARK.OVERLAY, ink: BRAND.DARK.ACCENT },
};

// ---------- Helpers ----------
const fmt = (v) => Math.round(v * 100) / 100;
const svgOpenAt = (x, y, w, h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" fill="none">`;
const svgOpen = (w, h) => svgOpenAt(0, 0, w, h);
// The mark in one ink, its 100-unit disc set at (x, y) and `side` across.
const markAt = (x, y, side, ink, path = MARK.PATH) =>
  `<g transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(side / 100)})"><path d="${path}" fill="${ink}"/></g>`;

// The lockup in one ink, or with the mark in its own, in the word's own
// units, and its ink box.
function lockup(ink, markInk = ink) {
  const disc = WORDMARK.CAP_HEIGHT * LOCKUP.DISC;
  const gap = disc * LOCKUP.GAP;
  const top = -WORDMARK.CAP_HEIGHT / 2 - disc / 2;
  const body =
    markAt(0, top, disc, markInk) +
    `<path transform="translate(${fmt(disc + gap)} 0)" d="${WORDMARK.PATH}" fill="${ink}"/>`;
  const box = {
    left: 0,
    right: disc + gap + WORDMARK.INK.RIGHT,
    top: Math.min(top, WORDMARK.INK.TOP),
    bottom: Math.max(top + disc, WORDMARK.INK.BOTTOM),
  };
  return { body, box };
}

// The stacked lockup in one ink, or with the mark in its own, in the word's
// own units, and its ink box.
function stackedLockup(ink, markInk = ink) {
  const { CAP_HEIGHT, INK } = WORDMARK;
  const disc = CAP_HEIGHT * STACKED.DISC;
  const top = INK.TOP - CAP_HEIGHT * STACKED.GAP - disc;
  const left = (INK.LEFT + INK.RIGHT) / 2 - disc / 2;
  const body = markAt(left, top, disc, markInk) + `<path d="${WORDMARK.PATH}" fill="${ink}"/>`;
  return { body, box: { left: INK.LEFT, right: INK.RIGHT, top, bottom: INK.BOTTOM } };
}

// Where a lockup's ink box lands scaled to `fill` of a width-by-height canvas,
// centered on it, or with its left edge at `edge` of the width where given
// and centered down it: its scale and offset, and the box in the canvas's
// units.
function placement(box, width, height, fill, edge) {
  const k = (width * fill) / (box.right - box.left);
  const tx =
    edge === undefined ? width / 2 - (k * (box.left + box.right)) / 2 : width * edge - k * box.left;
  const ty = height / 2 - (k * (box.top + box.bottom)) / 2;
  const at = (x, y) => [tx + k * x, ty + k * y];
  const [left, top] = at(box.left, box.top);
  const [right, bottom] = at(box.right, box.bottom);
  return { k, tx, ty, box: { left, top, right, bottom } };
}

// A lockup's body scaled to `fill` of a width-by-height canvas and centered on
// its ink box.
function centered({ body, box }, width, height, fill) {
  const { k, tx, ty } = placement(box, width, height, fill);
  return `<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(k)})">${body}</g>`;
}

// ---------- Emission ----------
// `--check` reports whether the committed outputs still match what this script
// produces, without touching any of them, for running by hand.
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

function emit(relPath, svg, title) {
  // Accessible name, first child of <svg> per SVG a11y guidance.
  const titled = svg.replace(/(<svg[^>]*>)/, `$1<title>${title}</title>`);
  put(join(OUT, relPath), `${titled}\n`);
  written.push(relPath);
}

// Wordmark and logos on a transparent ground: the wordmark is the name
// alone, for where the mark already stands nearby; the logo is the lockup,
// for headers and docs, and its stacked cut for a square-ish space. Each in
// every one-ink set: each mode's ink, and pure black and pure white for a
// partner, a printer, or a sponsor's wall that asks for exactly those. The
// logos come in color as well: the mark in each mode's copper beside the
// name in that mode's ink.
const ONE_INKS = { ...INKS, black: "#000000", white: "#ffffff" };
const COLOR_INKS = {
  light: { word: INKS.light, mark: BRAND.LIGHT.ACCENT },
  dark: { word: INKS.dark, mark: BRAND.DARK.ACCENT },
};
const LOGO_CUTS = [
  ["logo", lockup],
  ["logo-stacked", stackedLockup],
];
const PAD = 6;
const padded = (box) =>
  svgOpenAt(
    box.left - PAD,
    box.top - PAD,
    box.right - box.left + 2 * PAD,
    box.bottom - box.top + 2 * PAD,
  );
for (const [name, ink] of Object.entries(ONE_INKS)) {
  const { INK } = WORDMARK;
  emit(
    `wordmark/wordmark-${name}.svg`,
    `${padded({ left: INK.LEFT, right: INK.RIGHT, top: INK.TOP, bottom: INK.BOTTOM })}<path d="${WORDMARK.PATH}" fill="${ink}"/></svg>`,
    PRODUCT_NAME,
  );
  for (const [cutName, cut] of LOGO_CUTS) {
    const { body, box } = cut(ink);
    emit(`logo/${cutName}-${name}.svg`, `${padded(box)}${body}</svg>`, PRODUCT_NAME);
  }
}
for (const [mode, { word, mark }] of Object.entries(COLOR_INKS)) {
  for (const [cutName, cut] of LOGO_CUTS) {
    const { body, box } = cut(word, mark);
    emit(`logo/${cutName}-color-${mode}.svg`, `${padded(box)}${body}</svg>`, PRODUCT_NAME);
  }
}

// The share of an app icon's tile the disc spans, in every app icon alike:
// the macOS icon, the web app icon, the favicon, and the avatar. Note that
// it is larger than a round glyph's usual half, because at half the mark
// stood small beside every other app's glyph in the Dock, and smaller than
// the 80% circle Android's maskable icon keeps, so no mask clips its rim.
const ICON_MARK = 0.78;

// App icon, one per mode, on Apple's macOS icon grid: an 824-unit tile with a
// 185.4-unit corner, centered on a 1024 canvas, the disc spanning ICON_MARK of
// the tile. The packaged `.icns` is cut from the dark set, and the running
// app swaps the Dock image between the two as the theme changes. Note that
// the Dock and the app switcher draw the whole canvas at one size, so a tile
// that filled it would stand a fifth larger than every other app's.
const ICON_GRID = { canvas: 1024, tile: 824, radius: 185.4 };
{
  const origin = (ICON_GRID.canvas - ICON_GRID.tile) / 2;
  const disc = ICON_GRID.tile * ICON_MARK;
  const at = (ICON_GRID.canvas - disc) / 2;
  for (const [mode, { tile, ink }] of Object.entries(TILES)) {
    emit(
      `icon/icon-${mode}.svg`,
      `${svgOpen(ICON_GRID.canvas, ICON_GRID.canvas)}<rect x="${origin}" y="${origin}" width="${ICON_GRID.tile}" height="${ICON_GRID.tile}" rx="${ICON_GRID.radius}" fill="${tile}"/>${markAt(at, at, disc, ink)}</svg>`,
      `${PRODUCT_NAME} app icon`,
    );
  }
}

// Web app icon: the dark mode's tile, full bleed, for the platform to round
// or mask itself, the disc spanning ICON_MARK of it. The site's
// apple-touch-icon and its manifest's icons, as is and maskable, are cut from
// it -- see packages/brand/README.md.
const WEB_ICON = { side: 100 };
{
  const { tile, ink } = TILES.dark;
  const disc = WEB_ICON.side * ICON_MARK;
  const at = (WEB_ICON.side - disc) / 2;
  emit(
    "icon/web-icon.svg",
    `${svgOpen(WEB_ICON.side, WEB_ICON.side)}<rect width="${WEB_ICON.side}" height="${WEB_ICON.side}" fill="${tile}"/>${markAt(at, at, disc, ink)}</svg>`,
    `${PRODUCT_NAME} app icon`,
  );
}

// Favicon: the dark mode's tile with no Dock margin, which reads as black in
// a light tab and a dark one alike, under the copper small cut, so the V
// still reads at 16 pixels, the disc spanning ICON_MARK of the tile. The site
// serves it as /favicon.svg, with /favicon.ico cut from it for readers that
// take no SVG -- see packages/brand/README.md.
const FAVICON = { side: 240, inset: 8, radius: 52 };
{
  const tile = FAVICON.side - FAVICON.inset * 2;
  const disc = tile * ICON_MARK;
  const at = (FAVICON.side - disc) / 2;
  emit(
    "icon/favicon.svg",
    `${svgOpen(FAVICON.side, FAVICON.side)}<rect x="${FAVICON.inset}" y="${FAVICON.inset}" width="${tile}" height="${tile}" rx="${FAVICON.radius}" fill="${TILES.dark.tile}"/>${markAt(at, at, disc, TILES.dark.ink, MARK.SMALL_PATH)}</svg>`,
    PRODUCT_NAME,
  );
}

// Mark: the disc alone on transparency with a twelfth of air on each side,
// in each mode's ink, in pure white, in each mode's copper as the color
// logos draw it, and in pure black, the one-ink glyph a partner surface tints
// for its own theme, such as an integration's icon on Sentry, which takes no
// color but black. The disc on a tile is the avatar, below.
const SQUARE = { side: 120, disc: 100 };
{
  const at = (SQUARE.side - SQUARE.disc) / 2;
  const open = svgOpen(SQUARE.side, SQUARE.side);
  for (const [name, ink] of [
    ...Object.entries(INKS),
    ["white", "#ffffff"],
    ["monochrome", "#000000"],
    ...Object.entries(COLOR_INKS).map(([mode, { mark }]) => [`color-${mode}`, mark]),
  ]) {
    emit(`mark/mark-${name}.svg`, `${open}${markAt(at, at, SQUARE.disc, ink)}</svg>`, PRODUCT_NAME);
  }
}

// Avatar: the disc on a square tile, per mode and on flat black, spanning
// ICON_MARK of it, as in the app icons, so the circle a profile photo is cut
// to (GitHub, X, Slack, LinkedIn) still leaves a ring of the tile round the
// rim, and a surface that rounds a square's corners itself (GitHub's
// organization avatar) clips nothing. Opaque tiles, because a profile photo
// rarely shows through.
const AVATAR = { side: 100, disc: 100 * ICON_MARK };
{
  const at = (AVATAR.side - AVATAR.disc) / 2;
  const open = svgOpen(AVATAR.side, AVATAR.side);
  for (const [mode, { tile, ink }] of Object.entries(TILES)) {
    emit(
      `avatar/avatar-${mode}.svg`,
      `${open}<rect width="${AVATAR.side}" height="${AVATAR.side}" fill="${tile}"/>${markAt(at, at, AVATAR.disc, ink)}</svg>`,
      PRODUCT_NAME,
    );
  }
  emit(
    "avatar/avatar-black.svg",
    `${open}<rect width="${AVATAR.side}" height="${AVATAR.side}" fill="#000000"/>${markAt(at, at, AVATAR.disc, "#ffffff")}</svg>`,
    PRODUCT_NAME,
  );
}

// Social card: the image the web pages' `og:image` points at, 1200 by 630,
// the one size every link unfurler draws whole. The lockup in the dark ink on
// the dark ground, 56% of the card wide, with air on every side because a 2:1
// crop takes the top and bottom edges. One card, dark only: a link preview
// follows no UI theme. Its PNG is cut into apps/web/public/.
const CARD = { WIDTH: 1200, HEIGHT: 630, FILL: 0.56 };
emit(
  "social/og-card.svg",
  `${svgOpen(CARD.WIDTH, CARD.HEIGHT)}<rect width="${CARD.WIDTH}" height="${CARD.HEIGHT}" fill="${BRAND.DARK.GROUND}"/>${centered(lockup(INKS.dark), CARD.WIDTH, CARD.HEIGHT, CARD.FILL)}</svg>`,
  PRODUCT_NAME,
);

// Banners: the lockup centered on a flat ground, for a profile's or a page's
// cover, drawn at least twice the size each asks for so it stays sharp on a
// dense screen: LinkedIn's profile background (1584 by 396), X's header
// (1500 by 500), a slide or a call's background at 16:9, LinkedIn's company
// page cover (4200 by 700, as LinkedIn asks for it), and a 9:2 strip for a
// sidebar's logo slot, such as Bookface's company card, which the lockup all
// but fills. The lockup spans FILL of the width, leaving the lower left clear
// on the covers where LinkedIn sets the photo or the page's logo over it.
// Three grounds: each mode's, and the light icon's copper tile under white.
const BANNER_GROUNDS = {
  dark: { ground: BRAND.DARK.GROUND, ink: INKS.dark },
  light: { ground: BRAND.LIGHT.GROUND, ink: INKS.light },
  copper: { ground: TILES.light.tile, ink: TILES.light.ink },
};
const BANNERS = {
  "4x1": { WIDTH: 3168, HEIGHT: 792, FILL: 0.5 },
  "3x1": { WIDTH: 3000, HEIGHT: 1000, FILL: 0.54 },
  "6x1": { WIDTH: 4200, HEIGHT: 700, FILL: 0.42 },
  "9x2": { WIDTH: 1800, HEIGHT: 400, FILL: 0.82 },
  "16x9": { WIDTH: 3840, HEIGHT: 2160, FILL: 0.56 },
};
for (const [shape, { WIDTH, HEIGHT, FILL }] of Object.entries(BANNERS)) {
  for (const [name, { ground, ink }] of Object.entries(BANNER_GROUNDS)) {
    emit(
      `banner/banner-${name}-${shape}.svg`,
      `${svgOpen(WIDTH, HEIGHT)}<rect width="${WIDTH}" height="${HEIGHT}" fill="${ground}"/>${centered(lockup(ink), WIDTH, HEIGHT, FILL)}</svg>`,
      PRODUCT_NAME,
    );
  }
}

// Dotted banners: the same covers drawn in the landing's dots
// (`@repo/ui`'s landing-wordmark.tsx and mark-orb.tsx): small square dots on a
// grid, each lit or not by an 8×8 ordered dither, so a cover reads as flat
// inks on its ground and never as a gradient. A colorway with more than one
// ink dithers between them as the landing's ball does, darkest to brightest,
// so a brighter stretch steps up through its inks rather than blending.
//
// Four designs: `hero` and `keel` draw the mark as the landing's ball, a
// disc lit from the upper left, in dots packed close, beside a name set to
// the left (`keel` huge and running off the right edge); `terrain` and
// `bloom` lay a field of noise round a centered name, kept clear inside an
// ellipse round the lockup and growing in past it, so it frames the name
// rather than boxing it. 9:2 is left out: its lockup all but fills it.
//
// Note that the map is the landing's own (`bayerAt` in src/dither.ts), so a
// banner and the site dither alike.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// A smooth step from 0 at `from` to 1 at `to`.
function smooth(from, to, v) {
  const t = clamp01((v - from) / (to - from));
  return t * t * (3 - 2 * t);
}

// A color between two #rrggbb colors, `share` of the way from `from`.
function mix(from, to, share) {
  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const [a, b] = [channels(from), channels(to)];
  const blend = a.map((v, n) => Math.round(v + (b[n] - v) * share));
  return `#${blend.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Value noise on a lattice hashed from its corners and a seed, between 0
// and 1, and its fractal sum over `octaves`, each finer and fainter. Seeded
// and pure, so the covers are the same on every run.
function lattice(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y, seed) {
  const [i, j] = [Math.floor(x), Math.floor(y)];
  const [u, v] = [smooth(0, 1, x - i), smooth(0, 1, y - j)];
  const [a, b] = [lattice(i, j, seed), lattice(i + 1, j, seed)];
  const [c, d] = [lattice(i, j + 1, seed), lattice(i + 1, j + 1, seed)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fractal(x, y, seed, octaves) {
  let [sum, weight, total, scale] = [0, 0.5, 0, 1];
  for (let octave = 0; octave < octaves; octave++) {
    sum += weight * noise(x * scale, y * scale, seed + octave * 17);
    total += weight;
    scale *= 2.03;
    weight *= 0.5;
  }
  return sum / total;
}

// The mark's outline flattened to rings of points on its 100-unit disc, and
// whether a point falls inside it (even-odd, as the island is a hole's
// hole). Its path is moves, lines, and cubics, absolute or relative.
function markRings(path) {
  const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  const rings = [];
  let [ring, x, y, command, at] = [[], 0, 0, "", 0];
  const take = (count) => {
    const values = tokens.slice(at, at + count).map(Number);
    at += count;
    return values;
  };
  while (at < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[at])) command = tokens[at++];
    const relative = command === command.toLowerCase();
    const [ox, oy] = relative ? [x, y] : [0, 0];
    const kind = command.toUpperCase();
    if (kind === "Z") {
      rings.push(ring);
      ring = [];
    } else if (kind === "M" || kind === "L") {
      const [nx, ny] = take(2);
      [x, y] = [ox + nx, oy + ny];
      ring.push([x, y]);
    } else if (kind === "C") {
      const [x1, y1, x2, y2, x3, y3] = take(6).map((v, n) => v + (n % 2 ? oy : ox));
      for (let step = 1; step <= 12; step++) {
        const t = step / 12;
        const s = 1 - t;
        const w = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
        ring.push([
          w[0] * x + w[1] * x1 + w[2] * x2 + w[3] * x3,
          w[0] * y + w[1] * y1 + w[2] * y2 + w[3] * y3,
        ]);
      }
      [x, y] = [x3, y3];
    } else {
      throw new Error(`The mark's path has a ${command}, which markRings does not draw`);
    }
  }
  return rings;
}
const MARK_RINGS = markRings(MARK.PATH);
function inMark(x, y) {
  let inside = false;
  for (const ring of MARK_RINGS) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [[xa, ya], [xb, yb]] = [ring[a], ring[b]];
      if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}

// The light on the ball at a point of the 100-unit disc, lit from the upper
// left as the landing's is: diffuse, a highlight, and a rim on the lit side.
const BALL_LIGHT = (() => {
  const light = [-0.5, -0.62, 0.6];
  const length = Math.hypot(...light);
  return light.map((v) => v / length);
})();
function ballLight(mx, my) {
  const [dx, dy] = [(mx - 50) / 50, (my - 50) / 50];
  const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const diffuse = Math.max(0, dx * BALL_LIGHT[0] + dy * BALL_LIGHT[1] + nz * BALL_LIGHT[2]);
  const rim = (1 - nz) ** 4 * 0.5 * smooth(-0.2, 0.8, dx + dy);
  return clamp01(0.06 + 0.82 * diffuse ** 1.4 + 0.6 * diffuse ** 24 + rim);
}

// The mark as the ball, `side` across with its corner at (left, top): its
// light at (x, y), or nothing outside it.
function markBall(x, y, { left, top, side }) {
  const [mx, my] = [((x - left) / side) * 100, ((y - top) / side) * 100];
  if (mx < 0 || mx > 100 || my < 0 || my > 100 || !inMark(mx, my)) return 0;
  return ballLight(mx, my);
}

// How far into the field (x, y) stands from the lockup's box: 0 inside
// CLEAR of the ellipse the box spans, 1 past CLEAR + RAMP of it.
const FIELD_CLEAR = { CLEAR: 1.15, RAMP: 1.1 };
function clearOf(box, x, y) {
  const away = Math.hypot(
    (x - (box.left + box.right) / 2) / ((box.right - box.left) / 2),
    (y - (box.top + box.bottom) / 2) / ((box.bottom - box.top) / 2),
  );
  return smooth(FIELD_CLEAR.CLEAR, FIELD_CLEAR.CLEAR + FIELD_CLEAR.RAMP, away);
}

// The designs. A design names where its lockup stands (`ALIGN`), whether it
// draws a lit body rather than a field (`BODY`, packed close in its own
// cell), and its value between 0 and 1 at a point of the cut, given the
// cover, the lockup's placed box, and `landing`, the cut's pixels in the
// landing's CSS pixels, so a field has as many dots across as the site's.
const DOT_DESIGNS = {
  hero: {
    ALIGN: "left",
    BODY: true,
    value: (x, y, { WIDTH, HEIGHT }, box) => {
      const side = Math.min(HEIGHT * 0.78, WIDTH * 0.36);
      const center = Math.max(WIDTH * 0.79, box.right + WIDTH * 0.04 + side / 2);
      return markBall(x, y, { left: center - side / 2, top: (HEIGHT - side) / 2, side });
    },
  },
  keel: {
    ALIGN: "left",
    BODY: true,
    value: (x, y, { WIDTH, HEIGHT }, box) => {
      const side = Math.min(HEIGHT * 1.6, WIDTH * 0.6);
      const left = Math.max(WIDTH - side * 0.8, box.right + WIDTH * 0.04);
      return markBall(x, y, { left, top: HEIGHT / 2 - side * 0.46, side });
    },
  },
  // Patches of noise whose lattice is itself bent by noise, so its edges
  // wander as weather on a map does, and nothing repeats.
  terrain: {
    ALIGN: "center",
    value: (x, y, _cover, box, landing) => {
      const [u, v] = [(x * landing) / 280, (y * landing) / 280];
      const bendX = fractal(u + 3.1, v + 1.7, 7, 3);
      const bendY = fractal(u - 2.3, v + 4.1, 9, 3);
      const height = fractal(u + bendX * 1.8, v + bendY * 1.8, 3, 5);
      return clearOf(box, x, y) * smooth(0.34, 0.74, height);
    },
  },
  // Dots blooming in from the top right and the bottom left, their edges
  // broken by noise.
  bloom: {
    ALIGN: "center",
    value: (x, y, { WIDTH, HEIGHT }, box, landing) => {
      const grain = fractal((x * landing) / 150, (y * landing) / 150, 11, 4);
      const right = Math.hypot((x - WIDTH) / (WIDTH * 0.45), y / (HEIGHT * 1.1));
      const left = Math.hypot(x / (WIDTH * 0.38), (y - HEIGHT) / HEIGHT);
      const reach = Math.max(1 - right, 0.85 * (1 - left)) + (grain - 0.5) * 0.55;
      return clearOf(box, x, y) * smooth(0, 0.8, reach);
    },
  },
};

// The colorways: a ground, the inks its dots step through from darkest to
// brightest, and the name's ink and the mark's. Every ink is the brand
// table's, or a mix of two of its values as the landing's ball mixes its
// deep copper. On a light ground (`LIGHT`) the ball is drawn in its shadow,
// so its light reads as the ground.
const DEEP_COPPER = mix(BRAND.DARK.GROUND, BRAND.DARK.ACCENT, 0.45);
const DOT_COLORWAYS = {
  night: {
    GROUND: BRAND.DARK.GROUND,
    DOTS: [BRAND.DARK.ACCENT],
    WORD: INKS.dark,
    MARK: INKS.dark,
  },
  ember: {
    GROUND: BRAND.DARK.GROUND,
    DOTS: [
      DEEP_COPPER,
      BRAND.DARK.ACCENT,
      BRAND.DARK.ACCENT_TEXT,
      mix(BRAND.DARK.ACCENT_TEXT, BRAND.DARK.INK, 0.6),
    ],
    WORD: INKS.dark,
    MARK: BRAND.DARK.ACCENT_TEXT,
  },
  chrome: {
    GROUND: BRAND.DARK.GROUND,
    DOTS: [BRAND.DARK.CHIP_EDGE_STRONG, BRAND.DARK.TEXT_MUTED, BRAND.DARK.TEXT_BODY],
    WORD: INKS.dark,
    MARK: BRAND.DARK.ACCENT,
  },
  graphite: {
    GROUND: BRAND.DARK.SIDEBAR,
    DOTS: [BRAND.DARK.CHIP_EDGE_STRONG, BRAND.DARK.TEXT_MUTED],
    WORD: INKS.dark,
    MARK: BRAND.DARK.ACCENT,
  },
  rust: {
    GROUND: mix(BRAND.DARK.GROUND, BRAND.DARK.ACCENT, 0.16),
    DOTS: [DEEP_COPPER, BRAND.DARK.ACCENT, BRAND.DARK.ACCENT_TEXT],
    WORD: INKS.dark,
    MARK: BRAND.DARK.ACCENT_TEXT,
  },
  paper: {
    GROUND: BRAND.LIGHT.GROUND,
    DOTS: [
      mix(BRAND.LIGHT.GROUND, BRAND.LIGHT.ACCENT, 0.4),
      BRAND.LIGHT.ACCENT,
      mix(BRAND.LIGHT.ACCENT, BRAND.LIGHT.INK, 0.45),
    ],
    WORD: INKS.light,
    MARK: BRAND.LIGHT.ACCENT,
    LIGHT: true,
  },
  ink: {
    GROUND: BRAND.LIGHT.GROUND,
    DOTS: [BRAND.LIGHT.CHIP_EDGE_STRONG, BRAND.LIGHT.TEXT_MUTED, BRAND.LIGHT.TEXT_BODY],
    WORD: INKS.light,
    MARK: BRAND.LIGHT.ACCENT,
    LIGHT: true,
  },
  sand: {
    GROUND: BRAND.LIGHT.SIDEBAR,
    DOTS: [mix(BRAND.LIGHT.SIDEBAR, BRAND.LIGHT.ACCENT, 0.4), BRAND.LIGHT.ACCENT],
    WORD: INKS.light,
    MARK: BRAND.LIGHT.ACCENT,
    LIGHT: true,
  },
  copper: {
    GROUND: BRAND.LIGHT.ACCENT,
    DOTS: [BRAND.DARK.ACCENT_TEXT],
    WORD: BRAND.LIGHT.ON_ACCENT,
    MARK: BRAND.LIGHT.ON_ACCENT,
  },
  kiln: {
    GROUND: BRAND.LIGHT.ACCENT,
    DOTS: [BRAND.DARK.ACCENT, BRAND.DARK.ACCENT_TEXT, BRAND.LIGHT.GROUND],
    WORD: BRAND.LIGHT.ON_ACCENT,
    MARK: BRAND.LIGHT.ON_ACCENT,
  },
  mono: {
    GROUND: "#000000",
    DOTS: ["#ffffff"],
    WORD: "#ffffff",
    MARK: "#ffffff",
  },
};

// Each dotted cover's cut and the lockup's share of its width when
// centered, as the flat covers'; where a left-set lockup's edge stands, as a
// share of the width (past the photo LinkedIn sets over a cover's lower
// left); and its cells in the cut's pixels: a field's, sized so its dots
// stand about the landing's seven CSS pixels apart where the platform draws
// the cover, and a body's, finer.
const DOT_BANNERS = {
  "4x1": { ...BANNERS["4x1"], LEFT: 0.28, CELL: 14, BODY_CELL: 9 },
  "3x1": { ...BANNERS["3x1"], LEFT: 0.075, CELL: 14, BODY_CELL: 9 },
  "6x1": { ...BANNERS["6x1"], LEFT: 0.3, CELL: 24, BODY_CELL: 12 },
  "16x9": { ...BANNERS["16x9"], LEFT: 0.075, CELL: 16, BODY_CELL: 10 },
};
// A left-set lockup's share of the width; how much of its cell a field's dot
// fills, and a body's; and the landing's cell in its CSS pixels.
const DOT = { LEFT_FILL: 0.4, SHARE: 0.46, BODY_SHARE: 0.86, LANDING_CELL: 7 };

// The dots of a cover in a design and a colorway round the lockup's placed
// box, one path per ink. Each dot is a relative move from the last, so a
// path of thousands stays small.
function dotCover(design, colorway, cover, box) {
  const { DOTS, LIGHT } = colorway;
  const cell = design.BODY ? cover.BODY_CELL : cover.CELL;
  const side = Math.round(cell * (design.BODY ? DOT.BODY_SHARE : DOT.SHARE));
  const landing = DOT.LANDING_CELL / cover.CELL;
  const paths = DOTS.map(() => ({ d: "", x: 0, y: 0 }));
  for (let j = 0, y = cell / 2; y < cover.HEIGHT; y += cell, j++) {
    for (let i = 0, x = cell / 2; x < cover.WIDTH; x += cell, i++) {
      const lit = design.value(x, y, cover, box, landing);
      if (lit <= 0) continue;
      const value = design.BODY && LIGHT ? clamp01(1.1 - lit) : lit;
      // Note that the ink is picked by the same threshold that lights the
      // cell, so a value between two inks dithers between them, flatly.
      const ink = Math.min(DOTS.length, Math.floor(value * DOTS.length + bayerAt(i, j)));
      if (ink === 0) continue;
      const path = paths[ink - 1];
      const [at, to] = [Math.round(x - side / 2), Math.round(y - side / 2)];
      path.d += `${path.d ? "m" : "M"}${at - path.x} ${to - path.y}h${side}v${side}h-${side}z`;
      [path.x, path.y] = [at, to];
    }
  }
  return paths.map(({ d }, n) => (d ? `<path d="${d}" fill="${DOTS[n]}"/>` : "")).join("");
}

for (const [shape, cover] of Object.entries(DOT_BANNERS)) {
  const { WIDTH, HEIGHT } = cover;
  for (const [designName, design] of Object.entries(DOT_DESIGNS)) {
    for (const [name, colorway] of Object.entries(DOT_COLORWAYS)) {
      const cut = lockup(colorway.WORD, colorway.MARK);
      const { k, tx, ty, box } =
        design.ALIGN === "left"
          ? placement(cut.box, WIDTH, HEIGHT, DOT.LEFT_FILL, cover.LEFT)
          : placement(cut.box, WIDTH, HEIGHT, cover.FILL);
      emit(
        `banner/dots/banner-dots-${designName}-${name}-${shape}.svg`,
        `${svgOpen(WIDTH, HEIGHT)}<rect width="${WIDTH}" height="${HEIGHT}" fill="${colorway.GROUND}"/>${dotCover(design, colorway, cover, box)}<g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(k)})">${cut.body}</g></svg>`,
        PRODUCT_NAME,
      );
    }
  }
}

// CTA button: a download link drawn as the site's own primary button, for a
// page that links the download: the accent's fill under its own words, per
// mode. An SVG served as an image reaches no stylesheet, so the values are
// the brand table's, the 0.5rem radius, and the 14px/600 label, forced to its
// designed advance with textLength because the button renders on machines
// without Geist.
const CTA = {
  HEIGHT: 44,
  RADIUS: 8,
  PAD_X: 24,
  FONT: "'Geist Variable', -apple-system, blinkmacsystemfont, 'Segoe UI', sans-serif",
  FONT_SIZE: 14,
  WEIGHT: 600,
};
const CTA_INKS = {
  light: { fill: BRAND.LIGHT.ACCENT, ink: BRAND.LIGHT.ON_ACCENT },
  dark: { fill: BRAND.DARK.ACCENT, ink: BRAND.DARK.ON_ACCENT },
};
const CTA_BUTTONS = [
  {
    name: "download",
    label: "Download for macOS",
    advance: 133,
    title: `Download ${PRODUCT_NAME} for macOS`,
  },
];
for (const { name, label, advance, title } of CTA_BUTTONS) {
  const width = advance + 2 * CTA.PAD_X;
  for (const [mode, inks] of Object.entries(CTA_INKS)) {
    const ground = `<rect width="${width}" height="${CTA.HEIGHT}" rx="${CTA.RADIUS}" fill="${inks.fill}"/>`;
    const text =
      `<text x="${fmt(width / 2)}" y="${fmt(CTA.HEIGHT / 2)}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="${CTA.FONT}" font-size="${CTA.FONT_SIZE}" font-weight="${CTA.WEIGHT}" ` +
      `textLength="${advance}" fill="${inks.ink}">${label}</text>`;
    // Sized explicitly: an <img> gives a viewBox-only SVG no intrinsic size.
    const open =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CTA.HEIGHT}" ` +
      `viewBox="0 0 ${width} ${CTA.HEIGHT}" fill="none">`;
    emit(`button/cta-${name}-${mode}.svg`, `${open}${ground}${text}</svg>`, title);
  }
}

// DMG background: the light ground with one round-ended arrow from the app to
// Applications, the shared window geometry keeping it centered between them.
const dmgBackground = DMG_WINDOW.BACKGROUND.PNG;
const arrowY = DMG_WINDOW.POSITIONS.APP.Y;
const arrowStart = DMG_WINDOW.POSITIONS.APP.X + DMG_WINDOW.ICON_SIZE;
const arrowEnd = DMG_WINDOW.POSITIONS.APPLICATIONS.X - DMG_WINDOW.ICON_SIZE;
const arrowHead = 28;
emit(
  "dmg/dmg-background.svg",
  `${svgOpen(dmgBackground.WIDTH, dmgBackground.HEIGHT)}` +
    `<rect width="${dmgBackground.WIDTH}" height="${dmgBackground.HEIGHT}" fill="${BRAND.LIGHT.SIDEBAR}"/>` +
    `<path d="M ${arrowStart} ${arrowY} H ${arrowEnd} M ${arrowEnd - arrowHead} ${arrowY - arrowHead} L ${arrowEnd} ${arrowY} L ${arrowEnd - arrowHead} ${arrowY + arrowHead}" ` +
    `fill="none" stroke="${BRAND.LIGHT.TEXT_MUTED}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  `Drag ${PRODUCT_NAME} to Applications`,
);

// A string property as Biome formats it, since the file is committed and
// linted and the two must agree exactly: on its key's line where it fits the
// 100-column width or the key is short (four characters or fewer, which
// Biome never breaks after), and on the next line where it is neither.
function tsEntry(key, value) {
  const line = `  ${key}: "${value}",`;
  return line.length <= 100 || key.length <= 4 ? line : `  ${key}:\n    "${value}",`;
}

// The mark's geometry, for @repo/ui's ProductMark to draw from, and the
// wordmark's, for the landing's footer.
put(
  join(SURFACE, "mark-art.ts"),
  `// Generated by packages/brand/scripts/generate-brand-assets.mjs. Do not edit by hand: change
// the mark in that script and re-run it.
//
// The product's mark, drawn in one color on a 100-unit disc: the regular cut,
// and the small one a 32-pixel mark or smaller draws.

export const MARK_ART = {
  VIEW_BOX: "${MARK.VIEW_BOX}",
${tsEntry("PATH", MARK.PATH)}
${tsEntry("SMALL_PATH", MARK.SMALL_PATH)}
} as const;

// The wordmark's outline in the type's units, its baseline at y 0, and the
// box its ink fills, with no room around it.

export const WORDMARK_ART = {
  VIEW_BOX: "${[WORDMARK.INK.LEFT, WORDMARK.INK.TOP, fmt(WORDMARK.INK.RIGHT - WORDMARK.INK.LEFT), WORDMARK.INK.BOTTOM - WORDMARK.INK.TOP].join(" ")}",
${tsEntry("PATH", WORDMARK.PATH)}
} as const;
`,
);

if (!CHECK_ONLY) {
  process.stdout.write(
    `${written.length} SVGs written to packages/brand/assets/, and mark-art.ts\n`,
  );
} else if (stale.length > 0) {
  process.stderr.write(
    `${stale.length} generated file(s) no longer match this script:\n${stale.join("\n")}\n` +
      "Run: node packages/brand/scripts/generate-brand-assets.mjs\n",
  );
  process.exit(1);
} else {
  process.stdout.write(`${written.length + 1} generated files are up to date\n`);
}
