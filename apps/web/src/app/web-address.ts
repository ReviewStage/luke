/**
 * web-address.ts -- where the web app stands on its origin: the path its panel is served at, the base its static files are under, and the address the tab is at.
 *
 * The panel is served at `/app` whatever Luke link it was opened on
 * (`vercel.json`), so that path names no place: the history writes it for a
 * step whose own address is not this site's, the loaded link reads it as
 * Home, session replay and Sentry name every address of the tab by it, and a
 * connect's landing page goes back to it. The panel's own copy of the path
 * stays in `@luke/panel/navigation-history`, since the panel reaches no
 * shell.
 */

/** The path the web app's panel is served at, which names no place. */
export const PANEL_PATH = "/app";

/** Where the build emits the panel's static files, Excalidraw's fonts and the harness marks (`scripts/panel-build.ts`). */
export const PANEL_ASSET_BASE = `${PANEL_PATH}/`;

/** The address the tab stands at, as the panel writes one: its path, query, and fragment. */
export function addressHere(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}
