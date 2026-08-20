import { execFileSync } from "node:child_process";
import path from "node:path";
import type { NativeNotchGeometry } from "@sidecar/surface";
import { isWireNumber, type UnparsedWireValue, wireRecord } from "@sidecar/wire";
import { app } from "electron";

function helperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mac-screen-geometry");
  }
  return path.join(app.getAppPath(), ".build", "native", "mac-screen-geometry");
}

function parseNativeGeometry(value: UnparsedWireValue): NativeNotchGeometry | undefined {
  const record = wireRecord(value);
  if (!record) return undefined;
  const geometry = record;
  if (
    !isWireNumber(geometry.displayId) ||
    !isWireNumber(geometry.safeAreaTop) ||
    (geometry.menuBarHeight !== undefined && !isWireNumber(geometry.menuBarHeight)) ||
    !isWireNumber(geometry.notchWidth) ||
    (geometry.hasNotch !== true && geometry.hasNotch !== false)
  ) {
    return undefined;
  }
  const parsed: NativeNotchGeometry = {
    displayId: geometry.displayId,
    safeAreaTop: geometry.safeAreaTop,
    notchWidth: geometry.notchWidth,
    hasNotch: geometry.hasNotch,
  };
  if (geometry.menuBarHeight !== undefined) {
    parsed.menuBarHeight = geometry.menuBarHeight;
  }
  return parsed;
}

export function readMacScreenGeometry(): Map<number, NativeNotchGeometry> {
  if (process.platform !== "darwin") return new Map();

  try {
    const output = execFileSync(helperPath(), [], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const decoded = JSON.parse(output);
    if (!Array.isArray(decoded)) return new Map();
    return new Map(
      decoded
        .filter((entry): entry is NativeNotchGeometry => parseNativeGeometry(entry) !== undefined)
        .map((geometry) => [geometry.displayId, geometry]),
    );
  } catch (error) {
    console.warn("AppKit notch geometry unavailable; using work-area fallback", error);
    return new Map();
  }
}
