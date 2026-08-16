/**
 * One event on the developer's calendar, as the reader takes it.
 *
 * Times and flags, and nothing else. There is no title here, no location, no
 * note, no organiser and no attendee — only how many other people are on it,
 * which is a number the gate compares with zero. The reader takes nothing else
 * out of the calendar file, so this is not a filter that could be widened by
 * accident: it is the whole of what is ever held in memory.
 *
 * `start` and `end` are epoch milliseconds, because everything they are
 * compared against is `Date.now()`.
 */
export interface CalendarEvent {
  start: number;
  end: number;
  allDay: boolean;
  participation: MeetingParticipation;
  /** How many people other than the developer are on it. */
  others: number;
  canceled: boolean;
}

/**
 * The developer's own answer to an invitation, as far as the calendar knows.
 *
 * `ORGANIZER` is its own answer rather than an accepted one because it is
 * decided differently — someone who called a meeting is at it, whatever their
 * own attendee row says — and `UNKNOWN` is its own because appearing nowhere in
 * an event's records is not the same as having said nothing.
 */
export const MEETING_PARTICIPATION = {
  ORGANIZER: "organizer",
  ACCEPTED: "accepted",
  TENTATIVE: "tentative",
  DECLINED: "declined",
  PENDING: "pending",
  /**
   * Handed to somebody else, or already marked done. An answer like a
   * declination rather than an absence of one, which is why it is not
   * `UNKNOWN`.
   */
  EXCUSED: "excused",
  UNKNOWN: "unknown",
} as const;

export type MeetingParticipation =
  (typeof MEETING_PARTICIPATION)[keyof typeof MEETING_PARTICIPATION];
