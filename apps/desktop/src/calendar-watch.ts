import { readCalendar } from "./calendar-subscription";
import type { CalendarEvent } from "./meeting-events";
import { CALENDAR_ACCESS, type CalendarAccess } from "./shared/contracts";

/**
 * What the connected calendars are saying, taken together.
 *
 * The access and the events are separate because they fail separately: a
 * `GRANTED` reading with no events is a free afternoon, and every other access
 * is a question that was never answered. Only the first is ever allowed to mean
 * "no meeting".
 *
 * `GRANTED` here means at least one subscription answered. One calendar of
 * three failing does not hold anything back on its own — the two that answered
 * are still worth reading — but every one of them failing is a calendar Luke
 * cannot see, which holds nothing.
 */
export interface MeetingReading {
  access: CalendarAccess;
  events: readonly CalendarEvent[];
}

/** One subscription as the watch needs it: where to read, and what to call it. */
export interface WatchedCalendar {
  id: string;
  url: string;
}

/**
 * How often the calendars are read again.
 *
 * A published calendar is a file fetched over the network, so this is a poll
 * and the interval is a manners question as much as a freshness one: often
 * enough that a meeting added this morning is known by this afternoon, rarely
 * enough that nobody's calendar host notices Luke. The gate downstream schedules
 * itself on an event's own start and end, so a meeting already in hand begins
 * and ends on time whatever this is set to.
 */
export const CALENDAR_POLL_MS = 5 * 60_000;

export interface CalendarWatchOptions {
  /** Every change, including the first reading. */
  onChanged(reading: MeetingReading): void;
  /** What a name discovered in a calendar file should be remembered as. */
  onLabel?(id: string, label: string): void;
  onDiagnostic?(message: string): void;
  /** The developer's own address, where one is known, so their answer counts. */
  self?: () => string | undefined;
  read?: typeof readCalendar;
  now?: () => number;
}

/**
 * Keeps the connected calendars read.
 *
 * It runs only while at least one calendar is connected, and reads only the
 * addresses it was given: connecting is what starts the reading, and
 * disconnecting the last calendar stops it rather than ignoring what it finds.
 */
export class CalendarWatch {
  readonly #options: CalendarWatchOptions;
  #calendars: readonly WatchedCalendar[] = [];
  #timer: NodeJS.Timeout | undefined;
  #running = false;

  constructor(options: CalendarWatchOptions) {
    this.#options = options;
  }

  /**
   * Takes the connected calendars and reads them at once. Called on every
   * change to the list, so a calendar added is read now rather than at the top
   * of the next poll.
   */
  setCalendars(calendars: readonly WatchedCalendar[]): void {
    this.#calendars = calendars;
    this.stop();
    if (calendars.length === 0) {
      // Nothing connected is nothing read: the state goes back to the one a
      // build that never looked reports, rather than to "no meeting".
      this.#options.onChanged({ access: CALENDAR_ACCESS.UNKNOWN, events: [] });
      return;
    }
    void this.#read();
    this.#timer = setInterval(() => void this.#read(), CALENDAR_POLL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #read(): Promise<void> {
    // One pass at a time: a slow calendar must not have a second read stacked
    // behind it, and the answers would race into the gate in any order.
    if (this.#running) return;
    this.#running = true;
    const read = this.#options.read ?? readCalendar;
    const self = this.#options.self?.();
    try {
      const events: CalendarEvent[] = [];
      let answered = 0;
      for (const calendar of this.#calendars) {
        const fetched = await read(calendar.url, self, {
          ...(this.#options.now ? { now: this.#options.now } : {}),
          ...(this.#options.onDiagnostic ? { onDiagnostic: this.#options.onDiagnostic } : {}),
        });
        if (!fetched) continue;
        answered += 1;
        events.push(...fetched.events);
        if (fetched.label) this.#options.onLabel?.(calendar.id, fetched.label);
      }
      this.#options.onChanged({
        access: answered > 0 ? CALENDAR_ACCESS.GRANTED : CALENDAR_ACCESS.UNAVAILABLE,
        events,
      });
    } finally {
      this.#running = false;
    }
  }
}
