import path from "node:path";
import process from "node:process";

export const packageIgnorePatterns = [
  /^\/(?:\.build|native|node_modules|out|scripts|src|tests)(?:$|\/)/,
  /^\/(?:\.gitignore|pnpm-lock\.yaml|tsconfig\.json)$/,
  /\.map$/,
];

export function packagedAppExecutable(repoRoot, architecture = process.arch) {
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
