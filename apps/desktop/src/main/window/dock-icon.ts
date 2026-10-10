import path from "node:path";
import { app, nativeImage, nativeTheme } from "electron";

/**
 * The Dock tile per theme: the porcelain tile for a light desktop, the
 * space-black one for a dark. The bundle's `.icns` is cut from the dark tile
 * and cannot follow the theme, and an unpackaged run has only Electron's stock
 * icon, so the running app draws the Dock image itself from these.
 */
const DOCK_ICON_FILES = {
  LIGHT: "luke-icon-light.png",
  DARK: "luke-icon-dark.png",
} as const;

/**
 * Draws Luke's own face in the Dock, matched to the theme. Artwork missing
 * from a build draws nothing, leaving the bundle icon (or the stock one) in
 * place rather than an empty tile.
 */
function drawDockIcon(iconDirectory: string): void {
  if (!app.dock) return;
  const file = nativeTheme.shouldUseDarkColors ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT;
  const image = nativeImage.createFromPath(path.join(iconDirectory, file));
  if (!image.isEmpty()) app.dock.setIcon(image);
}

/**
 * Luke always stands in the Dock, as an ordinary app does; this keeps his
 * tile matched to the theme, drawn now and again as the desktop changes mode.
 */
export function followDockIcon(iconDirectory: string): void {
  drawDockIcon(iconDirectory);
  nativeTheme.on("updated", () => drawDockIcon(iconDirectory));
}
