import { SESSION_NOTICE_STATUS, type SessionNotice } from "@sidecar/core";

/**
 * One notice worded for the notification centre. The shape is macOS's own:
 * the title is what the provider named the session, the subtitle is where it
 * runs, and the body says what just happened. Everything here is the user's
 * own session data, worded on this machine and shown on this machine.
 */
export interface SessionNotificationContent {
  title: string;
  subtitle?: string;
  body: string;
}

/** Where the session runs, as one line, when its provider said. */
function noticePlace(notice: SessionNotice): string | undefined {
  if (notice.repository && notice.branch) return `${notice.repository} · ${notice.branch}`;
  return notice.repository ?? notice.branch;
}

const NOTICE_BODY: Record<
  (typeof SESSION_NOTICE_STATUS)[keyof typeof SESSION_NOTICE_STATUS],
  (notice: SessionNotice) => string
> = {
  [SESSION_NOTICE_STATUS.WAITING]: (notice) => `${notice.providerName} is waiting on you.`,
  // The provider's own reason when it gave one; never a transcript, because a
  // notice only ever carries the bounded detail fields a row draws.
  [SESSION_NOTICE_STATUS.ERROR]: (notice) =>
    notice.error
      ? `${notice.providerName} stopped: ${notice.error}`
      : `${notice.providerName} stopped on an error.`,
  [SESSION_NOTICE_STATUS.COMPLETE]: (notice) => `${notice.providerName} finished.`,
};

export function sessionNotificationContent(notice: SessionNotice): SessionNotificationContent {
  const subtitle = noticePlace(notice);
  return {
    title: notice.title,
    ...(subtitle ? { subtitle } : {}),
    body: NOTICE_BODY[notice.status](notice),
  };
}
