/**
 * window-material.ts -- which native material the panel window is drawn on: macOS 26's Liquid Glass where the Mac has it, the sidebar's vibrancy before.
 *
 * Liquid Glass is laid behind the page once it has loaded
 * (`../native/liquid-glass.ts`), and needs the window transparent and
 * free of Electron's own vibrancy, which would cover it. A Mac before 26
 * has no glass, so the window keeps the sidebar material, which follows the
 * window's appearance and Reduce transparency by itself.
 */

/** The first macOS release that draws Liquid Glass (Tahoe). */
const LIQUID_GLASS_SINCE = 26;

export const WINDOW_MATERIAL = {
  LIQUID_GLASS: "liquid-glass",
  SIDEBAR: "sidebar",
} as const;

export type WindowMaterial = (typeof WINDOW_MATERIAL)[keyof typeof WINDOW_MATERIAL];

/** The material a Mac at `systemVersion` (`process.getSystemVersion()`, such as "26.1") draws the window on. */
export function windowMaterialFor(systemVersion: string): WindowMaterial {
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major >= LIQUID_GLASS_SINCE
    ? WINDOW_MATERIAL.LIQUID_GLASS
    : WINDOW_MATERIAL.SIDEBAR;
}
