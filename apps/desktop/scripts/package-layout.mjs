import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a native source and the binary it
 * becomes: the build compiles this list and packaging ships it, so a helper
 * cannot be built without reaching the bundle or shipped without being built.
 * Swift sources become standalone executables the app spawns; the `.m` source
 * becomes a Node-API addon the main process loads, because it works on the
 * app's own windows and so has to run inside the app's process.
 */
export const NATIVE_HELPERS = [
  {
    source: "AppleCalendar.swift",
    // "Luke", not mac-apple-calendar: the consent dialog falls back to the
    // process name where it cannot resolve a display name, and the process
    // name is this filename — every string macOS might pick must say Luke.
    binary: "Luke",
    frameworks: ["AppKit", "EventKit"],
    // The helper answers to TCC as itself — it re-execs disclaimed — so the
    // consent dialog and the grant are judged against the helper's own
    // identity, whatever launched Luke. That identity is a minimal app
    // bundle rather than a bare binary, because a bundle is what carries the
    // display name, icon, and usage sentences the dialog and the System
    // Settings row draw from — and the folder is named Luke.app too, the
    // way Chromium names its helper bundles, because a name resolution that
    // falls all the way back lands on the folder's own basename.
    bundle: "Luke.app",
  },
  { source: "MediaDuck.swift", binary: "mac-media-duck", frameworks: ["AppKit"] },
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
  },
  { source: "OutputVolume.swift", binary: "mac-output-volume", frameworks: ["CoreAudio"] },
  { source: "ScreenGeometry.swift", binary: "mac-screen-geometry", frameworks: ["AppKit"] },
  {
    source: "TalkKey.swift",
    binary: "mac-talk-key",
    frameworks: ["AppKit", "Carbon"],
  },
  {
    source: "StationaryWindow.m",
    binary: "mac-stationary-window.node",
    frameworks: ["AppKit"],
  },
];

export function packagedAppPath(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(repoRoot, "artifacts", "release-builder", `mac-${architecture}`, "Luke.app");
}

export function packagedAppExecutable(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(packagedAppPath(repoRoot, architecture), "Contents", "MacOS", "Luke");
}
