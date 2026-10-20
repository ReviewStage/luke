/**
 * web-notices.ts -- the doors a notice leaves a browser tab through: the browser's own notification while the tab is hidden, the panel's toast, and a badge on the installed app or a count before the tab's title.
 *
 * The host's notices decide between the toast and the notification by
 * whether the panel is in front (`agent-notices.ts`), which for a tab is
 * whether it is shown (`onTabShownChanged`): a tab on screen hears the
 * window's own toast, and only a hidden one is posted a notification. Note
 * that the doors post whatever they are handed and check no visibility of
 * their own, because the one post a shown tab is handed is an agent's end
 * that waited on a read while the tab came forward, which the notices post
 * rather than toast, and a door that dropped it would leave that end said
 * nowhere. A click brings the tab
 * forward and opens the place, through the same presenter the toast's View
 * goes through. What a notification says is the notices' own text, the
 * same words the Mac's say and no more.
 *
 * Permission is asked for only from Settings' test, on the developer's own
 * press and in the press's own handler (`askNotificationsPermission`), which
 * is when a browser lets a page ask: Safari shows no prompt to an ask made a
 * turn later. A notice posted while it was never granted is dropped, and
 * nothing here asks on load. What the browser last answered is handed on as
 * the status Settings draws, read from the permission without asking, and
 * again each time the browser says the permission changed, as from its own
 * settings.
 *
 * A browser may name `Notification` and still refuse to build one: Android's
 * Chrome, and a Home Screen app on iOS, show a notification only through a
 * service worker, which this app has none of. The first refusal withdraws
 * notifications for the rest of the tab's life, as if the browser offered
 * none, and nothing throws back into the notices that posted it.
 *
 * Every tab of the site hears the same notices, so a notification is tagged
 * by the event it tells of (`AgentNotice.id`), never by its words, which
 * two events may share, and the browser shows one for every hidden tab that posts
 * it rather than one each.
 *
 * The badge is the installed app's own where it runs installed; elsewhere,
 * an uninstalled tab included, where a browser that names the app badge
 * draws nothing, it is a count before the tab's title, "(2) Inbox — Acme",
 * kept there as the panel names the tab again.
 */

import type { AgentNotice, AgentNoticeDoorsSurface } from "@luke/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";

/** What Settings' test notification says. */
const TEST_NOTICE = {
  id: "test",
  title: "Luke notifications are on",
  body: "",
} as const;

/** The picture each notification carries: the site's own icon. */
const NOTICE_ICON = "/apple-touch-icon.png";

/** What every tag a notification carries begins with, so none meets another page's of the site. */
const TAG_PREFIX = "luke-notice";

/** The display mode the site runs in once installed (`public/manifest.webmanifest`'s `display`). */
const INSTALLED_DISPLAY = "(display-mode: standalone)";

/** Each answer the browser gives of the site's permission. */
const PERMISSION = {
  GRANTED: "granted",
  DENIED: "denied",
  DEFAULT: "default",
} as const satisfies Record<string, NotificationPermission>;

/** The count the badge writes before the tab's title, which a new count replaces. */
const TITLE_COUNT = /^\(\d+\) /u;

/** What each answer of the browser's permission says of whether notifications are on. */
const STATUS_OF_PERMISSION = {
  [PERMISSION.GRANTED]: NOTIFICATIONS_STATUS.ON,
  [PERMISSION.DENIED]: NOTIFICATIONS_STATUS.OFF,
  [PERMISSION.DEFAULT]: NOTIFICATIONS_STATUS.UNKNOWN,
} as const satisfies Record<NotificationPermission, NotificationsStatus>;

/** A badge as the tab draws it: the count set, and taken down. */
interface BadgeDoor {
  readonly set: (count: number) => void;
  readonly close: () => void;
}

/** The toasts the panel draws, which reach it through the bridge's events. */
type NoticeToasts = Pick<
  AgentNoticeDoorsSurface,
  "toast" | "toastInbox" | "toastFailedRun" | "toastChat"
>;

/** The tab's doors, with the test Settings posts and the badge's own end. */
export interface WebNoticeDoors extends AgentNoticeDoorsSurface {
  /** Asks for permission where it was never answered, joining the press's own ask where it still waits, then posts the test whether the tab is hidden or not: Settings' press alone calls this. */
  postTest: () => Promise<void>;
  /** Takes the badge down, stops keeping the count before the title, and stops following the permission. */
  close: () => void;
}

/** The ask for permission still waiting on the developer, which a second ask joins rather than makes again. */
let asking: Promise<void> | undefined;

/** The tag a notice's notification carries: what it tells of, the same in every tab that posts it and no other event's. */
function tagOf(notice: Pick<AgentNotice, "id">): string {
  return `${TAG_PREFIX}:${notice.id}`;
}

/**
 * Posts one notification whose click brings the tab forward and hands back
 * to the notice, and answers whether the browser built it: one that refuses
 * a page's own notification throws here.
 */
function show(notice: AgentNotice): boolean {
  let shown: Notification;
  try {
    shown = new Notification(notice.title, {
      body: notice.body,
      icon: NOTICE_ICON,
      tag: tagOf(notice),
    });
  } catch {
    return false;
  }
  shown.onclick = () => {
    shown.close();
    window.focus();
    notice.onClick();
  };
  return true;
}

/**
 * Follows the site's permission for notifications where the browser says
 * when it changes, and `heard` each time it does, until the returned
 * function is called. A browser that says nothing of it, or refuses the
 * query, is followed no further than each post and test.
 */
function followPermission(heard: () => void): () => void {
  if (!("permissions" in navigator)) return () => undefined;
  let stopped = false;
  let followed: PermissionStatus | undefined;
  navigator.permissions.query({ name: "notifications" }).then(
    (status) => {
      if (stopped) return;
      followed = status;
      status.addEventListener("change", heard);
      // A change made while the query was on its way had no listener to hear it.
      heard();
    },
    () => undefined,
  );
  return () => {
    stopped = true;
    followed?.removeEventListener("change", heard);
  };
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
      // Note that a refusal is dropped, because a badge the browser will not draw says nothing a toast has not.
      asked.catch(() => undefined);
    };
    return { set, close: () => set(0) };
  }
  return titleBadge();
}

/** Whether this browser posts notifications at all, without which the tab offers none. */
export function notificationsOffered(): boolean {
  return "Notification" in window;
}

/**
 * Asks the browser for the site's permission where it was never answered.
 * Note that it is called in the press's own handler, before anything waits,
 * because Safari shows its prompt only to an ask made inside the press; and
 * that an ask still waiting is joined, so the test that follows the press
 * shows no second prompt.
 */
export function askNotificationsPermission(): Promise<void> {
  if (asking !== undefined) return asking;
  if (!notificationsOffered() || Notification.permission !== PERMISSION.DEFAULT) {
    return Promise.resolve();
  }
  const settled = () => {
    asking = undefined;
  };
  asking = Notification.requestPermission().then(settled, settled);
  return asking;
}

/** Whether notifications are on for the site, as the permission stands, read without asking. */
export function notificationsStatusNow(): NotificationsStatus {
  if (!notificationsOffered()) return NOTIFICATIONS_STATUS.OFF;
  return STATUS_OF_PERMISSION[Notification.permission];
}

/**
 * The tab shown or hidden, said at once and then at each change, for as long
 * as the listener stands: what the notices read as the panel being in
 * front. Note that a shown tab counts as in front even while another window
 * covers the browser, because a notification is posted only to a hidden
 * one, and a notice neither toasted nor posted would be lost; and that the
 * standing state is said first, because a tab opens shown with no event.
 */
export function onTabShownChanged(listener: (shown: boolean) => void): () => void {
  const said = () => listener(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", said);
  said();
  return () => document.removeEventListener("visibilitychange", said);
}

/**
 * The tab's doors over the toasts handed in. `onAnswered` hears what the
 * browser's permission says each time a notification is posted or asked
 * for, and each time the browser says it changed, so Settings draws it;
 * `onWithdrawn` hears, once, that the browser refused to build a
 * notification, after which the doors post none and the tab offers none.
 */
export function webNoticeDoors(dependencies: {
  toasts: NoticeToasts;
  onAnswered: (status: NotificationsStatus) => void;
  onWithdrawn: () => void;
}): WebNoticeDoors {
  const { toasts, onAnswered, onWithdrawn } = dependencies;
  const badge = badgeDoor();
  let refused = false;
  const offered = () => notificationsOffered() && !refused;
  const posted = (notice: AgentNotice) => {
    if (show(notice) || refused) return;
    refused = true;
    onWithdrawn();
  };
  const unfollow = offered()
    ? followPermission(() => {
        if (offered()) onAnswered(notificationsStatusNow());
      })
    : () => undefined;
  return {
    ...toasts,
    post: (notice) => {
      if (!offered()) return;
      // A permission changed in the browser's own settings is heard here as well as on the test.
      onAnswered(notificationsStatusNow());
      if (Notification.permission === PERMISSION.GRANTED) posted(notice);
    },
    postTest: async () => {
      if (!offered()) {
        onAnswered(NOTIFICATIONS_STATUS.OFF);
        return;
      }
      await askNotificationsPermission();
      // Note that another test may have been refused while this one waited.
      if (!offered()) return;
      onAnswered(notificationsStatusNow());
      if (Notification.permission !== PERMISSION.GRANTED) return;
      posted({ ...TEST_NOTICE, onClick: () => undefined });
    },
    badge: badge.set,
    close: () => {
      unfollow();
      badge.close();
    },
  };
}
