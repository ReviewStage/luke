import path from "node:path";

export const PACKAGED_ARCHITECTURE = "arm64";

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
