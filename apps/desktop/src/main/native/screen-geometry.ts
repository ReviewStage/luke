import type { NativeNotchGeometry } from "@sidecar/surface";
import { isWireNumber, type UnparsedWireValue, wireRecord } from "@sidecar/wire";
import { nativeHelperLines } from "./native-helper";

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

async function probeMacScreenGeometry(): Promise<Map<number, NativeNotchGeometry>> {
  if (process.platform !== "darwin") return new Map();

  try {
    const output = await nativeHelperLines("mac-screen-geometry", 2_000);
    const decoded = JSON.parse(output.join("\n"));
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

/**
 * One read at a time, shared: callers arriving during a read take that read's
 * answer rather than starting another, and the next caller after it settles
 * probes again. Every caller here is a display or power event that reconciles
 * the panels again anyway, so the worst a shared answer costs is a snapshot
 * one event stale, immediately superseded.
 */
export function sharedInFlight<T>(read: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    inFlight ??= read().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

export const readMacScreenGeometry = sharedInFlight(probeMacScreenGeometry);
