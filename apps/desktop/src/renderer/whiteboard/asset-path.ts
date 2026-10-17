/**
 * asset-path.ts -- points Excalidraw's fonts at the copies shipped beside this bundle, before Excalidraw loads.
 *
 * Excalidraw fetches its fonts from a public CDN unless `EXCALIDRAW_ASSET_PATH`
 * names somewhere else, and the panel's policy loads nothing from the
 * network. The build copies the fonts to `renderer/fonts/`, beside the
 * document, so the path is the document's own folder. Excalidraw reads the
 * path as its own modules run, so this module is imported, and has run,
 * before the whiteboard's entry is (`../bundle-loader.ts`): an import at the
 * top of the entry would not do, because a bundler that splits Excalidraw into
 * a chunk of its own runs that chunk before anything in the entry.
 */

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL(".", document.baseURI).href;

export {};
