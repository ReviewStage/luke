import { on } from "node:events";
import path from "node:path";
import type { DevBuildBadge } from "@repo/settings/dev-build";
import { app, BrowserWindow, type NativeImage, nativeImage, nativeTheme } from "electron";

const DOCK_ICON_FILES = {
  LIGHT: "icon-light.png",
  DARK: "icon-dark.png",
} as const;

const BAND = {
  CANVAS: 1024,
  TILE_EDGE: 100,
  TILE_SIDE: 824,
  TILE_RADIUS: 185.4,
  TOP: 780,
  BASELINE: 884,
  FONT_SIZE: 96,
  PIXELS: 512,
} as const;

function escapeMarkup(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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

const PAINT_FRAMES = 60;

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

function plainTile(iconDirectory: string): NativeImage {
  const file = nativeTheme.shouldUseDarkColors ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT;
  return nativeImage.createFromPath(path.join(iconDirectory, file));
}

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
    if (latest()) app.dock.setIcon(banded);
  } catch (error) {
    report(
      `the Dock band could not be drawn: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

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
