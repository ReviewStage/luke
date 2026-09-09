/** The local calendar integration backed by macOS Calendar and EventKit. */
export const APPLE_CALENDAR_ID = "apple-calendar";

export const APPLE_CALENDAR_NAME = "Apple Calendar";

/**
 * The one calendar integration's identity, named apart from the credential
 * registry: Google Calendar connects by signing in rather than by a pasted
 * key, holds several accounts at once, and is offered only in a build that
 * carries an OAuth client — none of which the per-provider key machinery
 * models. The id is what the mark registry and the settings block share.
 */
export const GOOGLE_CALENDAR_ID = "google-calendar";

export const GOOGLE_CALENDAR_NAME = "Google Calendar";

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
