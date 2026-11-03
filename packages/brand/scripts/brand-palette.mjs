// brand-palette.mjs -- the brand's colors, the one table both generators read.
//
// generate-surface-shared.mjs writes these onto @repo/ui's roles (brand.css)
// and as plain values (BRAND_PALETTE); generate-brand-assets.mjs draws the
// icons, the cards, and the buttons in them.

// The brand's colors: every --ui-color-* role a change of brand changes,
// in the light theme and the dark, for the desktop and the site alike. The
// roles a brand leaves alone (the fills and edges drawn as alphas of the ink,
// shadows, the identity and chart hues, find's yellows) stay in @repo/ui's
// palettes.css. Each entry is one brand; `BRAND` names the one the product
// wears, so a rebrand is a new entry and that one name, and a second theme
// is a second entry the generator writes under a selector of its own.
//
// Copper: warm graphite neutrals and one copper accent at 60 degrees of
// OKLCH hue, held there in the dark rather than lightened toward peach. Every
// ink holds its contrast pair on the grounds it is drawn on, which
// @repo/ui's brand-contrast.test.ts asserts.
//
// Note that there is one copper, and it means you: the brand, what you can
// act on, and what waits on you (attention) are the same ink, so attention
// names the accent's values rather than a second copper a step away. Work
// under way is the one status that would otherwise share it, so it is a blue
// of its own at 250 degrees, at the other status inks' lightness, and a
// running agent reads apart from one that needs you.
const COPPER = {
  LIGHT: { FILL: "#a7611b", INK: "#8e5323" },
  DARK: { FILL: "#cf7b26", INK: "#f19a4b" },
};

export const BRAND_PALETTES = {
  COPPER: {
    LIGHT: {
      GROUND: "#fffcfa",
      SURFACE: "#ffffff",
      OVERLAY: "#ffffff",
      SIDEBAR: "#f5f2f0",
      SIDEBAR_INK: "#575553",
      WELL: "#f9f6f4",
      CODE_GROUND: "#ffffff",
      CHIP: "#ffffff",
      CHIP_HOVER: "#f8f5f3",
      CHIP_SELECTED: "#f0edeb",
      CHIP_EDGE: "#e1dedc",
      CHIP_EDGE_STRONG: "#b1aeac",
      INK: "#080706",
      TEXT: "#171614",
      TEXT_BODY: "#282624",
      TEXT_MUTED: "#64615f",
      ACCENT: COPPER.LIGHT.FILL,
      ON_ACCENT: "#ffffff",
      ON_ACCENT_MUTED: "#ffffff",
      ACCENT_TEXT: COPPER.LIGHT.INK,
      FOCUS_RING: COPPER.LIGHT.FILL,
      SWITCH_ON: COPPER.LIGHT.FILL,
      DANGER: "#e23242",
      DANGER_TEXT: "#b42e36",
      DANGER_FILL: "#db3643",
      ATTENTION: COPPER.LIGHT.INK,
      ATTENTION_FILL: COPPER.LIGHT.FILL,
      WORKING: "#1666aa",
      COMPLETE: "#067040",
      MERGED: "#744caf",
    },
    DARK: {
      GROUND: "#0f0d0b",
      SURFACE: "#120f0d",
      OVERLAY: "#171412",
      SIDEBAR: "#060504",
      SIDEBAR_INK: "#a5a19e",
      WELL: "#090706",
      CODE_GROUND: "#090706",
      CHIP: "#181513",
      CHIP_HOVER: "#1f1c1a",
      CHIP_SELECTED: "#262321",
      CHIP_EDGE: "#221f1d",
      CHIP_EDGE_STRONG: "#383532",
      INK: "#fffdfc",
      TEXT: "#f4f1ef",
      TEXT_BODY: "#e0dddb",
      TEXT_MUTED: "#96918d",
      ACCENT: COPPER.DARK.FILL,
      ON_ACCENT: "#120f0d",
      ON_ACCENT_MUTED: "#120f0d",
      ACCENT_TEXT: COPPER.DARK.INK,
      FOCUS_RING: COPPER.DARK.FILL,
      SWITCH_ON: COPPER.DARK.FILL,
      DANGER: "#fb817f",
      DANGER_TEXT: "#fe908d",
      DANGER_FILL: "#db3643",
      ATTENTION: COPPER.DARK.INK,
      // White words sit on attention's fill in either theme, and the dark
      // accent is too light to hold them, so the fill is the light one.
      ATTENTION_FILL: COPPER.LIGHT.FILL,
      WORKING: "#76bafe",
      COMPLETE: "#56d089",
      MERGED: "#c29fff",
    },
  },
};
export const BRAND = BRAND_PALETTES.COPPER;
