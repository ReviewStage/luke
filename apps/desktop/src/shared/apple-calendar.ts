/**
 * The local calendar integration's identity, named beside Google Calendar's
 * and apart from the credential registry for the same reasons: Apple Calendar
 * connects through macOS's own consent dialog rather than by a pasted key or
 * a browser sign-in, holds no credential at all, and exists only where there
 * is a Mac to read. The id is what the mark registry, the settings block, and
 * the observed-calendars roster share.
 */
export const APPLE_CALENDAR_ID = "apple-calendar";

export const APPLE_CALENDAR_NAME = "Apple Calendar";

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
