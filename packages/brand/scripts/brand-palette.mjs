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
      ACCENT: "#a7611b",
      ON_ACCENT: "#ffffff",
      ON_ACCENT_MUTED: "#ffffff",
      ACCENT_TEXT: "#8e5323",
      FOCUS_RING: "#a7611b",
      SWITCH_ON: "#a7611b",
      DANGER: "#e23242",
      DANGER_TEXT: "#b42e36",
      DANGER_FILL: "#db3643",
      ATTENTION: "#925103",
      ATTENTION_FILL: "#b16203",
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
      ACCENT: "#cf7b26",
      ON_ACCENT: "#120f0d",
      ON_ACCENT_MUTED: "#120f0d",
      ACCENT_TEXT: "#f19a4b",
      FOCUS_RING: "#cf7b26",
      SWITCH_ON: "#cf7b26",
      DANGER: "#fb817f",
      DANGER_TEXT: "#fe908d",
      DANGER_FILL: "#db3643",
      ATTENTION: "#fd9836",
      ATTENTION_FILL: "#b16203",
      COMPLETE: "#56d089",
      MERGED: "#c29fff",
    },
  },
};
export const BRAND = BRAND_PALETTES.COPPER;
