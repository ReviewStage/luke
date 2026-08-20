/** One calendar as its account's list names it, for a settings row. */
export interface AccountCalendar {
  id: string;
  label: string;
  /** The calendar's own colour as Google lists it, when it sent a sound one. */
  color?: string;
}

/** The calendars one account offered on the latest observation pass. */
export interface ObservedAccountCalendars {
  accountId: string;
  calendars: readonly AccountCalendar[];
}
