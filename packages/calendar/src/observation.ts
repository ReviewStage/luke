/** One calendar as its account's list names it, for a settings row. */
export interface AccountCalendar {
  id: string;
  label: string;
  /** The calendar's own colour as Google lists it, when it sent a sound one. */
  color?: string;
  /**
   * The section the calendar's rows draw under — the Mac's Calendar sources,
   * iCloud or a Google account or Subscribed, the way Calendar.app sections
   * its sidebar. Absent for Google accounts, whose block is its own section.
   */
  group?: string;
}

/** The calendars one account offered on the latest observation pass. */
export interface ObservedAccountCalendars {
  accountId: string;
  calendars: readonly AccountCalendar[];
  /**
   * Why the pass could not read the account, when it could not — drawn on
   * the account's own row, because a connection failing only in a log is a
   * connection the user believes is working.
   */
  failure?: string;
  /**
   * True when the source itself has withdrawn the access — the System
   * Settings switch turned off — as opposed to a read that merely failed.
   * The row then offers Connect again, because reconnecting is the only act
   * left to offer.
   */
  revoked?: boolean;
}
