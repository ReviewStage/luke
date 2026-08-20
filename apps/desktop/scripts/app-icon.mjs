import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ICONSET_SOURCES, iconutilArguments } from "./package-config.mjs";

/**
 * Builds the one Luke.icns both bundles carry — the app's, and the calendar
 * helper's, whose System Settings consent row draws it — from the committed
 * brand PNGs. Skipped while the built icon is newer than every source, so
 * the dev launches that build the helper on every start pay nothing; the
 * sources are committed files, so mtime is a sound freshness answer.
 */
export function buildAppIcon(appRoot, repoRoot) {
  const iconsetPath = path.join(appRoot, ".build", "luke.iconset");
  const iconPath = path.join(appRoot, ".build", "Luke.icns");
  const brandIconDirectory = path.join(repoRoot, "design", "brand", "icon");
  const sourcePaths = Object.values(ICONSET_SOURCES).map((sourceName) => {
    const sourcePath = path.join(brandIconDirectory, sourceName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Luke brand icon source is missing: ${sourcePath}`);
    }
    return sourcePath;
  });
  if (fs.existsSync(iconPath)) {
    const builtAt = fs.statSync(iconPath).mtimeMs;
    if (sourcePaths.every((sourcePath) => fs.statSync(sourcePath).mtimeMs < builtAt)) {
      return iconPath;
    }
  }
  fs.rmSync(iconsetPath, { recursive: true, force: true });
  fs.mkdirSync(iconsetPath, { recursive: true });
  for (const [iconsetName, sourceName] of Object.entries(ICONSET_SOURCES)) {
    fs.copyFileSync(path.join(brandIconDirectory, sourceName), path.join(iconsetPath, iconsetName));
  }
  execFileSync("iconutil", iconutilArguments(iconsetPath, iconPath), { stdio: "inherit" });
  return iconPath;
}
