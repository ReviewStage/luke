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

type GeometryRead = () => Promise<Map<number, NativeNotchGeometry>>;

/**
 * Coalesces refresh bursts without allowing an older probe to become visible.
 * Callers that arrive during a probe join the same wait and request one newer
 * snapshot; only a probe with no newer request behind it resolves the waiters.
 */
export function createCoalescedScreenGeometryReader(readSnapshot: GeometryRead): GeometryRead {
  let reading = false;
  let newerSnapshotRequested = false;
  let waiters: Array<{
    resolve: (screens: Map<number, NativeNotchGeometry>) => void;
    reject: (error: Error) => void;
  }> = [];

  const drain = async (): Promise<void> => {
    reading = true;
    try {
      while (waiters.length > 0) {
        newerSnapshotRequested = false;
        let screens: Map<number, NativeNotchGeometry>;
        try {
          screens = await readSnapshot();
        } catch (error) {
          const failure = error instanceof Error ? error : new Error("Screen geometry read failed");
          const failed = waiters;
          waiters = [];
          for (const waiter of failed) waiter.reject(failure);
          return;
        }

        if (newerSnapshotRequested) continue;

        const ready = waiters;
        waiters = [];
        for (const waiter of ready) waiter.resolve(screens);
      }
    } finally {
      reading = false;
    }
  };

  return () => {
    newerSnapshotRequested = true;
    const result = new Promise<Map<number, NativeNotchGeometry>>((resolve, reject) => {
      waiters.push({ resolve, reject });
    });
    if (!reading) void drain();
    return result;
  };
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

const readCoalescedMacScreenGeometry = createCoalescedScreenGeometryReader(probeMacScreenGeometry);

export function readMacScreenGeometry(): Promise<Map<number, NativeNotchGeometry>> {
  return readCoalescedMacScreenGeometry();
}
