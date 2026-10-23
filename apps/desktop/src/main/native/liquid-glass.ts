import { createRequire } from "node:module";
import type { BrowserWindow } from "electron";
import { nativeHelperPath } from "./native-helper";

/**
 * liquid-glass.ts -- lays macOS 26's Liquid Glass behind a window, through `electron-liquid-glass`'s prebuilt addon.
 *
 * The addon (`scripts/package-layout.mjs`'s `LIQUID_GLASS_ADDON`) inserts an
 * `NSGlassEffectView` behind the window's web contents. Only its documented
 * `addView` is called: the package's `unstable_*` setters reach private
 * AppKit API and are left alone. Its own JavaScript is not loaded, because
 * it resolves the addon through a module it does not declare and asks
 * `sw_vers` on the main thread; the window's material is decided by
 * `../window/window-material.ts` instead. A load or an `addView` that fails
 * answers false, and the caller falls back to the sidebar's vibrancy.
 */

/** The addon's one class, as `electron-liquid-glass`'s `liquidglass.cc` defines it. */
interface LiquidGlassAddon {
  LiquidGlassNative: new () => {
    addView(
      handle: Buffer,
      options: { cornerRadius?: number; tintColor?: string; opaque?: boolean },
    ): number;
  };
}

const ADDON_FILE = "liquid-glass.node";

let addon: InstanceType<LiquidGlassAddon["LiquidGlassNative"]> | null | undefined;

/** The addon, loaded once; null where it cannot be. */
function loadedAddon(): InstanceType<LiquidGlassAddon["LiquidGlassNative"]> | null {
  if (addon !== undefined) return addon;
  try {
    const loaded: LiquidGlassAddon = createRequire(__filename)(nativeHelperPath(ADDON_FILE));
    addon = new loaded.LiquidGlassNative();
  } catch {
    addon = null;
  }
  return addon;
}

/** Lays Liquid Glass behind `window`'s page; false where it could not be laid. */
export function layLiquidGlass(window: BrowserWindow): boolean {
  const glass = loadedAddon();
  if (glass === null || window.isDestroyed()) return false;
  try {
    return glass.addView(window.getNativeWindowHandle(), {}) >= 0;
  } catch {
    return false;
  }
}
