/**
 * web-notices.ts -- the doors a notice leaves a browser tab through: a badge on the installed app or a count before the tab's title.
 *
 * A tab posts no notification. The one notification Luke posts is a command
 * waiting on this Mac (`client-notices.ts`), and no command runs in a tab,
 * so the door that would post one is handed nothing and drops what it is.
 *
 * The badge is the installed app's own where it runs installed; elsewhere,
 * an uninstalled tab included, where a browser that names the app badge
 * draws nothing, it is a count before the tab's title, "(2) Inbox — Acme",
 * kept there as the panel names the tab again.
 */

import type { AgentNoticeDoorsSurface } from "@luke/host/agent-notices";

/** The display mode the site runs in once installed (`public/manifest.webmanifest`'s `display`). */
const INSTALLED_DISPLAY = "(display-mode: standalone)";

/** The count the badge writes before the tab's title, which a new count replaces. */
const TITLE_COUNT = /^\(\d+\) /u;

/** A badge as the tab draws it: the count set, and taken down. */
interface BadgeDoor {
  readonly set: (count: number) => void;
  readonly close: () => void;
}

/** The tab's doors, with the badge's own end. */
export interface WebNoticeDoors extends AgentNoticeDoorsSurface {
  /** Takes the badge down and stops keeping the count before the title. */
  close: () => void;
}

/**
 * The count before the tab's title. Note that the title is watched once a
 * count stands, because the panel names the tab again as it moves and would
 * drop the count until the next one.
 */
function titleBadge(): BadgeDoor {
  let count = 0;
  let watch: MutationObserver | undefined;
  const apply = () => {
    const bare = document.title.replace(TITLE_COUNT, "");
    const next = count > 0 ? `(${count}) ${bare}` : bare;
    if (document.title !== next) document.title = next;
  };
  return {
    set: (next) => {
      count = next;
      apply();
      if (watch !== undefined || count === 0) return;
      watch = new MutationObserver(apply);
      watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    },
    close: () => {
      watch?.disconnect();
      watch = undefined;
      count = 0;
      apply();
    },
  };
}

/** Whether the site runs as the installed app, where alone an app badge is drawn. */
function runsInstalled(): boolean {
  return "matchMedia" in window && window.matchMedia(INSTALLED_DISPLAY).matches;
}

/** The badge: the installed app's own where it runs installed and the browser offers one, else the count before the title. */
function badgeDoor(): BadgeDoor {
  if ("setAppBadge" in navigator && runsInstalled()) {
    const set = (count: number) => {
      const asked = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
      // Note that a refusal is dropped, because a badge the browser will not draw says nothing the window's counts have not.
      asked.catch(() => undefined);
    };
    return { set, close: () => set(0) };
  }
  return titleBadge();
}

/**
 * The tab shown or hidden, said at once and then at each change, for as long
 * as the listener stands: what the notices read as the panel being in
 * front, which an agent's end leaves no unseen dot under while the tab shows
 * its tab. Note that the standing state is said first, because a tab opens
 * shown with no event.
 */
export function onTabShownChanged(listener: (shown: boolean) => void): () => void {
  const said = () => listener(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", said);
  said();
  return () => document.removeEventListener("visibilitychange", said);
}

/** The tab's doors: the badge, and a post that drops what it is handed, since no command runs in a tab. */
export function webNoticeDoors(): WebNoticeDoors {
  const badge = badgeDoor();
  return {
    post: () => undefined,
    badge: badge.set,
    close: badge.close,
  };
}
