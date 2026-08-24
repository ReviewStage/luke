export type { AccountCalendar, ObservedAccountCalendars } from "@sidecar/calendar/observation";

/**
 * One connected calendar source as a renderer may know it: which account,
 * and which of its calendars the user chose to count. For Google the grant
 * behind it stays in the main process, like every credential; for Apple
 * Calendar there is no grant to keep — it lives with macOS.
 */
export interface CalendarAccount {
  /**
   * The account's primary calendar id — its address, which is its name — or
   * the fixed Apple Calendar id for the one source this Mac itself holds.
   */
  id: string;
  selectedCalendarIds: readonly string[];
}
