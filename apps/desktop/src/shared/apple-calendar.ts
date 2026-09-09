/**
 * The helper's answer to how far macOS lets the read go, shared because both
 * sides of the bridge speak it: the renderer asks the status probe whether
 * the grant already stands — only `FULL` reads anything, and only its absence
 * stands the panel down for a consent dialog that will actually appear.
 */
export const APPLE_CALENDAR_ACCESS = {
  FULL: "full-access",
  WRITE_ONLY: "write-only",
  DENIED: "denied",
  RESTRICTED: "restricted",
  NOT_DETERMINED: "not-determined",
} as const;

export type AppleCalendarAccess =
  (typeof APPLE_CALENDAR_ACCESS)[keyof typeof APPLE_CALENDAR_ACCESS];

/**
 * The System Settings pane where the Mac's own calendar grant is given or
 * taken back. The grant is macOS's, never Luke's, so the only thing to offer
 * is the way there.
 */
export const CALENDAR_PRIVACY_PANE_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars";
