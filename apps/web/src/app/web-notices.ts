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
 * press, which is when a browser lets a page ask; a notice posted while it
 * was never granted is dropped, and nothing here asks on load. What the
 * browser last answered is handed on as the status Settings draws, read
 * from the permission without asking.
 *
 * The badge is the installed app's own where the browser offers one;
 * elsewhere it is a count before the tab's title, "(2) Inbox — Acme",
 * kept there as the panel names the tab again.
 */

import type { AgentNotice, AgentNoticeDoorsSurface } from "@luke/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@luke/voice/settings-controls";

/** What Settings' test notification says. */
const TEST_NOTICE = {
  title: "Luke notifications are on",
  body: "",
} as const;

/** The picture each notification carries: the site's own icon. */
const NOTICE_ICON = "/apple-touch-icon.png";

/** The count the badge writes before the tab's title, which a new count replaces. */
const TITLE_COUNT = /^\(\d+\) /u;

/** What each answer of the browser's permission says of whether notifications are on. */
const STATUS_OF_PERMISSION = {
  granted: NOTIFICATIONS_STATUS.ON,
  denied: NOTIFICATIONS_STATUS.OFF,
  default: NOTIFICATIONS_STATUS.UNKNOWN,
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
  /** Asks for permission where it was never answered, then posts the test whether the tab is hidden or not: Settings' press alone calls this. */
  postTest: () => Promise<void>;
  /** Takes the badge down and stops keeping the count before the title. */
  close: () => void;
}

/** Posts one notification whose click brings the tab forward and hands back to the notice. */
function show(notice: AgentNotice): void {
  const shown = new Notification(notice.title, { body: notice.body, icon: NOTICE_ICON });
  shown.onclick = () => {
    shown.close();
    window.focus();
    notice.onClick();
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

/** The badge: the installed app's own where the browser offers one, else the count before the title. */
function badgeDoor(): BadgeDoor {
  if ("setAppBadge" in navigator) {
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
 * for, so Settings draws it.
 */
export function webNoticeDoors(dependencies: {
  toasts: NoticeToasts;
  onAnswered: (status: NotificationsStatus) => void;
}): WebNoticeDoors {
  const { toasts, onAnswered } = dependencies;
  const badge = badgeDoor();
  return {
    ...toasts,
    post: (notice) => {
      if (!notificationsOffered()) return;
      // A permission changed in the browser's own settings is heard here as well as on the test.
      onAnswered(notificationsStatusNow());
      if (Notification.permission === "granted") show(notice);
    },
    postTest: async () => {
      if (!notificationsOffered()) {
        onAnswered(NOTIFICATIONS_STATUS.OFF);
        return;
      }
      if (Notification.permission === "default") await Notification.requestPermission();
      onAnswered(notificationsStatusNow());
      if (Notification.permission !== "granted") return;
      show({ ...TEST_NOTICE, onClick: () => undefined });
    },
    badge: badge.set,
    close: badge.close,
  };
}
