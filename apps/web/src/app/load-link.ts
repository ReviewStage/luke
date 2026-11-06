/**
 * load-link.ts -- the tab's own address opened as an app link: once as the page loads, and again whenever the browser lands on an entry no step was saved in.
 *
 * The web serves the panel at every app link's own path, so the address a
 * tab is opened at is the link it was opened from on another host. It is
 * rebased onto the link home, so `readShownLink` reads it as the desktop reads a
 * link it is handed, and said once through the bridge's `onShowLink`, which
 * the panel already opens (`app.tsx`). A page reloaded on an entry the
 * panel saved a step in through the router's history
 * (`@repo/panel/navigation-history`'s `savesStep`) reopens that step
 * instead, and says nothing here. `/app`, the panel's own path, names no
 * place, so the panel opens where it rests there; so does `/app.html`, the build's
 * file name, which only the dev server answers, the site sending it to
 * `/app`.
 */

import { readShownLink, type ShownLink } from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import type { AppBridge } from "@repo/host/bridge";
import { savesStep } from "@repo/panel/navigation-history";
import type { RouterHistory } from "@tanstack/react-router";
import { addressHere, PANEL_PATH } from "./web-address";

/** The paths the panel itself is served at, which name no place. */
const PANEL_PATHS: ReadonlySet<string> = new Set([PANEL_PATH, `${PANEL_PATH}.html`]);

/** The place the tab's address names, read as its link on the home; nothing for the panel's own paths or a path naming no place. */
function linkHere(): ShownLink | undefined {
  if (PANEL_PATHS.has(location.pathname.replace(/\/$/u, ""))) return undefined;
  return readShownLink(`${LINK_ORIGIN}${addressHere()}`);
}

/**
 * The bridge with the tab's address said through its `onShowLink`: as the
 * page loads, to the first subscriber only, where the entry it loaded on
 * holds no saved step; and to every subscriber, whenever the browser lands
 * on an entry holding none, since only the address says what was there.
 * Both are read from the tab's router `history`, a landing as the browser's
 * own move along it, never a write.
 */
export function withLoadLink(bridge: AppBridge, history: RouterHistory): AppBridge {
  let loaded = savesStep(history.location) ? undefined : linkHere();
  return {
    ...bridge,
    onShowLink: (listener) => {
      const stop = bridge.onShowLink(listener);
      const stopLanding = history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE" || savesStep(location)) return;
        const link = linkHere();
        if (link !== undefined) listener(link);
      });
      const waiting = loaded;
      loaded = undefined;
      if (waiting !== undefined) listener(waiting);
      return () => {
        stop();
        stopLanding();
      };
    },
  };
}
