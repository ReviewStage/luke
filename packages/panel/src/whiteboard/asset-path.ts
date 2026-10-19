/**
 * asset-path.ts -- points Excalidraw's fonts at the copies the shell serves, before Excalidraw loads.
 *
 * Excalidraw fetches its fonts from a public CDN unless `EXCALIDRAW_ASSET_PATH`
 * names somewhere else, and the panel's policy loads nothing from the
 * network. The shell serves the fonts under `fonts/` in its asset base
 * (`../app-platform.ts`), so the path is that base. Excalidraw reads the
 * path as its own modules run, so this module is imported, and has run,
 * before the whiteboard's entry is (`../bundle-loader.ts`): an import at the
 * top of the entry would not do, because a bundler that splits Excalidraw into
 * a chunk of its own runs that chunk before anything in the entry.
 */

import { appPlatform } from "../app-platform.js";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = appPlatform().assetBase();
