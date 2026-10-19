/**
 * load-link.ts -- the tab's own address opened as a Luke link: once as the page loads, and again whenever the browser lands on an entry no step was saved in.
 *
 * The web serves the panel at every Luke link's own path, so the address a
 * tab is opened at is the link it was opened from on another host. It is
 * rebased onto the link home, so `readLink` reads it as the desktop reads a
 * link it is handed, and said once through the bridge's `onShowLink`, which
 * the panel already opens (`app.tsx`). A page reloaded on an entry the
 * browser history saved a step in (`browser-history.ts`) reopens that step
 * instead, and says nothing here. `/app`, the panel's own path, names no
 * place, so the panel opens on Home there; so does `/app.html`, the build's
 * file name, which only the dev server answers, the site sending it to
 * `/app`.
 */

import { LINK_ORIGIN } from "@luke/features/link-home";
import { type ReadLink, readLink } from "@luke/features/luke-link";
import type { AppBridge } from "@luke/host/bridge";
import { savedEntry } from "./browser-history";

/** The paths the panel itself is served at, which name no place. */
const PANEL_PATHS: ReadonlySet<string> = new Set(["/app", "/app.html"]);

/** The place the tab's address names, read as its link on the home; nothing for the panel's own paths or a path naming no place. */
function linkHere(): ReadLink | undefined {
  if (PANEL_PATHS.has(location.pathname.replace(/\/$/u, ""))) return undefined;
  return readLink(`${LINK_ORIGIN}${location.pathname}${location.search}${location.hash}`);
}

/**
 * The bridge with the tab's address said through its `onShowLink`: as the
 * page loads, to the first subscriber only, where the entry it loaded on
 * holds no saved step; and to every subscriber, whenever the browser lands
 * on an entry holding none, since only the address says what was there.
 */
export function withLoadLink(bridge: AppBridge): AppBridge {
  let loaded = savedEntry() === undefined ? linkHere() : undefined;
  return {
    ...bridge,
    onShowLink: (listener) => {
      const stop = bridge.onShowLink(listener);
      const landed = (event: PopStateEvent) => {
        if (savedEntry(event) !== undefined) return;
        const link = linkHere();
        if (link !== undefined) listener(link);
      };
      window.addEventListener("popstate", landed);
      const waiting = loaded;
      loaded = undefined;
      if (waiting !== undefined) listener(waiting);
      return () => {
        stop();
        window.removeEventListener("popstate", landed);
      };
    },
  };
}
