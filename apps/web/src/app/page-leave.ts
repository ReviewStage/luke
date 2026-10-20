/**
 * page-leave.ts -- the tab's own ways out of the panel, closed, reloaded, or sent elsewhere, asking first while a page holds unsaved work.
 *
 * The panel's leave guard asks before any of its own doors moves it off a
 * page whose work would be lost, and tells the platform the ask standing
 * (`AppPlatform.unsavedWork`). A tab has ways out the panel never sees: the
 * browser's close and reload, and this tab sent to another address, as a
 * sign-in and a connect whose tab the browser refused do. While an ask
 * stands, the browser's own ways out ask through `beforeunload`, and this
 * tab's sends ask through the panel's question first; once none stands the
 * listener comes down, because one always registered keeps the page out of
 * the back-forward cache. A send the developer said to take goes past the
 * browser's question too, since they were just asked, and past it once
 * only: a send that never unloads (stopped, or never committed) leaves the
 * next close or reload asked about again.
 */

import type { AppPlatform } from "@luke/panel/app-platform";

/** The ask the panel stands while a page holds unsaved work. */
type LeaveAsk = Parameters<NonNullable<AppPlatform["unsavedWork"]>>[0];

/** What leaving reaches of the page: its `beforeunload`. */
export interface LeavingPage {
  readonly addEventListener: (type: "beforeunload", listener: (event: Event) => void) => void;
  readonly removeEventListener: (type: "beforeunload", listener: (event: Event) => void) => void;
}

export interface PageLeave {
  /** What the platform answers the panel with: the ask standing while a page holds unsaved work, or nothing once none does. */
  readonly unsavedWork: (ask: LeaveAsk) => void;
  /** Takes `go`, a way out of this tab, once the standing ask says to, or at once where none stands. */
  readonly leave: (go: () => void) => void;
  /** Whether a page holds unsaved work now: an ask stands. */
  readonly holdsUnsavedWork: () => boolean;
}

export function pageLeave(page: LeavingPage): PageLeave {
  let standing: LeaveAsk;
  // Whether a way out the developer said to take is under way, whose one `beforeunload` the browser asks nothing about.
  let leaving = false;

  const holdBack = (event: Event): void => {
    if (leaving) {
      leaving = false;
      return;
    }
    event.preventDefault();
    // Note that Chrome and Edge before 119 ask only where `returnValue` is set too.
    event.returnValue = true;
  };

  const unsavedWork = (ask: LeaveAsk): void => {
    if (ask !== undefined && standing === undefined) {
      page.addEventListener("beforeunload", holdBack);
    }
    if (ask === undefined && standing !== undefined) {
      page.removeEventListener("beforeunload", holdBack);
    }
    // A newly stood ask is work the developer has not yet said to leave.
    if (ask !== undefined) leaving = false;
    standing = ask;
  };

  const take = (go: () => void): void => {
    leaving = true;
    go();
  };

  const leave = (go: () => void): void => {
    const ask = standing;
    if (ask === undefined) {
      go();
      return;
    }
    ask(() => take(go));
  };

  return { unsavedWork, leave, holdsUnsavedWork: () => standing !== undefined };
}

/** This tab's ways out, over its own window. */
export function tabLeave(): PageLeave {
  return pageLeave(window);
}
