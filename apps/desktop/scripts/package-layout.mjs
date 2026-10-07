import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a native source and the binary it
 * becomes: the build compiles this list and packaging ships it, so a helper
 * cannot be built without reaching the bundle or shipped without being built.
 * Each Swift source becomes a standalone executable the app spawns.
 */
export const NATIVE_HELPERS = [
  { source: "MediaDuck.swift", binary: "mac-media-duck", frameworks: ["AppKit"] },
  {
    source: "MicrophoneRoute.swift",
    binary: "mac-microphone-route",
    frameworks: ["CoreAudio", "IOKit"],
  },
  { source: "OutputVolume.swift", binary: "mac-output-volume", frameworks: ["CoreAudio"] },
  {
    source: "TalkKey.swift",
    binary: "mac-talk-key",
    frameworks: ["AppKit", "Carbon"],
  },
];

export function packagedAppPath(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(repoRoot, "artifacts", "release-builder", `mac-${architecture}`, "Luke.app");
}

export function packagedAppExecutable(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(packagedAppPath(repoRoot, architecture), "Contents", "MacOS", "Luke");
}
