import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

/**
 * The native helpers, named once. Each is a native source and the binary it
 * becomes: the build compiles this list and the packager ships it, so a helper
 * cannot be built without reaching the bundle or shipped without being built.
 * Swift sources become standalone executables the app spawns; the `.m` source
 * becomes a Node-API addon the main process loads, because it works on the
 * app's own windows and so has to run inside the app's process.
 */
export const NATIVE_HELPERS = [
  { source: "MediaDuck.swift", binary: "mac-media-duck", frameworks: ["AppKit"] },
  // CoreAudio for the processes holding the input device and whether each is
  // running it; AppKit for the one thing CoreAudio will not answer, which is
  // what a developer would recognise those processes by. It never opens a
  // stream.
  {
    source: "MicrophoneUse.swift",
    binary: "mac-microphone-use",
    frameworks: ["AppKit", "CoreAudio"],
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

export const packageIgnorePatterns = [
  /^\/(?:\.build|native|node_modules|out|scripts|src|tests)(?:$|\/)/,
  /^\/(?:\.gitignore|pnpm-lock\.yaml|tsconfig\.json)$/,
  /\.map$/,
];

export function packagedAppExecutable(repoRoot, architecture = PACKAGED_ARCHITECTURE) {
  return path.join(
    repoRoot,
    "apps",
    "desktop",
    "out",
    `Luke-darwin-${architecture}`,
    "Luke.app",
    "Contents",
    "MacOS",
    "Luke",
  );
}
