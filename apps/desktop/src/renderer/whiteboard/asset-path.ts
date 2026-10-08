/**
 * asset-path.ts -- points Excalidraw's fonts at the copies shipped beside this bundle, before Excalidraw loads.
 *
 * Excalidraw fetches its fonts from a public CDN unless `EXCALIDRAW_ASSET_PATH`
 * names somewhere else, and the panel's policy loads nothing from the
 * network. The build copies the fonts to `renderer/fonts/`, beside the
 * document, so the path is the document's own folder. This module is the
 * entry's first import, so it runs before Excalidraw's own modules do.
 */

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL(".", document.baseURI).href;

export {};
