import { execFileSync } from "node:child_process";
import path from "node:path";
import type { NativeNotchGeometry } from "@sidecar/core";
import { app } from "electron";

function helperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mac-screen-geometry");
  }
  return path.join(app.getAppPath(), ".build", "native", "mac-screen-geometry");
}

function isNativeGeometry(value: unknown): value is NativeNotchGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as Record<string, unknown>;
  return (
    typeof geometry.displayId === "number" &&
    typeof geometry.safeAreaTop === "number" &&
    typeof geometry.notchWidth === "number" &&
    typeof geometry.hasNotch === "boolean"
  );
}

export function readMacScreenGeometry(): Map<number, NativeNotchGeometry> {
  if (process.platform !== "darwin") return new Map();

  try {
    const output = execFileSync(helperPath(), [], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const decoded: unknown = JSON.parse(output);
    if (!Array.isArray(decoded)) return new Map();
    return new Map(
      decoded.filter(isNativeGeometry).map((geometry) => [geometry.displayId, geometry]),
    );
  } catch (error) {
    console.warn("AppKit notch geometry unavailable; using work-area fallback", error);
    return new Map();
  }
}
