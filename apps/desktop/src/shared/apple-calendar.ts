// Keep the desktop contract stable while the shared panel and calendar logic
// consume the canonical identity directly from the renderer-safe vocabulary.
export { APPLE_CALENDAR_ID, APPLE_CALENDAR_NAME } from "@sidecar/calendar/vocabulary";

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
