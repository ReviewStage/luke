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
 * `/app`. A tab opened at a link written before the task was a task,
 * `/<workspace>/plan/…`, is moved onto the address written now,
 * `/<workspace>/task/…`, before it is read, so the address bar, a reload, and
 * Copy link name it as every link does now. A link place, a section, a
 * comment thread, a page, or an agent's place under its task or under its
 * page (`@repo/panel/places/link-places`), is its route's to open, so a tab
 * opened at one is moved onto the address its link is written at now, every
 * older spelling read, and lands on that route, which opens it, rather than
 * being said here. An agent's own address is its page's, which is still
 * said here, as its link finds where the agent stands.
 */

import {
  currentTaskPath,
  linkOf,
  type ReadLink,
  readShownLink,
  type ShownLink,
} from "@repo/features/link-grammar";
import { LINK_ORIGIN } from "@repo/features/link-home";
import type { AppBridge } from "@repo/host/bridge";
import { savesStep } from "@repo/panel/navigation-history";
import { opensAtItsRoute } from "@repo/panel/places/link-places";
import type { RouterHistory } from "@tanstack/react-router";
import { addressHere, PANEL_PATH } from "./web-address";

/** The paths the panel itself is served at, which name no place. */
const PANEL_PATHS: ReadonlySet<string> = new Set([PANEL_PATH, `${PANEL_PATH}.html`]);

/** The place the tab's address names, read as its link on the home; nothing for the panel's own paths or a path naming no place. */
function linkHere(): ShownLink | undefined {
  if (PANEL_PATHS.has(location.pathname.replace(/\/$/u, ""))) return undefined;
  return readShownLink(`${LINK_ORIGIN}${addressHere()}`);
}

/** Whether a link is one a link place's route opens, which the tab lands on rather than saying here. */
function routedHere(link: ShownLink | undefined): link is ReadLink {
  return link !== undefined && "workspace" in link && opensAtItsRoute(link);
}

/** The address a link is written at now, its path, query, and fragment, as `linkOf` writes it, every other key the tab's own query carries kept after its own. */
function addressOfLink(link: ReadLink): string {
  const url = new URL(linkOf(link.place, link.workspace));
  for (const [key, value] of new URLSearchParams(location.search)) {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Moves the tab's entry onto `address` in place, flushed at once, before anything reads it. */
function standAt(history: RouterHistory, address: string): void {
  if (address === addressHere()) return;
  history.replace(address, history.location.state);
  // Note that the history writes the address bar on its next tick, so the move is flushed now, before anything reads the address.
  history.flush();
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
  standAt(history, currentTaskPath(addressHere()));
  const here = savesStep(history.location) ? undefined : linkHere();
  // A link place lands on its route at the address its link is written at now, which opens it.
  if (routedHere(here)) standAt(history, addressOfLink(here));
  let loaded = routedHere(here) ? undefined : here;
  return {
    ...bridge,
    onShowLink: (listener) => {
      const stop = bridge.onShowLink(listener);
      const stopLanding = history.subscribe(({ location, action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE" || savesStep(location)) return;
        const link = linkHere();
        if (link !== undefined && !routedHere(link)) listener(link);
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
