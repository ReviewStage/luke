import { on } from "node:events";
import path from "node:path";
import type { DevBuildBadge } from "@repo/settings/dev-build";
import { app, BrowserWindow, type NativeImage, nativeImage, nativeTheme } from "electron";

/**
 * The Dock tile per theme: the copper tile for a light desktop, the night
 * one for a dark. The bundle's `.icns` is cut from the dark tile
 * and cannot follow the theme, and an unpackaged run has only Electron's stock
 * icon, so the running app draws the Dock image itself from these.
 */
const DOCK_ICON_FILES = {
  LIGHT: "icon-light.png",
  DARK: "icon-dark.png",
} as const;

/**
 * Where a development build's band stands, in the tile art's 1024-unit
 * canvas: across the foot of the 824-unit tile `@repo/brand` centers on it
 * (`ICON_GRID` in its generate-brand-assets.mjs), clipped to its corners.
 */
const BAND = {
  CANVAS: 1024,
  TILE_EDGE: 100,
  TILE_SIDE: 824,
  TILE_RADIUS: 185.4,
  TOP: 724,
  BASELINE: 868,
  FONT_SIZE: 132,
  /** The pixels the tile is drawn at, the size of the art the build ships. */
  PIXELS: 512,
} as const;

/** Text made safe to stand inside SVG markup. */
function escapeMarkup(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A page drawing the tile with the build's band across its foot, its label in
 * white. Note that the SVG stands as a block, because an inline one sits on
 * the text baseline and leaves the page a few pixels taller than the window,
 * which paints scrollbars into the tile's right and bottom edges.
 */
function bandedTilePage(tile: NativeImage, badge: DevBuildBadge): string {
  const { CANVAS, TILE_EDGE, TILE_SIDE, TILE_RADIUS, TOP, BASELINE, FONT_SIZE, PIXELS } = BAND;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${PIXELS}" height="${PIXELS}" style="display:block">`,
    `<defs><clipPath id="tile"><rect x="${TILE_EDGE}" y="${TILE_EDGE}" width="${TILE_SIDE}" height="${TILE_SIDE}" rx="${TILE_RADIUS}"/></clipPath></defs>`,
    `<image href="${tile.toDataURL()}" width="${CANVAS}" height="${CANVAS}"/>`,
    `<g clip-path="url(#tile)"><rect x="${TILE_EDGE}" y="${TOP}" width="${TILE_SIDE}" height="${TILE_EDGE + TILE_SIDE - TOP}" fill="${escapeMarkup(badge.color)}"/>`,
    `<text x="${CANVAS / 2}" y="${BASELINE}" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-weight="700" font-size="${FONT_SIZE}" fill="#ffffff">${escapeMarkup(badge.label)}</text></g>`,
    "</svg>",
  ].join("");
  const page = `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(page)}`;
}

/** How many frames the band's window may paint empty before it is given up on. */
const PAINT_FRAMES = 60;

/**
 * Draws a page into an image off screen. The main process draws no text of
 * its own, so a hidden, script-free window lays the band's words out and is
 * closed once it has painted them. Note that we wait for the first frame that
 * holds an image, because the first an offscreen window paints is empty.
 */
async function paintOffscreen(page: string): Promise<NativeImage> {
  const window = new BrowserWindow({
    show: false,
    width: BAND.PIXELS,
    height: BAND.PIXELS,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  });
  try {
    const frames = on(window.webContents, "paint");
    await window.loadURL(page);
    window.webContents.invalidate();
    let painted = 0;
    for await (const [, , image] of frames as AsyncIterable<[unknown, unknown, NativeImage]>) {
      if (!image.isEmpty()) return image;
      painted += 1;
      if (painted >= PAINT_FRAMES) break;
    }
    throw new Error(`no frame held the band after ${PAINT_FRAMES} paints`);
  } finally {
    window.destroy();
  }
}

/** The theme's plain tile, empty where the build carries no artwork. */
function plainTile(iconDirectory: string): NativeImage {
  const file = nativeTheme.shouldUseDarkColors ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT;
  return nativeImage.createFromPath(path.join(iconDirectory, file));
}

/**
 * Draws the app's own icon in the Dock, matched to the theme. Artwork missing
 * from a build draws nothing, leaving the bundle icon (or the stock one) in
 * place rather than an empty tile. A development build's band is drawn over
 * the plain tile once it has painted, so a band that fails, or never paints,
 * leaves the plain tile standing rather than Electron's own, and one a later
 * draw overtook (`latest`) sets nothing.
 */
async function drawDockIcon(
  iconDirectory: string,
  badge: DevBuildBadge | undefined,
  report: (message: string) => void,
  latest: () => boolean,
): Promise<void> {
  if (!app.dock) return;
  const tile = plainTile(iconDirectory);
  if (tile.isEmpty()) return;
  app.dock.setIcon(tile);
  if (badge === undefined) return;
  try {
    const banded = await paintOffscreen(bandedTilePage(tile, badge));
    // Note that a draw a later theme change overtook keeps its band to itself.
    if (latest()) app.dock.setIcon(banded);
  } catch (error) {
    report(
      `the Dock band could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The app always stands in the Dock, as an ordinary app does; this keeps its
 * tile matched to the theme, drawn now and again as the desktop changes mode.
 * A development build's tile carries its band (`badge`), so builds running
 * side by side are told apart in the Dock and the app switcher. What it
 * answers draws the tile again with another band, or none, as the menu bar
 * hides a build's label for a demo.
 */
export function followDockIcon(
  iconDirectory: string,
  badge: DevBuildBadge | undefined,
  report: (message: string) => void,
): (badge: DevBuildBadge | undefined) => void {
  let band = badge;
  let draws = 0;
  const draw = (): void => {
    draws += 1;
    const mine = draws;
    void drawDockIcon(iconDirectory, band, report, () => mine === draws);
  };
  draw();
  nativeTheme.on("updated", draw);
  return (next) => {
    band = next;
    draw();
  };
}
