import { createRequire } from "node:module";
import type { BrowserWindow } from "electron";
import { nativeHelperPath } from "./native-helper";

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

export function layLiquidGlass(window: BrowserWindow): boolean {
  const glass = loadedAddon();
  if (glass === null || window.isDestroyed()) return false;
  try {
    return glass.addView(window.getNativeWindowHandle(), {}) >= 0;
  } catch {
    return false;
  }
}
